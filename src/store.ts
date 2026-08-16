import { create } from 'zustand';
import { DEFAULT_PROFILES, DEFAULT_SETTINGS } from './config';
import { db } from './lib/db';
import { applyExtremeMode } from './lib/optimization';
import type {
  ChatMessage,
  Conversation,
  ConversationMemory,
  OptimizationSettings,
  ProviderProfile,
} from './types';

export type WorkspaceView = 'chat' | 'knowledge' | 'batch' | 'admin';

const EMPTY_MEMORY: ConversationMemory = {
  summary: '',
  facts: [],
  preferences: [],
  openTasks: [],
  constraints: [],
  citations: [],
  updatedAt: Date.now(),
};

function createConversation(profileId = DEFAULT_PROFILES[0].id): Conversation {
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
  };
}

interface AppState {
  initialized: boolean;
  conversations: Conversation[];
  profiles: ProviderProfile[];
  activeConversationId: string;
  lastProfileId: string;
  settings: OptimizationSettings;
  beforeExtreme?: OptimizationSettings;
  view: WorkspaceView;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  adminToken?: string;
  initialize: () => Promise<void>;
  createConversation: () => Promise<string>;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  updateConversation: (id: string, patch: Partial<Conversation>) => Promise<void>;
  appendMessage: (conversationId: string, message: ChatMessage) => Promise<void>;
  updateSettings: (patch: Partial<OptimizationSettings>) => Promise<void>;
  toggleExtreme: (enabled: boolean) => Promise<void>;
  saveProfile: (profile: ProviderProfile) => Promise<void>;
  setView: (view: WorkspaceView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAdminToken: (token?: string) => void;
}

async function persistConversation(conversation: Conversation): Promise<void> {
  await db.conversations.put(conversation);
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  conversations: [],
  profiles: DEFAULT_PROFILES,
  activeConversationId: '',
  lastProfileId: DEFAULT_PROFILES[0].id,
  settings: DEFAULT_SETTINGS,
  view: 'chat',
  sidebarOpen: false,
  settingsOpen: false,
  adminToken: typeof sessionStorage === 'undefined' ? undefined : sessionStorage.getItem('stingy-admin-token') ?? undefined,

  initialize: async () => {
    if (get().initialized) return;
    const [storedConversations, storedProfiles, settingsRecord] = await Promise.all([
      db.conversations.orderBy('updatedAt').reverse().toArray(),
      db.profiles.toArray(),
      db.settings.get('global'),
    ]);
    const defaultIds = new Set(DEFAULT_PROFILES.map((profile) => profile.id));
    const storedById = new Map(storedProfiles.map((profile) => [profile.id, profile]));
    const nativeProfiles = DEFAULT_PROFILES.map((profile) => {
      const stored = storedById.get(profile.id);
      return stored ? { ...profile, model: stored.model, hasEncryptedKey: stored.hasEncryptedKey } : profile;
    });
    const customProfiles = storedProfiles.filter((profile) => !defaultIds.has(profile.id));
    const profiles = [...nativeProfiles, ...customProfiles];
    await db.profiles.bulkPut(nativeProfiles);
    let conversations = storedConversations;
    if (!conversations.length) {
      const conversation = createConversation(profiles[0].id);
      conversations = [conversation];
      await persistConversation(conversation);
    }
    const rememberedProfileId = localStorage.getItem('stingy-last-profile');
    const lastProfileId = profiles.some((profile) => profile.id === rememberedProfileId)
      ? rememberedProfileId!
      : conversations[0]?.providerProfileId ?? profiles[0].id;
    set({
      initialized: true,
      profiles,
      conversations,
      activeConversationId: conversations[0].id,
      lastProfileId,
      settings: { ...DEFAULT_SETTINGS, ...(settingsRecord?.value ?? {}) },
      beforeExtreme: settingsRecord?.beforeExtreme,
    });
  },

  createConversation: async () => {
    const state = get();
    const profileId = state.profiles.some((profile) => profile.id === state.lastProfileId)
      ? state.lastProfileId
      : state.profiles[0]?.id ?? DEFAULT_PROFILES[0].id;
    const conversation = createConversation(profileId);
    await persistConversation(conversation);
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      view: 'chat',
      sidebarOpen: false,
    }));
    return conversation.id;
  },

  selectConversation: (id) => set({ activeConversationId: id, view: 'chat', sidebarOpen: false }),

  deleteConversation: async (id) => {
    const remaining = get().conversations.filter((conversation) => conversation.id !== id);
    await db.conversations.delete(id);
    await db.cache.where('conversationId').equals(id).delete();
    if (!remaining.length) {
      const conversation = createConversation(get().profiles[0]?.id);
      await persistConversation(conversation);
      set({ conversations: [conversation], activeConversationId: conversation.id });
      return;
    }
    set({
      conversations: remaining,
      activeConversationId:
        get().activeConversationId === id ? remaining[0].id : get().activeConversationId,
    });
  },

  updateConversation: async (id, patch) => {
    const current = get().conversations.find((conversation) => conversation.id === id);
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: Date.now() };
    await persistConversation(updated);
    if (patch.providerProfileId) localStorage.setItem('stingy-last-profile', patch.providerProfileId);
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => (conversation.id === id ? updated : conversation))
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
      lastProfileId: patch.providerProfileId ?? state.lastProfileId,
    }));
  },

  appendMessage: async (conversationId, message) => {
    const current = get().conversations.find((conversation) => conversation.id === conversationId);
    if (!current) return;
    const firstUserMessage = current.messages.length === 0 && message.role === 'user';
    const updated: Conversation = {
      ...current,
      title: firstUserMessage ? message.content.slice(0, 24) || '新对话' : current.title,
      messages: [...current.messages, message],
      updatedAt: Date.now(),
    };
    await persistConversation(updated);
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => (conversation.id === conversationId ? updated : conversation))
        .toSorted((a, b) => b.updatedAt - a.updatedAt),
    }));
  },

  updateSettings: async (patch) => {
    const value = { ...get().settings, ...patch };
    await db.settings.put({ id: 'global', value, beforeExtreme: get().beforeExtreme });
    set({ settings: value });
  },

  toggleExtreme: async (enabled) => {
    const state = get();
    const value = enabled
      ? applyExtremeMode(state.settings, true)
      : { ...(state.beforeExtreme ?? DEFAULT_SETTINGS), extremeMode: false };
    const beforeExtreme = enabled ? { ...state.settings, extremeMode: false } : undefined;
    await db.settings.put({ id: 'global', value, beforeExtreme });
    set({
      settings: value,
      beforeExtreme,
    });
  },

  saveProfile: async (profile) => {
    await db.profiles.put(profile);
    set((state) => ({
      profiles: state.profiles.some((item) => item.id === profile.id)
        ? state.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...state.profiles, profile],
    }));
  },

  setView: (view) => set({ view, sidebarOpen: false }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAdminToken: (adminToken) => {
    if (typeof sessionStorage !== 'undefined') {
      if (adminToken) sessionStorage.setItem('stingy-admin-token', adminToken);
      else sessionStorage.removeItem('stingy-admin-token');
    }
    set({ adminToken, view: adminToken ? 'admin' : 'chat', sidebarOpen: false });
  },
}));
