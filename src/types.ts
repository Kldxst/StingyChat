export type ProviderKind =
  | 'stingy'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'qwen'
  | 'moonshot'
  | 'minimax'
  | 'custom';
type CustomProtocol = 'openai-chat' | 'openai-responses';
export type OutputContract = 'concise' | 'json' | 'code' | 'choice' | 'free';
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
type MessageRole = 'user' | 'assistant' | 'system';

export interface ProviderCapabilities {
  responses: boolean;
  webSearch: boolean;
  reasoning: boolean;
  reasoningEffort: boolean;
  promptCache: boolean;
  batch: boolean;
  structuredOutput: boolean;
  vision?: boolean;
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
  protocol?: CustomProtocol;
  contextWindow: number;
  capabilities: ProviderCapabilities;
  hasEncryptedKey?: boolean;
}

export interface TokenTelemetry {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  actualTotal?: number;
  estimatedBaseline: number;
  estimatedSent: number;
  estimatedSaved: number;
  source: 'provider' | 'estimated';
  tokenizer?: 'provider' | 'tiktoken' | 'heuristic';
  savings?: TokenSavingsBreakdown;
}

export interface TokenSavingsBreakdown {
  promptCompression: number;
  contextPruning: number;
  jitRetrieval: number;
  semanticCache: number;
  promptCache: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'document';
  dataUrl?: string;
  text?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  telemetry?: TokenTelemetry;
  routeReason?: string;
  citations?: KnowledgeCitation[];
  rawPrompt?: string;
  reasoningContent?: string;
  reasoningSource?: 'provider' | 'glm';
  attachments?: ChatAttachment[];
}

export interface ConversationMemory {
  summary: string;
  facts: string[];
  preferences: string[];
  openTasks: string[];
  constraints: string[];
  citations: string[];
  compressedThroughMessageId?: string;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  memory: ConversationMemory;
  systemPrompt: string;
  providerProfileId: string;
  createdAt: number;
  updatedAt: number;
}

interface FewShotExample {
  id: string;
  input: string;
  output: string;
}

export interface OptimizationSettings {
  ruleCompression: boolean;
  removePoliteness: boolean;
  structuredPrompt: boolean;
  chipProtocol: boolean;
  concisePersona: boolean;
  automaticContextCompression: boolean;
  promptCache: boolean;
  semanticCache: boolean;
  semanticHitEnhancement: boolean;
  modelRouting: boolean;
  jitRetrieval: boolean;
  toonStructured: boolean;
  extremeMode: boolean;
  outputContract: OutputContract;
  maxCompletionTokens: number;
  stopSequences: string[];
  temperature: number;
  topP: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  retrievalTopK: number;
  compressionThreshold: number;
  fewShotExamples: FewShotExample[];
  simpleProfileId?: string;
  complexProfileId?: string;
  pinModel: boolean;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  chunkCount: number;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  documentName: string;
  index: number;
  text: string;
  terms: string[];
}

export interface KnowledgeCitation {
  chunkId: string;
  documentName: string;
  excerpt: string;
  score: number;
  sourceType?: 'knowledge' | 'attachment' | 'web';
  url?: string;
  title?: string;
}

export interface ChatRequest {
  conversationId: string;
  profile: ProviderProfile;
  messages: Array<Pick<ChatMessage, 'role' | 'content' | 'attachments'>>;
  systemPrompt: string;
  settings: OptimizationSettings;
  estimatedBaseline: number;
  estimatedSent: number;
  citations: KnowledgeCitation[];
  savings?: TokenSavingsBreakdown;
  tokenizer?: 'tiktoken' | 'heuristic';
}

export interface GlmQueueStatus {
  requestId: string;
  state: 'waiting' | 'running' | 'completed' | 'failed' | 'personal';
  operation: string;
  position: number;
  queuedAt: number;
  estimatedWaitMs: number;
  poolExhausted?: boolean;
}

export type StreamEvent =
  | { type: 'meta'; routeReason?: string; citations?: KnowledgeCitation[] }
  | { type: 'queue'; status: GlmQueueStatus }
  | { type: 'delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'usage'; telemetry: TokenTelemetry }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface SemanticCacheEntry {
  id: string;
  conversationId: string;
  fingerprint: string;
  prompt: string;
  answer: string;
  createdAt: number;
}
