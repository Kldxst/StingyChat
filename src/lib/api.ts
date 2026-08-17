import type {
  ChatRequest,
  ConversationMemory,
  ProviderProfile,
  StreamEvent,
} from '../types';
import { consumeEventStream } from './sse';
import { loadPersonalGlmSecret } from './crypto';
import { loadPersonalAssistantConfig } from './preferences';
import type { GlmQueueStatus, KnowledgeCitation } from '../types';
import { sanitizeChatRequest } from './chatValidation';

async function jsonRequest<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => undefined)) as { error?: string } & T;
  if (!response.ok) throw new Error(payload?.error || `请求失败 (${response.status})`);
  return payload;
}

function emitGlmStatus(status: GlmQueueStatus | { state: 'unavailable'; requestId: string; message: string }) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('stingy:glm-status', { detail: status }));
}

async function personalGlmHeaders(): Promise<Record<string, string>> {
  const personalKey = (await loadPersonalGlmSecret())?.trim();
  if (!personalKey) return {};
  const config = loadPersonalAssistantConfig();
  return {
    'x-user-assistant-api-key': personalKey,
    'x-user-assistant-base-url': encodeURIComponent(config.baseUrl),
    'x-user-assistant-model': encodeURIComponent(config.model),
  };
}

async function glmJsonRequest<T>(path: string, body: unknown, operation: string): Promise<T> {
  const requestId = crypto.randomUUID();
  const personalHeaders = await personalGlmHeaders();
  const usesPersonalKey = 'x-user-assistant-api-key' in personalHeaders;
  let settled = false;
  const poll = async () => {
    if (settled || usesPersonalKey) return;
    try {
      const response = await fetch(`/api/assist/queue/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
      if (response.ok) emitGlmStatus(await response.json() as GlmQueueStatus);
    } catch {
      // Queue visibility is best-effort and never blocks the actual task.
    }
  };
  const timer = globalThis.setInterval(() => void poll(), 1_500);
  globalThis.setTimeout(() => void poll(), 500);
  try {
    if (usesPersonalKey) emitGlmStatus({ requestId, state: 'personal', operation, position: 0, queuedAt: Date.now(), estimatedWaitMs: 0 });
    const result = await jsonRequest<T>(path, body, {
      'x-glm-request-id': requestId,
      ...personalHeaders,
    });
    emitGlmStatus({ requestId, state: 'completed', operation, position: 0, queuedAt: Date.now(), estimatedWaitMs: 0 });
    return result;
  } catch (error) {
    emitGlmStatus({ state: 'unavailable', requestId, message: error instanceof Error ? error.message : '智能助手服务暂不可用' });
    throw error;
  } finally {
    settled = true;
    globalThis.clearInterval(timer);
  }
}

export async function streamChat(
  request: ChatRequest,
  apiKey: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const personalHeaders = await personalGlmHeaders();
  const requestId = crypto.randomUUID();
  const queued = request.profile.kind === 'stingy' && !('x-user-assistant-api-key' in personalHeaders);
  let settled = false;
  const poll = async () => {
    if (!queued || settled) return;
    try {
      const response = await fetch(`/api/assist/queue/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
      if (response.ok) emitGlmStatus(await response.json() as GlmQueueStatus);
    } catch {
      // Queue visibility must not interrupt the chat stream.
    }
  };
  const timer = globalThis.setInterval(() => void poll(), 1_500);
  globalThis.setTimeout(() => void poll(), 500);
  try {
    if (request.profile.kind === 'stingy' && !queued) {
      emitGlmStatus({ requestId, state: 'personal', operation: 'StingyChat', position: 0, queuedAt: Date.now(), estimatedWaitMs: 0 });
    }
    const normalizedRequest = sanitizeChatRequest(request);
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-provider-api-key': apiKey,
        'x-glm-request-id': requestId,
        ...personalHeaders,
      },
      body: JSON.stringify(normalizedRequest),
      signal,
    });
    await consumeEventStream(response, onEvent);
    if (request.profile.kind === 'stingy') {
      emitGlmStatus({ requestId, state: 'completed', operation: 'StingyChat', position: 0, queuedAt: Date.now(), estimatedWaitMs: 0 });
    }
  } finally {
    settled = true;
    globalThis.clearInterval(timer);
  }
}

export async function optimizeWithGlm(text: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/optimize-prompt', { text }, '优化提示词');
  return result.text;
}

export async function generateSystemPrompt(text: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/generate-system-prompt', { text }, '生成 System Prompt');
  return result.text;
}

export async function generateConversationTitle(text: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/generate-title', { text }, '生成对话标题');
  return result.text;
}

export async function compressConversation(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  currentMemory: string,
): Promise<ConversationMemory> {
  return glmJsonRequest('/api/conversation/compress', { messages, currentMemory }, '压缩对话');
}

export function routePrompt(prompt: string, needsWebSearch: boolean, needsReasoning: boolean) {
  return glmJsonRequest<{ route: 'simple' | 'complex'; reason: string }>('/api/assist/route', {
    prompt,
    needsWebSearch,
    needsReasoning,
  }, '模型路由');
}

export function validateCacheMatch(
  prompt: string,
  candidatePrompt: string,
  contextFingerprint: string,
) {
  return glmJsonRequest<{ equivalent: boolean; reason: string }>('/api/assist/cache-match', {
    prompt,
    candidatePrompt,
    contextFingerprint,
  }, '语义缓存验证');
}

export async function normalizeForSemanticCache(text: string, context: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/cache-normalize', { text, context }, '语义增强');
  return result.text;
}

export async function reasonWithGlm(text: string, context: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/reason', { text, context }, '辅助推演');
  return result.text;
}

export function searchWithGlm(text: string): Promise<{ text: string; citations: KnowledgeCitation[] }> {
  return glmJsonRequest('/api/assist/web-search', { text }, '联网搜索');
}

export async function understandImageWithGlm(text: string, dataUrl: string): Promise<string> {
  const result = await glmJsonRequest<{ text: string }>('/api/assist/understand-image', { text, dataUrl }, '图片理解');
  return result.text;
}

export function submitBatch(
  profile: ProviderProfile,
  apiKey: string,
  items: Array<{ customId: string; prompt: string; systemPrompt?: string }>,
) {
  return jsonRequest<Record<string, unknown>>(
    '/api/batch/submit',
    { profile, items },
    { 'x-provider-api-key': apiKey },
  );
}

export function getBatchStatus(profile: ProviderProfile, apiKey: string, batchId: string) {
  return jsonRequest<Record<string, unknown>>(
    '/api/batch/status',
    { profile, batchId },
    { 'x-provider-api-key': apiKey },
  );
}

export async function downloadBatchResults(
  profile: ProviderProfile,
  apiKey: string,
  batchId: string,
): Promise<Blob> {
  const response = await fetch('/api/batch/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-provider-api-key': apiKey },
    body: JSON.stringify({ profile, batchId }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(payload?.error || `结果下载失败 (${response.status})`);
  }
  return response.blob();
}
