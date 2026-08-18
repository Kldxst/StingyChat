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
export type ThemePreference = 'system' | 'light' | 'dark';
export type UserRole = 'owner' | 'admin' | 'support' | 'member';
export type UserStatus = 'active' | 'suspended';
export type FeaturePermission =
  | 'skills'
  | 'smart_assist'
  | 'reasoning'
  | 'web_search'
  | 'model_routing'
  | 'batch'
  | 'history_sync'
  | 'project_mode'
  | 'project_full_access'
  | 'plugin_install'
  | 'plugin_source_manage'
  | 'mcp_connect'
  | 'admin_users_read'
  | 'admin_users_write'
  | 'admin_restrictions_read'
  | 'admin_restrictions_write'
  | 'admin_usage_read'
  | 'admin_audit_read'
  | 'admin_chat_read'
  | 'admin_owner_actions';

export type ProjectPermissionMode = 'read' | 'workspace' | 'full';
export type PluginFormat = 'stingy' | 'codex-agent-plugin' | 'dsh-bundle' | 'mcp' | 'agent-skill';
export type PluginCompatibility = 'native' | 'bridge' | 'partial' | 'unavailable';
export type PluginPermission = 'files:read' | 'files:write' | 'command:execute' | 'network' | 'credentials' | 'mcp' | 'hooks' | 'git' | 'ui';

export interface ProjectWorkspace {
  id: string;
  namespace: string;
  name: string;
  permissionMode: ProjectPermissionMode;
  rootHandle?: FileSystemDirectoryHandle;
  fallback: boolean;
  activeFilePath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  language: string;
  size: number;
  updatedAt: number;
}

export interface ProjectCheckpoint {
  id: string;
  projectId: string;
  label: string;
  files: Array<Pick<ProjectFile, 'path' | 'content' | 'language'>>;
  createdAt: number;
}

export interface ProjectToolCall {
  id: string;
  name: string;
  status: 'waiting' | 'running' | 'paused' | 'completed' | 'failed';
  inputSummary: string;
  outputSummary?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  type: 'user' | 'assistant' | 'tool' | 'checkpoint' | 'error';
  content: string;
  toolCall?: ProjectToolCall;
  createdAt: number;
}

export interface PluginCompatibilityReport {
  level: PluginCompatibility;
  reasons: string[];
  requiresBridge: boolean;
  supportedFeatures: string[];
  unsupportedFeatures: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  format: PluginFormat;
  sourceUrl: string;
  sourceRef?: string;
  integrity?: string;
  license?: string;
  author?: string;
  permissions: PluginPermission[];
  compatibility: PluginCompatibilityReport;
  categories: string[];
  featured?: boolean;
}

export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  authority: 'official' | 'verified-community' | 'custom';
  enabled: boolean;
  updatedAt: number;
}

export interface PluginInstallRecord {
  id: string;
  pluginId: string;
  manifest: PluginManifest;
  enabled: boolean;
  installScope: 'global' | 'project';
  projectId?: string;
  installedAt: number;
  updatedAt: number;
  state: 'installed' | 'disabled' | 'update-available' | 'failed' | 'pending-device-install' | 'pending-configuration';
  previousManifest?: PluginManifest;
}

export interface ProjectPluginCapability {
  id: string;
  name: string;
  format: PluginFormat;
  description: string;
  supportedFeatures: string[];
}

export interface PreparationTrace {
  startedAt: number;
  acceptedAt: number;
  upstreamConnectedAt?: number;
  firstTokenAt?: number;
  phases: Array<{ name: string; startedAt: number; finishedAt?: number; status: 'running' | 'completed' | 'timed-out' | 'skipped' }>;
}

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

export interface FavoriteModel {
  id: string;
  profileId: string;
  model: string;
  label: string;
}

export interface PersonalAssistantConfig {
  baseUrl: string;
  model: string;
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
  contextSavedTokens?: number;
  cacheReuseTokens?: number;
  estimatedGrossSaved?: number;
  optimizationOverhead?: number;
  source: 'provider' | 'estimated';
  tokenizer?: 'provider' | 'tiktoken' | 'heuristic';
  savings?: TokenSavingsBreakdown;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  onboardingStatus: 'required' | 'pending' | 'complete';
  role: UserRole;
  permissions: FeaturePermission[];
  status: UserStatus;
  storageUsageBytes: number;
  storageQuotaBytes: number;
}

export interface AuthSessionState {
  authenticated: boolean;
  user?: AuthUser;
}

export interface OnboardingAnswers {
  useCase: string;
  expertise: 'beginner' | 'intermediate' | 'advanced';
  answerLength: 'brief' | 'balanced' | 'detailed';
  reasoningDepth: 'minimal' | 'balanced' | 'deep';
  tone: 'formal' | 'neutral' | 'friendly';
  structure: 'prose' | 'bullets' | 'steps';
  proactivity: 'low' | 'medium' | 'high';
  evidencePreference: 'none' | 'when-needed' | 'always';
  creativity: 'deterministic' | 'balanced' | 'creative';
  priority: 'speed' | 'cost' | 'quality';
}

export interface PersonalizationProfile {
  systemPromptPrefix: string;
  answerLength: OnboardingAnswers['answerLength'];
  tone: OnboardingAnswers['tone'];
  structure: OnboardingAnswers['structure'];
  proactivity: OnboardingAnswers['proactivity'];
  temperature: number;
  topP: number;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  citations: boolean;
  autoSkills: boolean;
  optimizationPreset: 'balanced' | 'efficient' | 'quality';
}

export interface UserPreferencesEnvelope {
  version: number;
  settings: OptimizationSettings;
  favoriteModels: FavoriteModel[];
  personalization?: PersonalizationProfile;
  onboardingStatus: AuthUser['onboardingStatus'];
  onboardingAnswers?: OnboardingAnswers;
  updatedAt: number;
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

export interface GeneratedArtifact {
  id: string;
  sourceMessageId: string;
  name: string;
  language: string;
  mimeType: string;
  content: string;
}

export interface SkillExecution {
  id: string;
  name: string;
  source: string;
  phase: 'preflight' | 'postflight';
  status: 'completed' | 'failed';
  summary: string;
  durationMs: number;
}

export interface ClientRuntimeContext {
  nowIso: string;
  localTime: string;
  timeZone: string;
  locale: string;
  utcOffsetMinutes: number;
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
  skillIds?: string[];
  skillExecutions?: SkillExecution[];
  artifacts?: GeneratedArtifact[];
  deliveryStatus?: 'preparing' | 'streaming' | 'sent' | 'failed' | 'cancelled';
  deliveryError?: string;
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
  titleGenerated?: boolean;
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
  titleGenerated?: boolean;
  namespace?: string;
  revision?: number;
  syncState?: 'synced' | 'pending' | 'local-only' | 'conflict';
}

export type SyncStatus = 'idle' | 'syncing' | 'pending' | 'offline' | 'error';

export interface DataExportBundle {
  schema: 'stingychat-export';
  version: 1;
  exportedAt: number;
  settings: OptimizationSettings;
  favoriteModels: FavoriteModel[];
  personalization?: PersonalizationProfile;
  conversations: Conversation[];
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
  autoSkills: boolean;
  theme: ThemePreference;
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
  clientContext?: ClientRuntimeContext;
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
  | { type: 'accepted'; requestId: string; at: number }
  | { type: 'preparing'; phase: string; at: number }
  | { type: 'upstream_connected'; at: number }
  | { type: 'first_token'; at: number }
  | { type: 'tool_call'; toolCall: ProjectToolCall }
  | { type: 'checkpoint'; checkpointId: string; label: string }
  | { type: 'plugin_status'; pluginId: string; status: string }
  | { type: 'timing'; trace: PreparationTrace }
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
