import { z } from 'zod';
import type { Conversation, DataExportBundle, FavoriteModel, OptimizationSettings, PersonalizationProfile, SyncStatus } from '../types';
import { db } from './db';

type StatusListener = (status: SyncStatus, detail?: string) => void;
let listener: StatusListener | undefined;
let conversationListener: ((conversation: Conversation | undefined, id: string) => void) | undefined;
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function notify(status: SyncStatus, detail?: string) { listener?.(status, detail); }
function request(path: string, init?: RequestInit) { return fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }

export function observeCloudSync(next: StatusListener): () => void { listener = next; return () => { if (listener === next) listener = undefined; }; }
export function observeCloudConversation(next: (conversation: Conversation | undefined, id: string) => void): () => void { conversationListener = next; return () => { if (conversationListener === next) conversationListener = undefined; }; }

export async function queueConversationSync(namespace: string, conversationId: string, operation: 'upsert' | 'delete'): Promise<void> {
  if (!namespace.startsWith('user:')) return;
  const previous = await db.conversationSync.where('[namespace+conversationId]').equals([namespace, conversationId]).first();
  if (previous?.id) await db.conversationSync.update(previous.id, { operation, updatedAt: Date.now() });
  else await db.conversationSync.add({ namespace, conversationId, operation, updatedAt: Date.now() });
  notify('pending'); queueMicrotask(() => void drainConversationSync(namespace));
}

function mergeConversation(local: Conversation, remote: Conversation): Conversation {
  const messages = new Map(remote.messages.map((message) => [message.id, message]));
  for (const message of local.messages) if (!messages.has(message.id) || message.createdAt >= (messages.get(message.id)?.createdAt ?? 0)) messages.set(message.id, message);
  const newer = local.updatedAt >= remote.updatedAt ? local : remote;
  return { ...newer, messages: [...messages.values()].toSorted((a, b) => a.createdAt - b.createdAt), revision: remote.revision ?? 0, syncState: 'pending', namespace: local.namespace };
}

export async function drainConversationSync(namespace: string): Promise<void> {
  if (draining || !navigator.onLine || !namespace.startsWith('user:')) { if (!navigator.onLine) notify('offline'); return; }
  draining = true; notify('syncing');
  try {
    while (true) {
      const item = await db.conversationSync.where('namespace').equals(namespace).sortBy('updatedAt').then((items) => items[0]);
      if (!item?.id) break;
      const conversation = await db.conversations.get(item.conversationId);
      const response = item.operation === 'delete'
        ? await request(`/api/conversations/${encodeURIComponent(item.conversationId)}`, { method: 'DELETE' })
        : conversation ? await request(`/api/conversations/${encodeURIComponent(item.conversationId)}`, { method: 'PUT', body: JSON.stringify({ baseRevision: conversation.revision ?? 0, conversation }) }) : new Response(null, { status: 204 });
      if (response.status === 409 && conversation) {
        const payload = await response.json() as { latest: Conversation };
        const merged = mergeConversation(conversation, payload.latest); await db.conversations.put(merged); conversationListener?.(merged, merged.id); continue;
      }
      if (response.status === 410) { await db.conversations.delete(item.conversationId); conversationListener?.(undefined, item.conversationId); }
      else if (response.status === 413) { if (conversation) await db.conversations.update(conversation.id, { syncState: 'local-only' }); notify('error', '云端历史空间已满'); await db.conversationSync.delete(item.id); continue; }
      else if (!response.ok) throw new Error(`同步失败 (${response.status})`);
      else if (conversation && item.operation === 'upsert' && response.status !== 204) {
        const payload = await response.json() as { revision: number }; const synced = { ...conversation, revision: payload.revision, syncState: 'synced' as const }; await db.conversations.put(synced); conversationListener?.(synced, synced.id);
      }
      await db.conversationSync.delete(item.id);
    }
    notify('idle');
  } catch (error) {
    notify(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : '同步失败');
    clearTimeout(retryTimer); retryTimer = setTimeout(() => void drainConversationSync(namespace), 5_000);
  } finally { draining = false; }
}

export async function pullCloudConversations(namespace: string): Promise<Conversation[]> {
  const index = await request('/api/conversations?limit=200'); if (!index.ok) return [];
  const data = await index.json() as { items: Array<{ id: string }>; tombstones: Array<{ conversation_id: string }> };
  for (const tombstone of data.tombstones) await db.conversations.delete(tombstone.conversation_id);
  const remote = (await Promise.all(data.items.map(async ({ id }) => {
    const response = await request(`/api/conversations/${encodeURIComponent(id)}`); return response.ok ? response.json() as Promise<Conversation> : undefined;
  }))).filter((item): item is Conversation => Boolean(item));
  for (const conversation of remote) {
    const local = await db.conversations.get(conversation.id);
    await db.conversations.put(local ? mergeConversation(local, { ...conversation, namespace }) : { ...conversation, namespace, syncState: 'synced' });
  }
  return db.conversations.where('namespace').equals(namespace).reverse().sortBy('updatedAt');
}

const exportSchema = z.object({ schema: z.literal('stingychat-export'), version: z.literal(1), exportedAt: z.number(), settings: z.record(z.string(), z.unknown()), favoriteModels: z.array(z.record(z.string(), z.unknown())), personalization: z.record(z.string(), z.unknown()).optional(), conversations: z.array(z.record(z.string(), z.unknown())) });

function sanitizeConversationForExport(conversation: Conversation): Conversation {
  return { ...conversation, messages: conversation.messages.map((message) => ({ ...message, attachments: message.attachments?.map(({ dataUrl: _dataUrl, ...attachment }) => attachment) })) };
}
export function createDataExport(settings: OptimizationSettings, favoriteModels: FavoriteModel[], personalization: PersonalizationProfile | undefined, conversations: Conversation[]): DataExportBundle {
  return { schema: 'stingychat-export', version: 1, exportedAt: Date.now(), settings, favoriteModels, personalization, conversations: conversations.map(sanitizeConversationForExport) };
}
export function validateDataImport(value: unknown): DataExportBundle { return exportSchema.parse(value) as unknown as DataExportBundle; }
