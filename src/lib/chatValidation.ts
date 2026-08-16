import { DEFAULT_SETTINGS } from '../config';
import type { ChatAttachment, ChatRequest, KnowledgeCitation, OptimizationSettings, ProviderProfile } from '../types';

const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_SYSTEM_CHARS = 200_000;
const MAX_IMAGE_DATA_URL_CHARS = 6_000_000;

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function compactText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.2);
  return `${value.slice(0, head)}\n\n[内容过长，已保留首尾]\n\n${value.slice(-(limit - head - 20))}`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function optionalText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined;
}

function normalizeAttachment(attachment: ChatAttachment): ChatAttachment {
  return {
    id: String(attachment.id).slice(0, 100),
    name: String(attachment.name).slice(0, 300),
    mimeType: String(attachment.mimeType || 'application/octet-stream').slice(0, 100),
    size: Math.max(0, Math.min(20 * 1024 * 1024, Math.round(Number(attachment.size) || 0))),
    kind: attachment.kind === 'image' ? 'image' : 'document',
    dataUrl: attachment.dataUrl && attachment.dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS ? attachment.dataUrl : undefined,
    text: attachment.text ? compactText(attachment.text, MAX_MESSAGE_CHARS) : undefined,
  };
}

function normalizeProfile(profile: ProviderProfile): ProviderProfile {
  const rawBaseUrl = optionalText(profile.baseUrl, 2_000);
  let baseUrl: string | undefined;
  if (rawBaseUrl) {
    try { baseUrl = new URL(rawBaseUrl).toString(); } catch { baseUrl = undefined; }
  }
  return {
    ...profile,
    id: String(profile.id || 'recovered-provider').slice(0, 100),
    name: String(profile.name || 'Provider').slice(0, 100),
    kind: oneOf(profile.kind, ['stingy', 'openai', 'anthropic', 'gemini', 'deepseek', 'xai', 'mistral', 'qwen', 'moonshot', 'minimax', 'custom'] as const, 'custom'),
    model: String(profile.model || 'unknown-model').slice(0, 200),
    baseUrl,
    protocol: profile.protocol ? oneOf(profile.protocol, ['openai-chat', 'openai-responses'] as const, 'openai-chat') : undefined,
    contextWindow: Math.round(clamp(profile.contextWindow, 1_024, 10_000_000, 128_000)),
    capabilities: {
      responses: Boolean(profile.capabilities?.responses),
      webSearch: Boolean(profile.capabilities?.webSearch),
      reasoning: Boolean(profile.capabilities?.reasoning),
      reasoningEffort: Boolean(profile.capabilities?.reasoningEffort),
      promptCache: Boolean(profile.capabilities?.promptCache),
      batch: Boolean(profile.capabilities?.batch),
      structuredOutput: Boolean(profile.capabilities?.structuredOutput),
      vision: Boolean(profile.capabilities?.vision),
    },
  };
}

function normalizeSettings(settings: OptimizationSettings): OptimizationSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return {
    ...merged,
    ruleCompression: Boolean(merged.ruleCompression), removePoliteness: Boolean(merged.removePoliteness),
    structuredPrompt: Boolean(merged.structuredPrompt), chipProtocol: Boolean(merged.chipProtocol),
    concisePersona: Boolean(merged.concisePersona), automaticContextCompression: Boolean(merged.automaticContextCompression),
    promptCache: Boolean(merged.promptCache), semanticCache: Boolean(merged.semanticCache),
    semanticHitEnhancement: Boolean(merged.semanticHitEnhancement), modelRouting: Boolean(merged.modelRouting),
    jitRetrieval: Boolean(merged.jitRetrieval), toonStructured: Boolean(merged.toonStructured), extremeMode: Boolean(merged.extremeMode),
    reasoningEnabled: Boolean(merged.reasoningEnabled), webSearch: Boolean(merged.webSearch), pinModel: Boolean(merged.pinModel), autoSkills: Boolean(merged.autoSkills),
    outputContract: oneOf(merged.outputContract, ['concise', 'json', 'code', 'choice', 'free'] as const, DEFAULT_SETTINGS.outputContract),
    reasoningEffort: oneOf(merged.reasoningEffort, ['minimal', 'low', 'medium', 'high'] as const, DEFAULT_SETTINGS.reasoningEffort),
    theme: oneOf(merged.theme, ['system', 'light', 'dark'] as const, DEFAULT_SETTINGS.theme),
    maxCompletionTokens: Math.round(clamp(merged.maxCompletionTokens, 0, 128_000, 0)),
    temperature: clamp(merged.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    topP: clamp(merged.topP, 0, 1, DEFAULT_SETTINGS.topP),
    retrievalTopK: Math.round(clamp(merged.retrievalTopK, 1, 20, DEFAULT_SETTINGS.retrievalTopK)),
    compressionThreshold: clamp(merged.compressionThreshold, 0.2, 0.95, DEFAULT_SETTINGS.compressionThreshold),
    stopSequences: (merged.stopSequences ?? []).map(String).map((item) => item.slice(0, 100)).slice(0, 8),
    fewShotExamples: (merged.fewShotExamples ?? []).slice(0, 20).map((item) => ({
      id: String(item.id).slice(0, 100), input: compactText(String(item.input), 20_000), output: compactText(String(item.output), 20_000),
    })),
    simpleProfileId: optionalText(merged.simpleProfileId, 100),
    complexProfileId: optionalText(merged.complexProfileId, 100),
  };
}

function normalizeCitation(citation: KnowledgeCitation): KnowledgeCitation {
  return {
    ...citation,
    chunkId: String(citation.chunkId).slice(0, 500),
    documentName: String(citation.documentName).slice(0, 500),
    excerpt: compactText(String(citation.excerpt), 10_000),
    score: Number.isFinite(citation.score) ? citation.score : 0,
    sourceType: citation.sourceType ? oneOf(citation.sourceType, ['knowledge', 'attachment', 'web'] as const, 'knowledge') : undefined,
    title: citation.title?.slice(0, 500),
    url: citation.url && /^https?:\/\//iu.test(citation.url) ? citation.url : undefined,
  };
}

export function sanitizeChatRequest(request: ChatRequest): ChatRequest {
  const messages = request.messages.slice(-500).map((message) => ({
    role: oneOf(message.role, ['user', 'assistant', 'system'] as const, 'user'),
    content: compactText(String(message.content ?? ''), MAX_MESSAGE_CHARS),
    attachments: message.attachments?.slice(0, 8).map(normalizeAttachment),
  }));
  const savings = request.savings ? {
    promptCompression: Math.max(0, Math.round(Number(request.savings.promptCompression) || 0)),
    contextPruning: Math.max(0, Math.round(Number(request.savings.contextPruning) || 0)),
    jitRetrieval: Math.max(0, Math.round(Number(request.savings.jitRetrieval) || 0)),
    semanticCache: Math.max(0, Math.round(Number(request.savings.semanticCache) || 0)),
    promptCache: Math.max(0, Math.round(Number(request.savings.promptCache) || 0)),
  } : undefined;
  const clientContext = request.clientContext && Number.isFinite(request.clientContext.utcOffsetMinutes) ? {
    nowIso: Number.isNaN(Date.parse(request.clientContext.nowIso)) ? new Date().toISOString() : new Date(request.clientContext.nowIso).toISOString(),
    localTime: String(request.clientContext.localTime || new Date().toLocaleString()).slice(0, 200),
    timeZone: String(request.clientContext.timeZone || 'UTC').slice(0, 100),
    locale: String(request.clientContext.locale || 'zh-CN').slice(0, 50),
    utcOffsetMinutes: Math.round(clamp(request.clientContext.utcOffsetMinutes, -840, 840, 0)),
  } : undefined;
  return {
    ...request,
    conversationId: String(request.conversationId).slice(0, 100),
    profile: normalizeProfile(request.profile),
    messages,
    systemPrompt: compactText(String(request.systemPrompt ?? ''), MAX_SYSTEM_CHARS),
    settings: normalizeSettings(request.settings),
    estimatedBaseline: Math.max(0, Math.round(Number(request.estimatedBaseline) || 0)),
    estimatedSent: Math.max(0, Math.round(Number(request.estimatedSent) || 0)),
    citations: request.citations.slice(0, 20).map(normalizeCitation),
    savings,
    tokenizer: request.tokenizer === 'tiktoken' ? 'tiktoken' : request.tokenizer === 'heuristic' ? 'heuristic' : undefined,
    clientContext,
  };
}
