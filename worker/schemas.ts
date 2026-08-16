import { z } from 'zod';

const capabilitiesSchema = z.object({
  responses: z.boolean(),
  webSearch: z.boolean(),
  reasoning: z.boolean(),
  reasoningEffort: z.boolean(),
  promptCache: z.boolean(),
  batch: z.boolean(),
  structuredOutput: z.boolean(),
  vision: z.boolean().optional().default(false),
});

const profileSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  kind: z.enum([
    'stingy',
    'openai',
    'anthropic',
    'gemini',
    'deepseek',
    'xai',
    'mistral',
    'qwen',
    'moonshot',
    'minimax',
    'custom',
  ]),
  model: z.string().min(1).max(200),
  baseUrl: z.string().url().optional(),
  protocol: z.enum(['openai-chat', 'openai-responses']).optional(),
  contextWindow: z.number().int().min(1024).max(10_000_000),
  capabilities: capabilitiesSchema,
  hasEncryptedKey: z.boolean().optional(),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(1_000_000),
  attachments: z.array(z.object({
    id: z.string().max(100),
    name: z.string().max(300),
    mimeType: z.string().max(100),
    size: z.number().int().nonnegative().max(20 * 1024 * 1024),
    kind: z.enum(['image', 'document']),
    dataUrl: z.string().max(6_000_000).optional(),
    text: z.string().max(1_000_000).optional(),
  })).max(8).optional(),
});

const citationSchema = z.object({
  chunkId: z.string(),
  documentName: z.string(),
  excerpt: z.string().max(10_000),
  score: z.number(),
  sourceType: z.enum(['knowledge', 'attachment', 'web']).optional(),
  url: z.string().url().optional(),
  title: z.string().max(500).optional(),
});

const settingsSchema = z.object({
  ruleCompression: z.boolean(),
  removePoliteness: z.boolean(),
  structuredPrompt: z.boolean(),
  chipProtocol: z.boolean(),
  concisePersona: z.boolean(),
  automaticContextCompression: z.boolean(),
  promptCache: z.boolean(),
  semanticCache: z.boolean(),
  semanticHitEnhancement: z.boolean(),
  modelRouting: z.boolean(),
  jitRetrieval: z.boolean(),
  toonStructured: z.boolean(),
  extremeMode: z.boolean(),
  outputContract: z.enum(['concise', 'json', 'code', 'choice', 'free']),
  maxCompletionTokens: z.number().int().min(0).max(128_000),
  stopSequences: z.array(z.string().max(100)).max(8),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  reasoningEnabled: z.boolean(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']),
  webSearch: z.boolean(),
  retrievalTopK: z.number().int().min(1).max(20),
  compressionThreshold: z.number().min(0.2).max(0.95),
  fewShotExamples: z.array(
    z.object({ id: z.string(), input: z.string().max(20_000), output: z.string().max(20_000) }),
  ),
  simpleProfileId: z.string().optional(),
  complexProfileId: z.string().optional(),
  pinModel: z.boolean(),
});

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(100),
  profile: profileSchema,
  messages: z.array(messageSchema).min(1).max(500),
  systemPrompt: z.string().max(200_000),
  settings: settingsSchema,
  estimatedBaseline: z.number().int().nonnegative(),
  estimatedSent: z.number().int().nonnegative(),
  citations: z.array(citationSchema).max(20),
  savings: z.object({
    promptCompression: z.number().int().nonnegative(),
    contextPruning: z.number().int().nonnegative(),
    jitRetrieval: z.number().int().nonnegative(),
    semanticCache: z.number().int().nonnegative(),
    promptCache: z.number().int().nonnegative(),
  }).optional(),
  tokenizer: z.enum(['tiktoken', 'heuristic']).optional(),
});

export const assistTextSchema = z.object({
  text: z.string().min(1).max(200_000),
  context: z.string().max(200_000).optional(),
});

export const compressionSchema = z.object({
  messages: z.array(messageSchema).min(2).max(500),
  currentMemory: z.string().max(100_000).optional(),
});

export const routeSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  needsWebSearch: z.boolean(),
  needsReasoning: z.boolean(),
});

export const cacheMatchSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  candidatePrompt: z.string().min(1).max(100_000),
  contextFingerprint: z.string().min(1).max(500),
});

export const batchSubmitSchema = z.object({
  profile: profileSchema,
  items: z.array(
    z.object({
      customId: z.string().min(1).max(100),
      prompt: z.string().min(1).max(500_000),
      systemPrompt: z.string().max(100_000).optional(),
    }),
  ).min(1).max(10_000),
});

export const batchOperationSchema = z.object({
  profile: profileSchema,
  batchId: z.string().min(1).max(300),
});
