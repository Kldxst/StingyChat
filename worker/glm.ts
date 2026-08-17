import { validateCustomBaseUrl } from './security';

export interface WorkerEnv {
  ASSETS: Fetcher;
  GLM_API_KEY?: string;
  GLM_FALLBACK_API_KEYS?: string;
  GLM_BASE_URL: string;
  GLM_MODEL: string;
  GLM_VISION_MODEL?: string;
  FREE_GLM_API_KEY?: string;
  FREE_GLM_BASE_URL?: string;
  FREE_GLM_MODEL?: string;
  GLM_SCHEDULER?: DurableObjectNamespace;
  ADMIN_DB?: D1Database;
  APP_DB?: D1Database;
  CP_OAUTH_BASE_URL?: string;
  CP_OAUTH_CLIENT_ID?: string;
  CP_OAUTH_CLIENT_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  SESSION_SECRET?: string;
  PROFILE_ENCRYPTION_KEY?: string;
  OWNER_CP_SUB?: string;
}

export interface GlmCandidate {
  id: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface PersonalAssistantCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface GlmTask {
  requestId: string;
  operation: string;
  system: string;
  user: string;
  temperature?: number;
  imageDataUrl?: string;
  webSearch?: boolean;
  model?: string;
}

interface GlmResult {
  content: string;
  sources?: Array<{ title: string; url: string; excerpt: string; publishedAt?: string }>;
}

export class GlmUpstreamError extends Error {
  constructor(public readonly status: number, message = `智能助手上游请求失败 (${status})`) {
    super(message);
  }
}

function parseFallbackKeys(value?: string): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return value.split(/[\r\n,]+/u).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function glmCandidates(env: WorkerEnv): GlmCandidate[] {
  const candidates: GlmCandidate[] = [];
  const add = (id: string, apiKey: string | undefined, baseUrl: string, model: string) => {
    if (!apiKey || candidates.some((candidate) => candidate.apiKey === apiKey)) return;
    candidates.push({ id, apiKey, baseUrl: baseUrl.replace(/\/+$/u, ''), model });
  };
  add('primary', env.GLM_API_KEY, env.GLM_BASE_URL, env.GLM_MODEL);
  add('free', env.FREE_GLM_API_KEY, env.FREE_GLM_BASE_URL ?? env.GLM_BASE_URL, env.FREE_GLM_MODEL ?? 'GLM-4.5-Flash');
  parseFallbackKeys(env.GLM_FALLBACK_API_KEYS).forEach((key, index) => add(`fallback-${index}`, key, env.GLM_BASE_URL, env.GLM_MODEL));
  return candidates;
}

async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal, redirect: 'manual' }),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('智能助手请求超时'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function extractSources(payload: Record<string, unknown>): GlmResult['sources'] {
  const raw = (payload.web_search ?? payload.search_result) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, 8).flatMap((item) => {
    const url = String(item.link ?? item.url ?? '');
    if (!url.startsWith('https://')) return [];
    return [{
      title: String(item.title ?? item.media ?? url).slice(0, 300),
      url,
      excerpt: String(item.content ?? item.summary ?? '').slice(0, 1_200),
      publishedAt: item.publish_date ? String(item.publish_date) : undefined,
    }];
  });
}

export async function executeGlmTask(candidate: GlmCandidate, task: GlmTask, timeoutMs = 25_000): Promise<GlmResult> {
  const userContent = task.imageDataUrl
    ? [{ type: 'text', text: task.user }, { type: 'image_url', image_url: { url: task.imageDataUrl } }]
    : task.user;
  const body: Record<string, unknown> = {
    model: task.model ?? candidate.model,
    temperature: task.temperature ?? 0.2,
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: task.system },
      { role: 'user', content: userContent },
    ],
  };
  if (task.webSearch) {
    body.tools = [{
      type: 'web_search',
      web_search: {
        enable: true,
        search_engine: 'search_pro',
        search_result: true,
        count: 6,
        search_recency_filter: 'noLimit',
        content_size: 'medium',
      },
    }];
    body.tool_choice = 'auto';
  }
  const response = await fetchWithDeadline(`${candidate.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${candidate.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('智能助手端点返回了未经允许的重定向');
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new GlmUpstreamError(status);
  }
  const payload = await response.json() as Record<string, unknown>;
  const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('智能助手未返回文本内容');
  return { content, sources: extractSources(payload) };
}

function personalCandidate(env: WorkerEnv, personal: string | PersonalAssistantCredentials, taskModel?: string): GlmCandidate {
  if (typeof personal === 'string') {
    return { id: 'personal', apiKey: personal, baseUrl: env.GLM_BASE_URL.replace(/\/+$/u, ''), model: taskModel ?? env.GLM_MODEL };
  }
  const baseUrl = validateCustomBaseUrl(personal.baseUrl).toString().replace(/\/+$/u, '');
  return { id: 'personal', apiKey: personal.apiKey, baseUrl, model: personal.model };
}

export async function callGlmTask(env: WorkerEnv, task: GlmTask, personalAssistant?: string | PersonalAssistantCredentials): Promise<GlmResult> {
  if (personalAssistant) {
    const personalTask = typeof personalAssistant === 'string' ? task : { ...task, model: undefined };
    return executeGlmTask(personalCandidate(env, personalAssistant, task.model), personalTask, 45_000);
  }
  if (env.GLM_SCHEDULER) {
    const stub = env.GLM_SCHEDULER.get(env.GLM_SCHEDULER.idFromName('global'));
    const response = await stub.fetch('https://glm-scheduler/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    const payload = await response.json() as GlmResult & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? '智能助手服务暂不可用');
    return payload;
  }
  const candidates = glmCandidates(env);
  if (!candidates.length) throw new Error('智能辅助服务尚未配置');
  let lastStatus: number | undefined;
  for (const candidate of candidates) {
    try {
      return await executeGlmTask(candidate, task, 4_000);
    } catch (error) {
      if (error instanceof GlmUpstreamError) lastStatus = error.status;
    }
  }
  throw new Error(lastStatus ? `智能辅助服务暂时繁忙（上游 ${lastStatus}）` : '智能辅助服务连接超时，请稍后重试');
}

export async function callGlm(
  env: WorkerEnv,
  system: string,
  user: string,
  temperature = 0.2,
  personalAssistant?: string | PersonalAssistantCredentials,
  requestId: string = crypto.randomUUID(),
  operation = 'assist',
): Promise<string> {
  const result = await callGlmTask(env, { requestId, operation, system, user, temperature }, personalAssistant);
  return result.content;
}

export function parseJsonObject<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
  return JSON.parse(cleaned) as T;
}
