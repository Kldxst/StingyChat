import type { OptimizationSettings, ProviderKind, ProviderProfile } from './types';
import { getModelInfoWithId, type ModelLike } from 'llm-info';

export const GITHUB_REPOSITORY_URL = 'https://github.com/Kldxst/StingyChat';

export function modelCatalogInfo(model: string, fallbackContext: number) {
  try {
    const info = getModelInfoWithId(model as ModelLike) as { contextWindowTokenLimit?: number; supportsImageInput?: boolean };
    return {
      contextWindow: info.contextWindowTokenLimit ?? fallbackContext,
      vision: info.supportsImageInput,
    };
  } catch {
    return { contextWindow: fallbackContext, vision: undefined };
  }
}

interface ModelOption {
  id: string;
  label: string;
  contextWindow: number;
  webSearch?: boolean;
}

export const MODEL_OPTIONS: Record<ProviderKind, ModelOption[]> = {
  stingy: [
    { id: 'GLM-4.5-Flash', label: 'StingyChat', contextWindow: 128_000 },
  ],
  openai: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', contextWindow: 400_000, webSearch: true },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', contextWindow: 400_000, webSearch: true },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', contextWindow: 400_000, webSearch: true },
  ],
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', contextWindow: 200_000, webSearch: true },
    { id: 'claude-opus-5', label: 'Claude Opus 5', contextWindow: 200_000, webSearch: true },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', contextWindow: 200_000, webSearch: true },
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', contextWindow: 1_000_000, webSearch: true },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', contextWindow: 1_000_000, webSearch: true },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', contextWindow: 1_000_000, webSearch: true },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1_000_000 },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 1_000_000 },
  ],
  xai: [
    { id: 'grok-4-6', label: 'Grok 4.6', contextWindow: 256_000, webSearch: true },
    { id: 'grok-4.20', label: 'Grok 4.20', contextWindow: 256_000, webSearch: true },
  ],
  mistral: [
    { id: 'mistral-medium-latest', label: 'Mistral Medium 3.5', contextWindow: 128_000 },
    { id: 'mistral-small-latest', label: 'Mistral Small 4', contextWindow: 128_000 },
  ],
  qwen: [
    { id: 'qwen3.7-max', label: 'Qwen 3.7 Max', contextWindow: 1_000_000, webSearch: true },
    { id: 'qwen3-max', label: 'Qwen 3 Max', contextWindow: 262_144, webSearch: true },
  ],
  moonshot: [
    { id: 'kimi-k3', label: 'Kimi K3', contextWindow: 1_000_000 },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextWindow: 262_144 },
    { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 262_144 },
  ],
  minimax: [
    { id: 'MiniMax-M3', label: 'MiniMax M3', contextWindow: 1_000_000 },
    { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', contextWindow: 204_800 },
  ],
  custom: [],
};

export const DEFAULT_PROFILES: ProviderProfile[] = [
  {
    id: 'stingy-free', name: 'StingyChat', kind: 'stingy', model: 'GLM-4.5-Flash', contextWindow: 128_000,
    capabilities: { responses: false, webSearch: true, reasoning: false, reasoningEffort: false, promptCache: false, batch: false, structuredOutput: true, vision: false },
  },
  {
    id: 'openai-default',
    name: 'OpenAI',
    kind: 'openai',
    model: 'gpt-5.6-terra',
    contextWindow: 400_000,
    capabilities: {
      responses: true,
      webSearch: true,
      reasoning: true,
      reasoningEffort: true,
      promptCache: true,
      batch: true,
      structuredOutput: true,
      vision: true,
    },
  },
  {
    id: 'anthropic-default',
    name: 'Anthropic',
    kind: 'anthropic',
    model: 'claude-sonnet-5',
    contextWindow: 200_000,
    capabilities: {
      responses: false,
      webSearch: true,
      reasoning: true,
      reasoningEffort: true,
      promptCache: true,
      batch: true,
      structuredOutput: false,
      vision: true,
    },
  },
  {
    id: 'gemini-default',
    name: 'Gemini',
    kind: 'gemini',
    model: 'gemini-3.5-flash',
    contextWindow: 1_000_000,
    capabilities: {
      responses: false,
      webSearch: true,
      reasoning: true,
      reasoningEffort: true,
      promptCache: false,
      batch: false,
      structuredOutput: true,
      vision: true,
    },
  },
  {
    id: 'deepseek-default',
    name: 'DeepSeek',
    kind: 'deepseek',
    model: 'deepseek-v4-flash',
    contextWindow: 1_000_000,
    capabilities: {
      responses: false,
      webSearch: false,
      reasoning: true,
      reasoningEffort: false,
      promptCache: true,
      batch: false,
      structuredOutput: true,
      vision: false,
    },
  },
  {
    id: 'xai-default', name: 'xAI', kind: 'xai', model: 'grok-4-6', contextWindow: 256_000,
    capabilities: { responses: true, webSearch: true, reasoning: true, reasoningEffort: true, promptCache: true, batch: false, structuredOutput: true, vision: true },
  },
  {
    id: 'mistral-default', name: 'Mistral', kind: 'mistral', model: 'mistral-medium-latest', contextWindow: 128_000,
    capabilities: { responses: false, webSearch: false, reasoning: true, reasoningEffort: false, promptCache: true, batch: false, structuredOutput: true, vision: true },
  },
  {
    id: 'qwen-default', name: '通义千问', kind: 'qwen', model: 'qwen3.7-max', contextWindow: 1_000_000,
    capabilities: { responses: false, webSearch: true, reasoning: true, reasoningEffort: false, promptCache: true, batch: false, structuredOutput: true, vision: true },
  },
  {
    id: 'moonshot-default', name: 'Kimi', kind: 'moonshot', model: 'kimi-k3', contextWindow: 1_000_000,
    capabilities: { responses: false, webSearch: false, reasoning: true, reasoningEffort: true, promptCache: true, batch: false, structuredOutput: true, vision: true },
  },
  {
    id: 'minimax-default', name: 'MiniMax', kind: 'minimax', model: 'MiniMax-M3', contextWindow: 1_000_000,
    capabilities: { responses: false, webSearch: false, reasoning: false, reasoningEffort: false, promptCache: true, batch: false, structuredOutput: true, vision: true },
  },
];

export const DEFAULT_SETTINGS: OptimizationSettings = {
  ruleCompression: true,
  removePoliteness: true,
  structuredPrompt: false,
  chipProtocol: false,
  concisePersona: true,
  automaticContextCompression: true,
  promptCache: true,
  semanticCache: false,
  semanticHitEnhancement: false,
  modelRouting: false,
  jitRetrieval: true,
  toonStructured: false,
  extremeMode: false,
  outputContract: 'concise',
  maxCompletionTokens: 0,
  stopSequences: [],
  temperature: 0.6,
  topP: 0.9,
  reasoningEnabled: false,
  reasoningEffort: 'medium',
  webSearch: false,
  retrievalTopK: 4,
  compressionThreshold: 0.72,
  fewShotExamples: [],
  pinModel: false,
};
