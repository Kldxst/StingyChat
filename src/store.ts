import { create } from 'zustand';
import { ANONYMOUS_SETTINGS, DEFAULT_PROFILES, DEFAULT_SETTINGS } from './config';
import { db } from './lib/db';
import { applyExtremeMode } from './lib/optimization';
import type {
  AuthSessionState,
  ChatMessage,
  Conversation,
  ConversationMemory,
  OptimizationSettings,
  ProviderProfile,
  SyncStatus,
  UserPreferencesEnvelope,
  DataExportBundle,
} from './types';
import type { FavoriteModel } from './types';
import { loadFavoriteModels, saveFavoriteModels } from './lib/preferences';
import { getAuthSession, getUserPreferences, logoutUser } from './lib/auth';
import { drainConversationSync, observeCloudConversation, observeCloudSync, pullCloudConversations, queueConversationSync } from './lib/cloudSync';
import { schedulePreferenceSync } from './lib/preferenceSync';

export type WorkspaceView = 'chat' | 'project' | 'knowledge' | 'batch' | 'admin';

const EMPTY_MEMORY: ConversationMemory = {
  summary: '',
  facts: [],
  preferences: [],
  openTasks: [],
  constraints: [],
  citations: [],
  updatedAt: Date.now(),
};

function createConversation(profileId = DEFAULT_PROFILES[0].id, namespace = 'anonymous'): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: [],
    memory: { ...EMPTY_MEMORY, updatedAt: now },
    systemPrompt: '你是一个准确、直接的 AI 助手。',
    providerProfileId: profileId,
    createdAt: now,
    updatedAt: now,
    namespace,
    revision: 0,
    syncState: namespace === 'anonymous' ? 'local-only' : 'pending',
  };
}

function normalizeProfile(profile: ProviderProfile): ProviderProfile {
  return {
    ...profile,
    contextWindow: Number.isFinite(profile.contextWindow) ? Math.max(1_024, Math.round(profile.contextWindow)) : 128_000,
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

function normalizeConversation(conversation: Conversation, fallbackProfileId: string): Conversation {
  const now = Date.now();
  const memory = conversation.memory ?? EMPTY_MEMORY;
  return {
    ...conversation,
    id: String(conversation.id || crypto.randomUUID()),
    title: String(conversation.title || '新对话').slice(0, 100),
    messages: Array.isArray(conversation.messages) ? conversation.messages.flatMap((message) => (
      message && ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string'
        ? [{ ...message, id: String(message.id || crypto.randomUUID()), createdAt: Number(message.createdAt) || now }]
        : []
    )) : [],
    memory: {
      ...EMPTY_MEMORY,
      ...memory,
      facts: Array.isArray(memory.facts) ? memory.facts.map(String) : [],
      preferences: Array.isArray(memory.preferences) ? memory.preferences.map(String) : [],
      openTasks: Array.isArray(memory.openTasks) ? memory.openTasks.map(String) : [],
      constraints: Array.isArray(memory.constraints) ? memory.constraints.map(String) : [],
      citations: Array.isArray(memory.citations) ? memory.citations.map(String) : [],
      updatedAt: Number(memory.updatedAt) || now,
    },
    systemPrompt: String(conversation.systemPrompt || '你是一个准确、直接的 AI 助手。'),
    providerProfileId: String(conversation.providerProfileId || fallbackProfileId),
    createdAt: Number(conversation.createdAt) || now,
    updatedAt: Number(conversation.updatedAt) || now,
    titleGenerated: Boolean(conversation.titleGenerated),
  };
}

interface AppState {
  initialized: boolean;
  conversations: Conversation[];
  profiles: ProviderProfile[];
  favoriteModels: FavoriteModel[];
  activeConversationId: string;
  lastProfileId: string;
  projectProfileId: string;
  settings: OptimizationSettings;
  auth: AuthSessionState;
  preferencesVersion: number;
  personalization?: UserPreferencesEnvelope['personalization'];
  beforeExtreme?: OptimizationSettings;
  view: WorkspaceView;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  artifactPanelOpen: boolean;
  activeArtifactId?: string;
  settingsOpen: boolean;
  namespace: string;
  syncStatus: SyncStatus;
  syncDetail?: string;
  initialize: () => Promise<void>;
  createConversation: () => Promise<string>;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  updateConversation: (id: string, patch: Partial<Conversation>) => Promise<void>;
  appendMessage: (conversationId: string, message: ChatMessage) => Promise<void>;
  appendMessages: (conversationId: string, messages: ChatMessage[]) => Promise<void>;
  updateSettings: (patch: Partial<OptimizationSettings>) => Promise<void>;
  toggleExtreme: (enabled: boolean) => Promise<void>;
  saveProfile: (profile: ProviderProfile) => Promise<void>;
  addFavoriteModel: (favorite: FavoriteModel) => void;
  removeFavoriteModel: (id: string) => void;
  setView: (view: WorkspaceView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setArtifactPanelOpen: (open: boolean) => void;
  setActiveArtifact: (id?: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setProjectProfileId: (profileId: string) => void;
  applyPreferences: (value: UserPreferencesEnvelope) => void;
  importData: (bundle: DataExportBundle) => Promise<{ added: number; updated: number }>;
  logout: () => Promise<void>;
}

async function persistConversation(conversation: Conversation): Promise<void> {
  await db.conversations.put(conversation);
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  conversations: [],
  profiles: DEFAULT_PROFILES,
  favoriteModels: loadFavoriteModels(DEFAULT_PROFILES),
  activeConversationId: '',
  lastProfileId: DEFAULT_PROFILES[0].id,
  projectProfileId: DEFAULT_PROFILES[0].id,
  settings: ANONYMOUS_SETTINGS,
  auth: { authenticated: false },
  preferencesVersion: 0,
  view: typeof location !== 'undefined' && location.pathname === '/project' ? 'project' : 'chat',
  sidebarOpen: false,
  sidebarCollapsed: typeof localStorage === 'undefined' ? false : localStorage.getItem('stingy-sidebar-collapsed') === 'true',
  artifactPanelOpen: false,
  settingsOpen: false,
  namespace: 'anonymous',
  syncStatus: 'idle',

  initialize: async () => {
    if (get().initialized) return;
    const [storedProfiles, settingsRecord, auth] = await Promise.all([
      db.profiles.toArray(),
      db.settings.get('global'),
      getAuthSession().catch((): AuthSessionState => ({ authenticated: false })),
    ]);
    const namespace = auth.user ? `user:${auth.user.id}` : 'anonymous';
    if (auth.user) {
      const anonymous = await db.conversations.filter((item) => !item.namespace || item.namespace === 'anonymous').toArray();
      for (const conversation of anonymous) {
        await db.conversations.update(conversation.id, { namespace, syncState: 'pending', revision: 0 });
        await queueConversationSync(namespace, conversation.id, 'upsert');
      }
    }
    const storedConversations = await db.conversations.where('namespace').equals(namespace).reverse().sortBy('updatedAt');
    const remotePreferences = auth.authenticated ? await getUserPreferences().catch(() => undefined) : undefined;
    const defaultIds = new Set(DEFAULT_PROFILES.map((profile) => profile.id));
    const storedById = new Map(storedProfiles.map((profile) => [profile.id, profile]));
    const nativeProfiles = DEFAULT_PROFILES.map((profile) => {
      const stored = storedById.get(profile.id);
      return stored ? { ...profile, model: stored.model, hasEncryptedKey: stored.hasEncryptedKey } : profile;
    });
    const customProfiles = storedProfiles.filter((profile) => !defaultIds.has(profile.id)).map(normalizeProfile);
    const profiles = [...nativeProfiles.map(normalizeProfile), ...customProfiles];
    await db.profiles.bulkPut(nativeProfiles);
    let conversations = storedConversations.map((conversation) => normalizeConversation(
      conversation,
      profiles.some((profile) => profile.id === conversation.providerProfileId) ? conversation.providerProfileId : profiles[0].id,
    ));
    if (!conversations.length) {
      const conversation = createConversation(profiles[0].id, namespace);
      conversations = [conversation];
      await persistConversation(conversation);
    }
    const rememberedProfileId = localStorage.getItem('stingy-last-profile');
    const lastProfileId = profiles.some((profile) => profile.id === rememberedProfileId)
      ? rememberedProfileId!
      : conversations[0]?.providerProfileId ?? profiles[0].id;
    const rememberedProjectProfileId = localStorage.getItem('stingy-project-profile');
    const projectProfileId = profiles.some((profile) => profile.id === rememberedProjectProfileId)
      ? rememberedProjectProfileId!
      : lastProfileId;
    set({
      initialized: true,
      profiles,
      favoriteModels: remotePreferences?.favoriteModels.length ? remotePreferences.favoriteModels : loadFavoriteModels(profiles),
      conversations,
      activeConversationId: conversations[0].id,
      lastProfileId,
      projectProfileId,
      settings: auth.authenticated ? { ...DEFAULT_SETTINGS, ...(remotePreferences?.settings ?? settingsRecord?.value ?? {}) } : { ...ANONYMOUS_SETTINGS },
      beforeExtreme: settingsRecord?.beforeExtreme,
      auth,
      preferencesVersion: remotePreferences?.version ?? 0,
      personalization: remotePreferences?.personalization,
      namespace,
    });
    observeCloudSync((syncStatus, syncDetail) => set({ syncStatus, syncDetail }));
    observeCloudConversation((changed, id) => set((state) => ({ conversations: changed
      ? state.conversations.map((item) => item.id === id ? changed : item).toSorted((a, b) => b.updatedAt - a.updatedAt)
      : state.conversations.filter((item) => item.id !== id) })));
    if (auth.user) queueMicrotask(() => void pullCloudConversations(namespace).then((items) => {
      if (get().namespace === namespace && items.length) set({ conversations: items.map((item) => normalizeConversation(item, profiles[0].id)) });
      void drainConversationSync(namespace);
    }));
  },

  createConversation: async () => {
    const state = get();
    const profileId = state.profiles.some((profile) => profile.id === state.lastProfileId)
      ? state.lastProfileId
      : state.profiles[0]?.id ?? DEFAULT_PROFILES[0].id;
    const conversation = createConversation(profileId, state.namespace);
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      view: 'chat',
      sidebarOpen: false,
    }));
    queueMicrotask(() => void persistConversation(conversation).then(() => queueConversationSync(state.namespace, conversation.id, 'upsert')));
    return conversation.id;
  },

  selectConversation: (id) => set({ activeConversationId: id, view: 'chat', sidebarOpen: false }),

  deleteConversation: async (id) => {
    const state = get(); const remaining = state.conversations.filter((conversation) => conversation.id !== id);
    set({ conversations: remaining, activeConversationId: state.activeConversationId === id ? remaining[0]?.id ?? '' : state.activeConversationId });
    queueMicrotask(() => void Promise.all([db.conversations.delete(id), db.cache.where('conversationId').equals(id).delete()]).then(() => queueConversationSync(state.namespace, id, 'delete')));
    if (!remaining.length) {
      const conversation = createConversation(get().profiles[0]?.id, state.namespace);
      set({ conversations: [conversation], activeConversationId: conversation.id });
      queueMicrotask(() => void persistConversation(conversation).then(() => queueConversationSync(state.namespace, conversation.id, 'upsert')));
      return;
    }
  },

  updateConversation: async (id, patch) => {
    const current = get().conversations.find((conversation) => conversation.id === id);
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: Date.now(), syncState: get().namespace === 'anonymous' ? 'local-only' as const : 'pending' as const };
    if (patch.providerProfileId) localStorage.setItem('stingy-last-profile', patch.providerProfileId);
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => (conversation.id === id ? updated : conversation))
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
      lastProfileId: patch.providerProfileId ?? state.lastProfileId,
    }));
    queueMicrotask(() => void persistConversation(updated).then(() => queueConversationSync(get().namespace, id, 'upsert')));
  },

  appendMessage: async (conversationId, message) => {
    const current = get().conversations.find((conversation) => conversation.id === conversationId);
    if (!current) return;
    const updated: Conversation = {
      ...current,
      messages: [...current.messages, message],
      updatedAt: Date.now(),
      syncState: get().namespace === 'anonymous' ? 'local-only' : 'pending',
    };
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => (conversation.id === conversationId ? updated : conversation))
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
    }));
    queueMicrotask(() => void persistConversation(updated).then(() => queueConversationSync(get().namespace, conversationId, 'upsert')));
  },

  appendMessages: async (conversationId, messages) => {
    if (!messages.length) return;
    const current = get().conversations.find((conversation) => conversation.id === conversationId);
    if (!current) return;
    const updated: Conversation = {
      ...current,
      messages: [...current.messages, ...messages],
      updatedAt: Date.now(),
      syncState: get().namespace === 'anonymous' ? 'local-only' : 'pending',
    };
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => (conversation.id === conversationId ? updated : conversation))
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
    }));
    queueMicrotask(() => void persistConversation(updated).then(() => queueConversationSync(get().namespace, conversationId, 'upsert')));
  },

  updateSettings: async (patch) => {
    if (!get().auth.authenticated) {
      if (Object.keys(patch).length === 1 && patch.theme) {
        const value = { ...get().settings, theme: patch.theme };
        set({ settings: value });
        queueMicrotask(() => void db.settings.put({ id: 'global', value }));
      }
      return;
    }
    const value = { ...get().settings, ...patch };
    set({ settings: value });
    queueMicrotask(() => void db.settings.put({ id: 'global', value, beforeExtreme: get().beforeExtreme }));
    schedulePreferenceSync(patch,
      () => ({ version: get().preferencesVersion, settings: get().settings, favoriteModels: get().favoriteModels, personalization: get().personalization, onboardingStatus: get().auth.user?.onboardingStatus ?? 'complete', updatedAt: Date.now() }),
      (saved) => set({ settings: saved.settings, preferencesVersion: saved.version, personalization: saved.personalization, favoriteModels: saved.favoriteModels }),
      (syncStatus, syncDetail) => set({ syncStatus, syncDetail }),
    );
  },

  toggleExtreme: async (enabled) => {
    if (!get().auth.authenticated) return;
    const state = get();
    const value = enabled
      ? applyExtremeMode(state.settings, true)
      : { ...(state.beforeExtreme ?? DEFAULT_SETTINGS), extremeMode: false };
    const beforeExtreme = enabled ? { ...state.settings, extremeMode: false } : undefined;
    set({ beforeExtreme });
    await get().updateSettings(value);
  },

  saveProfile: async (profile) => {
    await db.profiles.put(profile);
    set((state) => ({
      profiles: state.profiles.some((item) => item.id === profile.id)
        ? state.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...state.profiles, profile],
    }));
  },

  addFavoriteModel: (favorite) => set((state) => {
    if (state.favoriteModels.some((item) => item.id === favorite.id)) return state;
    const favoriteModels = [...state.favoriteModels, favorite].slice(0, 24);
    saveFavoriteModels(favoriteModels);
    queueMicrotask(() => { if (get().auth.authenticated) void get().updateSettings({}); });
    return { favoriteModels };
  }),

  removeFavoriteModel: (id) => set((state) => {
    const favoriteModels = state.favoriteModels.filter((item) => item.id !== id);
    saveFavoriteModels(favoriteModels);
    queueMicrotask(() => { if (get().auth.authenticated) void get().updateSettings({}); });
    return { favoriteModels };
  }),

  setView: (view) => {
    if (typeof history !== 'undefined') {
      const target = view === 'project' ? '/project' : '/';
      if (location.pathname !== target) history.pushState({ view }, '', target);
    }
    set({ view, sidebarOpen: false });
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('stingy-sidebar-collapsed', String(sidebarCollapsed));
    set({ sidebarCollapsed });
  },
  setArtifactPanelOpen: (artifactPanelOpen) => set({ artifactPanelOpen }),
  setActiveArtifact: (activeArtifactId) => set({ activeArtifactId, artifactPanelOpen: Boolean(activeArtifactId) }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setProjectProfileId: (projectProfileId) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('stingy-project-profile', projectProfileId);
    set({ projectProfileId });
  },
  applyPreferences: (value) => {
    set((state) => ({
      settings: value.settings,
      favoriteModels: value.favoriteModels,
      preferencesVersion: value.version,
      personalization: value.personalization,
      auth: state.auth.user ? { authenticated: true, user: { ...state.auth.user, onboardingStatus: value.onboardingStatus } } : state.auth,
    }));
  },
  importData: async (bundle) => {
    const state = get(); const byId = new Map(state.conversations.map((item) => [item.id, item])); let added = 0; let updated = 0;
    for (const incoming of bundle.conversations) {
      const normalized = { ...normalizeConversation(incoming, state.profiles[0].id), namespace: state.namespace, syncState: state.namespace === 'anonymous' ? 'local-only' as const : 'pending' as const };
      const current = byId.get(normalized.id);
      if (!current) { byId.set(normalized.id, normalized); added += 1; }
      else if (normalized.updatedAt > current.updatedAt) { byId.set(normalized.id, { ...normalized, revision: current.revision ?? 0 }); updated += 1; }
    }
    const conversations = [...byId.values()].toSorted((a, b) => b.updatedAt - a.updatedAt);
    set({ conversations, settings: state.auth.authenticated ? { ...state.settings, ...bundle.settings } : state.settings, favoriteModels: bundle.favoriteModels.length ? bundle.favoriteModels : state.favoriteModels, personalization: bundle.personalization ?? state.personalization });
    await db.conversations.bulkPut(conversations);
    for (const conversation of conversations) if (state.namespace !== 'anonymous') await queueConversationSync(state.namespace, conversation.id, 'upsert');
    if (state.auth.authenticated) await get().updateSettings(bundle.settings);
    return { added, updated };
  },
  logout: async () => {
    await logoutUser();
    let conversations = await db.conversations.where('namespace').equals('anonymous').reverse().sortBy('updatedAt');
    if (!conversations.length) { const conversation = createConversation(get().profiles[0]?.id, 'anonymous'); await persistConversation(conversation); conversations = [conversation]; }
    set({ auth: { authenticated: false }, namespace: 'anonymous', conversations, activeConversationId: conversations[0].id, settings: { ...ANONYMOUS_SETTINGS }, preferencesVersion: 0, personalization: undefined, view: 'chat', syncStatus: 'idle' });
  },
}));
