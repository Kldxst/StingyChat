import type { ChatRequest, KnowledgeCitation, StreamEvent, TokenTelemetry } from '../src/types';
import { safeFetch, validateCustomBaseUrl } from './security';

const encoder = new TextEncoder();
const ABNORMAL_OUTPUT_CHAR_LIMIT = 500_000;

export class ProviderUpstreamError extends Error {
  constructor(public readonly status: number) {
    super(`Provider 请求失败 (${status})`);
  }
}

function jsonEvent(event: StreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function estimate(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const rest = text.replace(/[\u3400-\u9fff]/gu, '');
  return cjk + Math.max(1, Math.ceil(rest.length / 4));
}

function telemetry(
  request: ChatRequest,
  input = 0,
  output = 0,
  reasoning = 0,
  cached = 0,
  actual = true,
): TokenTelemetry {
  const savings = {
    promptCompression: request.savings?.promptCompression ?? 0,
    contextPruning: request.savings?.contextPruning ?? 0,
    jitRetrieval: request.savings?.jitRetrieval ?? 0,
    semanticCache: request.savings?.semanticCache ?? 0,
    promptCache: cached,
  };
  const grossSaved = Object.values(savings).reduce((total, value) => total + value, 0);
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cachedTokens: cached,
    actualTotal: actual ? input + output + reasoning : undefined,
    estimatedBaseline: request.estimatedBaseline,
    estimatedSent: request.estimatedSent,
    estimatedSaved: Math.max(0, request.estimatedBaseline - request.estimatedSent),
    estimatedGrossSaved: grossSaved,
    optimizationOverhead: Math.max(0, request.estimatedSent - Math.max(0, request.estimatedBaseline - grossSaved)),
    source: actual ? 'provider' : 'estimated',
    tokenizer: actual ? 'provider' : request.tokenizer ?? 'heuristic',
    savings,
  };
}

function openAiMessages(request: ChatRequest) {
  return request.messages.map((message) => {
    const images = message.attachments?.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl) ?? [];
    if (message.role !== 'user' || !request.profile.capabilities.vision || !images.length) return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        ...images.map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl } })),
      ],
    };
  });
}

interface ProviderStreamConfig {
  url: string;
  init: RequestInit;
  parse: (payload: Record<string, unknown>) => {
    delta?: string;
    reasoningDelta?: string;
    usage?: { input: number; output: number; reasoning?: number; cached?: number };
    citations?: KnowledgeCitation[];
    done?: boolean;
  };
}

function webCitation(url: unknown, title: unknown, excerpt: unknown, id: string): KnowledgeCitation[] {
  const value = typeof url === 'string' ? url : '';
  if (!value.startsWith('https://')) return [];
  const label = typeof title === 'string' && title.trim() ? title.trim() : value;
  return [{
    chunkId: `web:${id}`,
    documentName: label.slice(0, 300),
    title: label.slice(0, 300),
    url: value,
    excerpt: typeof excerpt === 'string' ? excerpt.slice(0, 1_200) : '',
    score: 1,
    sourceType: 'web',
  }];
}

function openAiResponseCitations(payload: Record<string, unknown>): KnowledgeCitation[] {
  const annotation = payload.annotation as Record<string, unknown> | undefined;
  if (payload.type !== 'response.output_text.annotation.added' || annotation?.type !== 'url_citation') return [];
  return webCitation(annotation.url, annotation.title, '', String(annotation.start_index ?? crypto.randomUUID()));
}

function anthropicCitations(payload: Record<string, unknown>): KnowledgeCitation[] {
  const block = payload.content_block as Record<string, unknown> | undefined;
  const delta = payload.delta as Record<string, unknown> | undefined;
  const citation = delta?.citation as Record<string, unknown> | undefined;
  const results = Array.isArray(block?.content) ? block.content as Array<Record<string, unknown>> : [];
  return [
    ...results.flatMap((item, index) => webCitation(item.url, item.title, item.page_age ?? '', `anthropic:${index}:${String(item.url ?? '')}`)),
    ...(citation ? webCitation(citation.url, citation.title, citation.cited_text ?? '', `anthropic:${String(citation.url ?? '')}`) : []),
  ];
}

function geminiCitations(payload: Record<string, unknown>): KnowledgeCitation[] {
  const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
  const grounding = candidates?.[0]?.groundingMetadata as Record<string, unknown> | undefined;
  const chunks = Array.isArray(grounding?.groundingChunks) ? grounding.groundingChunks as Array<Record<string, unknown>> : [];
  return chunks.flatMap((chunk, index) => {
    const web = chunk.web as Record<string, unknown> | undefined;
    return webCitation(web?.uri, web?.title, '', `gemini:${index}:${String(web?.uri ?? '')}`);
  });
}

function openAIChatConfig(request: ChatRequest, apiKey: string, baseUrl: string): ProviderStreamConfig {
  const body: Record<string, unknown> = {
    model: request.profile.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
      ...openAiMessages(request),
    ],
    temperature: request.settings.temperature,
    top_p: request.settings.topP,
  };
  if (request.settings.stopSequences.length) body.stop = request.settings.stopSequences;
  if (request.settings.maxCompletionTokens > 0) {
    if (request.profile.kind === 'openai' || request.profile.kind === 'xai') body.max_completion_tokens = request.settings.maxCompletionTokens;
    else body.max_tokens = request.settings.maxCompletionTokens;
  }
  if (request.settings.outputContract === 'json') body.response_format = { type: 'json_object' };
  if (request.profile.kind === 'qwen') body.enable_search = request.settings.webSearch;
  if (request.settings.reasoningEnabled) {
    if (request.profile.kind === 'openai' || request.profile.kind === 'xai') {
      body.reasoning_effort = request.settings.reasoningEffort;
    } else if (request.profile.kind === 'deepseek' || request.profile.kind === 'moonshot') {
      body.thinking = { type: 'enabled' };
      if (request.profile.kind === 'moonshot') body.reasoning_effort = request.settings.reasoningEffort;
    } else if (request.profile.kind === 'qwen') {
      body.enable_thinking = true;
    } else if (request.profile.kind === 'mistral') {
      body.prompt_mode = 'reasoning';
    }
  } else if (request.profile.kind === 'deepseek' || request.profile.kind === 'moonshot' || request.profile.kind === 'stingy') {
    body.thinking = { type: 'disabled' };
  } else if (request.profile.kind === 'qwen') {
    body.enable_thinking = false;
  }
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    parse: (payload) => {
      const choices = payload.choices as Array<{ delta?: { content?: string; reasoning_content?: string } }> | undefined;
      const usage = payload.usage as Record<string, number | Record<string, number>> | undefined;
      const details = usage?.completion_tokens_details as Record<string, number> | undefined;
      return {
        delta: choices?.[0]?.delta?.content,
        reasoningDelta: request.settings.reasoningEnabled ? choices?.[0]?.delta?.reasoning_content : undefined,
        usage: usage
          ? {
              input: Number(usage.prompt_tokens ?? 0),
              output: Number(usage.completion_tokens ?? 0),
              reasoning: Number(details?.reasoning_tokens ?? 0),
              cached: Number(usage.prompt_cache_hit_tokens ?? 0),
            }
          : undefined,
      };
    },
  };
}

function openAIResponsesConfig(request: ChatRequest, apiKey: string, baseUrl: string): ProviderStreamConfig {
  const body: Record<string, unknown> = {
    model: request.profile.model,
    stream: true,
    instructions: request.systemPrompt,
    input: openAiMessages(request),
  };
  if (request.settings.webSearch) body.tools = [{ type: 'web_search' }];
  if (request.settings.maxCompletionTokens > 0) body.max_output_tokens = request.settings.maxCompletionTokens;
  if (request.settings.reasoningEnabled) body.reasoning = { effort: request.settings.reasoningEffort };
  else if (request.profile.kind === 'openai') body.reasoning = { effort: 'none' };
  if (request.settings.outputContract === 'json') {
    body.text = { format: { type: 'json_object' } };
  }
  return {
    url: `${baseUrl}/responses`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    parse: (payload) => {
      const citations = openAiResponseCitations(payload);
      if (citations.length) return { citations };
      if (payload.type === 'response.output_text.delta') return { delta: String(payload.delta ?? '') };
      if (payload.type === 'response.reasoning_summary_text.delta' && request.settings.reasoningEnabled) return { reasoningDelta: String(payload.delta ?? '') };
      if (payload.type === 'response.completed') {
        const response = payload.response as Record<string, unknown> | undefined;
        const usage = response?.usage as Record<string, number | Record<string, number>> | undefined;
        const inputDetails = usage?.input_tokens_details as Record<string, number> | undefined;
        const outputDetails = usage?.output_tokens_details as Record<string, number> | undefined;
        return {
          usage: usage
            ? {
                input: Number(usage.input_tokens ?? 0),
                output: Number(usage.output_tokens ?? 0),
                reasoning: Number(outputDetails?.reasoning_tokens ?? 0),
                cached: Number(inputDetails?.cached_tokens ?? 0),
              }
            : undefined,
          done: true,
        };
      }
      return {};
    },
  };
}

function anthropicConfig(request: ChatRequest, apiKey: string): ProviderStreamConfig {
  const system = request.settings.promptCache && request.systemPrompt
    ? [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }]
    : request.systemPrompt;
  const body: Record<string, unknown> = {
    model: request.profile.model,
    stream: true,
    system,
    messages: request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        const images = message.attachments?.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl) ?? [];
        const content = message.role === 'user' && request.profile.capabilities.vision && images.length
          ? [
              { type: 'text', text: message.content },
              ...images.map((attachment) => {
                const match = attachment.dataUrl!.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u);
                return match
                  ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
                  : { type: 'text', text: `[无法读取图片 ${attachment.name}]` };
              }),
            ]
          : message.content;
        return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
      }),
    max_tokens: request.settings.maxCompletionTokens > 0 ? request.settings.maxCompletionTokens : 65_536,
    temperature: request.settings.temperature,
    top_p: request.settings.topP,
  };
  if (request.settings.stopSequences.length) body.stop_sequences = request.settings.stopSequences;
  if (request.settings.reasoningEnabled) {
    const budgets = { minimal: 1024, low: 2048, medium: 4096, high: 8192 };
    body.thinking = { type: 'enabled', budget_tokens: budgets[request.settings.reasoningEffort] };
  }
  if (request.settings.webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  let input = 0;
  let cached = 0;
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    parse: (payload) => {
      const citations = anthropicCitations(payload);
      if (payload.type === 'message_start') {
        const message = payload.message as { usage?: Record<string, number> } | undefined;
        input = Number(message?.usage?.input_tokens ?? 0);
        cached = Number(message?.usage?.cache_read_input_tokens ?? 0);
      }
      if (payload.type === 'content_block_delta') {
        const delta = payload.delta as { type?: string; text?: string; thinking?: string } | undefined;
        return {
          delta: delta?.type === 'text_delta' ? delta.text : undefined,
          reasoningDelta: request.settings.reasoningEnabled && delta?.type === 'thinking_delta' ? delta.thinking : undefined,
          citations: citations.length ? citations : undefined,
        };
      }
      if (payload.type === 'message_delta') {
        const usage = payload.usage as Record<string, number> | undefined;
        return { usage: { input, output: Number(usage?.output_tokens ?? 0), cached } };
      }
      if (payload.type === 'message_stop') return { done: true };
      return {};
    },
  };
}

function geminiConfig(request: ChatRequest, apiKey: string): ProviderStreamConfig {
  const roles = request.messages.filter((message) => message.role !== 'system').map((message) => {
    const images = message.attachments?.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl) ?? [];
    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        { text: message.content },
        ...(message.role === 'user' && request.profile.capabilities.vision ? images.flatMap((attachment) => {
          const match = attachment.dataUrl!.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u);
          return match ? [{ inlineData: { mimeType: match[1], data: match[2] } }] : [];
        }) : []),
      ],
    };
  });
  const generationConfig: Record<string, unknown> = {
    temperature: request.settings.temperature,
    topP: request.settings.topP,
  };
  if (request.settings.outputContract === 'json') generationConfig.responseMimeType = 'application/json';
  if (request.settings.maxCompletionTokens > 0) generationConfig.maxOutputTokens = request.settings.maxCompletionTokens;
  if (request.settings.reasoningEnabled) {
    const budgets = { minimal: 512, low: 1024, medium: 4096, high: 8192 };
    generationConfig.thinkingConfig = { thinkingBudget: budgets[request.settings.reasoningEffort] };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.profile.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined,
        contents: roles,
        generationConfig,
        tools: request.settings.webSearch ? [{ googleSearch: {} }] : undefined,
      }),
    },
    parse: (payload) => {
      const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined;
      const usage = payload.usageMetadata as Record<string, number> | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      return {
        delta: parts.filter((part) => !part.thought).map((part) => part.text ?? '').join(''),
        reasoningDelta: request.settings.reasoningEnabled ? parts.filter((part) => part.thought).map((part) => part.text ?? '').join('') : undefined,
        usage: usage
          ? {
              input: Number(usage.promptTokenCount ?? 0),
              output: Number(usage.candidatesTokenCount ?? 0),
              reasoning: Number(usage.thoughtsTokenCount ?? 0),
              cached: Number(usage.cachedContentTokenCount ?? 0),
            }
          : undefined,
        citations: geminiCitations(payload),
      };
    },
  };
}

export function createProviderConfig(request: ChatRequest, apiKey: string, freeBaseUrl?: string): ProviderStreamConfig {
  if (request.profile.kind === 'stingy') return openAIChatConfig(request, apiKey, freeBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4');
  if (request.profile.kind === 'anthropic') return anthropicConfig(request, apiKey);
  if (request.profile.kind === 'gemini') return geminiConfig(request, apiKey);
  if (request.profile.kind === 'custom') {
    if (!request.profile.baseUrl) throw new Error('自定义 Provider 缺少 Base URL');
    const baseUrl = validateCustomBaseUrl(request.profile.baseUrl).toString().replace(/\/+$/u, '');
    return request.profile.protocol === 'openai-responses'
      ? openAIResponsesConfig(request, apiKey, baseUrl)
      : openAIChatConfig(request, apiKey, baseUrl);
  }
  if (request.profile.kind === 'openai') {
    const useResponses = request.settings.webSearch || request.profile.capabilities.responses;
    return useResponses
      ? openAIResponsesConfig(request, apiKey, 'https://api.openai.com/v1')
      : openAIChatConfig(request, apiKey, 'https://api.openai.com/v1');
  }
  if (request.profile.kind === 'xai' && request.settings.webSearch) {
    return openAIResponsesConfig(request, apiKey, 'https://api.x.ai/v1');
  }
  const compatibleBaseUrls: Partial<Record<ChatRequest['profile']['kind'], string>> = {
    deepseek: 'https://api.deepseek.com',
    xai: 'https://api.x.ai/v1',
    mistral: 'https://api.mistral.ai/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    minimax: 'https://api.minimax.io/v1',
  };
  const baseUrl = compatibleBaseUrls[request.profile.kind];
  if (!baseUrl) throw new Error('当前 Provider 尚未配置协议适配器');
  return openAIChatConfig(request, apiKey, baseUrl);
}

export async function streamProvider(request: ChatRequest, apiKey: string, freeBaseUrl?: string): Promise<Response> {
  if (!apiKey) throw new Error('请先配置当前 Provider 的 API Key');
  const config = createProviderConfig(request, apiKey, freeBaseUrl);
  const upstream = await safeFetch(config.url, config.init);
  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    await upstream.body?.cancel();
    throw new ProviderUpstreamError(status);
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    await upstream.body.cancel();
    throw new Error('Provider 未返回流式响应');
  }
  const reader = upstream.body.getReader();
  let outputText = '';
  let usageSent = false;
  let buffer = '';
  const citations = new Map(request.citations.map((citation) => [citation.url ?? citation.chunkId, citation]));
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(jsonEvent({ type: 'meta', citations: request.citations }));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, '\n');
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
            if (!data || data === '[DONE]') continue;
            const parsed = config.parse(JSON.parse(data) as Record<string, unknown>);
            if (parsed.citations?.length) {
              for (const citation of parsed.citations) citations.set(citation.url ?? citation.chunkId, citation);
              controller.enqueue(jsonEvent({ type: 'meta', citations: [...citations.values()] }));
            }
            if (parsed.delta) {
              outputText += parsed.delta;
              if (outputText.length > ABNORMAL_OUTPUT_CHAR_LIMIT) {
                await reader.cancel();
                throw new Error('输出异常过长，已强制中断');
              }
              controller.enqueue(jsonEvent({ type: 'delta', text: parsed.delta }));
            }
            if (parsed.reasoningDelta) {
              controller.enqueue(jsonEvent({ type: 'reasoning_delta', text: parsed.reasoningDelta }));
            }
            if (parsed.usage) {
              usageSent = true;
              controller.enqueue(
                jsonEvent({
                  type: 'usage',
                  telemetry: telemetry(
                    request,
                    parsed.usage.input,
                    parsed.usage.output,
                    parsed.usage.reasoning ?? 0,
                    parsed.usage.cached ?? 0,
                  ),
                }),
              );
            }
          }
        }
        if (!usageSent) {
          controller.enqueue(
            jsonEvent({
              type: 'usage',
              telemetry: telemetry(
                request,
                request.estimatedSent,
                estimate(outputText),
                0,
                0,
                false,
              ),
            }),
          );
        }
        controller.enqueue(jsonEvent({ type: 'done' }));
      } catch {
        controller.enqueue(jsonEvent({ type: 'error', message: '流式响应中断，请重试' }));
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}
