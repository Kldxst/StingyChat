import type { ProviderProfile } from '../src/types';
import { safeFetch } from './security';

interface BatchItem {
  customId: string;
  prompt: string;
  systemPrompt?: string;
}

function ensureBatchProvider(profile: ProviderProfile): void {
  if (profile.kind !== 'openai' && profile.kind !== 'anthropic') {
    throw new Error('当前仅支持 OpenAI 与 Anthropic 批处理');
  }
}

async function parseOk(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`批处理 Provider 请求失败 (${response.status})`);
  }
  return response.json<Record<string, unknown>>();
}

export async function submitBatch(
  profile: ProviderProfile,
  apiKey: string,
  items: BatchItem[],
): Promise<Record<string, unknown>> {
  ensureBatchProvider(profile);
  if (profile.kind === 'anthropic') {
    const response = await safeFetch('https://api.anthropic.com/v1/messages/batches', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: items.map((item) => ({
          custom_id: item.customId,
          params: {
            model: profile.model,
            max_tokens: 1024,
            system: item.systemPrompt || undefined,
            messages: [{ role: 'user', content: item.prompt }],
          },
        })),
      }),
    });
    return parseOk(response);
  }

  const jsonl = items
    .map((item) =>
      JSON.stringify({
        custom_id: item.customId,
        method: 'POST',
        url: '/v1/responses',
        body: {
          model: profile.model,
          instructions: item.systemPrompt || undefined,
          input: item.prompt,
          max_output_tokens: 1024,
        },
      }),
    )
    .join('\n');
  const form = new FormData();
  form.set('purpose', 'batch');
  form.set('file', new File([jsonl], 'stingy-batch.jsonl', { type: 'application/jsonl' }));
  const fileResponse = await safeFetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const file = await parseOk(fileResponse);
  if (typeof file.id !== 'string') throw new Error('OpenAI 未返回批处理文件 ID');
  const batchResponse = await safeFetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: file.id,
      endpoint: '/v1/responses',
      completion_window: '24h',
    }),
  });
  return parseOk(batchResponse);
}

export async function getBatchStatus(
  profile: ProviderProfile,
  apiKey: string,
  batchId: string,
): Promise<Record<string, unknown>> {
  ensureBatchProvider(profile);
  const isAnthropic = profile.kind === 'anthropic';
  const response = await safeFetch(
    isAnthropic
      ? `https://api.anthropic.com/v1/messages/batches/${encodeURIComponent(batchId)}`
      : `https://api.openai.com/v1/batches/${encodeURIComponent(batchId)}`,
    {
      method: 'GET',
      headers: isAnthropic
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${apiKey}` },
    },
  );
  return parseOk(response);
}

export async function getBatchResults(
  profile: ProviderProfile,
  apiKey: string,
  batchId: string,
): Promise<Response> {
  ensureBatchProvider(profile);
  if (profile.kind === 'anthropic') {
    const response = await safeFetch(
      `https://api.anthropic.com/v1/messages/batches/${encodeURIComponent(batchId)}/results`,
      {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      },
    );
    if (!response.ok) throw new Error(`批处理结果请求失败 (${response.status})`);
    return new Response(response.body, {
      headers: { 'Content-Type': 'application/x-jsonlines', 'Cache-Control': 'no-store' },
    });
  }
  const status = await getBatchStatus(profile, apiKey, batchId);
  const fileId = status.output_file_id;
  if (typeof fileId !== 'string') throw new Error('批处理尚未生成结果文件');
  const response = await safeFetch(
    `https://api.openai.com/v1/files/${encodeURIComponent(fileId)}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) throw new Error(`批处理结果请求失败 (${response.status})`);
  return new Response(response.body, {
    headers: { 'Content-Type': 'application/x-jsonlines', 'Cache-Control': 'no-store' },
  });
}
