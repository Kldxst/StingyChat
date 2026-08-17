import { z } from 'zod';
import type { AuthUser, ChatMessage, Conversation, DataExportBundle, UserPreferencesEnvelope } from '../src/types';
import type { WorkerEnv } from './glm';

const CHUNK_BYTES = 128 * 1024;
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const messageSchema = z.object({
  id: z.string().min(1).max(200), role: z.enum(['user', 'assistant', 'system']), content: z.string().max(8_000_000),
  createdAt: z.number().finite(),
}).passthrough();
export const conversationSyncSchema = z.object({
  baseRevision: z.number().int().min(0).default(0),
  conversation: z.object({
    id: z.string().min(1).max(200), title: z.string().max(200), messages: z.array(messageSchema).max(10_000),
    memory: z.record(z.string(), z.unknown()), systemPrompt: z.string().max(200_000), providerProfileId: z.string().max(200),
    createdAt: z.number().finite(), updatedAt: z.number().finite(), titleGenerated: z.boolean().optional(),
  }).passthrough(),
});

function database(env: WorkerEnv): D1Database { const db = env.APP_DB ?? env.ADMIN_DB; if (!db) throw new Error('用户数据库尚未配置'); return db; }
function json<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function byteLength(value: string): number { return encoder.encode(value).byteLength; }

function stripMessage(message: ChatMessage): { message: ChatMessage; chunks: Array<{ payloadId: string; kind: 'attachment_text' | 'artifact'; content: string }> } {
  const chunks: Array<{ payloadId: string; kind: 'attachment_text' | 'artifact'; content: string }> = [];
  const attachments = message.attachments?.map(({ dataUrl: _binary, text, ...attachment }) => {
    if (text) chunks.push({ payloadId: attachment.id, kind: 'attachment_text', content: text });
    return { ...attachment, text: text ? `[cloud:${attachment.id}]` : undefined };
  });
  const artifacts = message.artifacts?.map(({ content, ...artifact }) => {
    chunks.push({ payloadId: artifact.id, kind: 'artifact', content });
    return { ...artifact, content: `[cloud:${artifact.id}]` };
  });
  return { message: { ...message, attachments, artifacts }, chunks };
}

function splitUtf8(value: string): string[] {
  if (byteLength(value) <= CHUNK_BYTES) return [value];
  const chunks: string[] = [];
  let current = '';
  for (const character of value) {
    if (byteLength(current + character) > CHUNK_BYTES) { chunks.push(current); current = character; } else current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function hydrateConversation(env: WorkerEnv, userId: string, row: Record<string, unknown>): Promise<Conversation> {
  const db = database(env);
  const [messageResult, chunkResult] = await Promise.all([
    db.prepare('SELECT * FROM cloud_messages WHERE user_id=? AND conversation_id=? ORDER BY created_at_ms').bind(userId, row.id).all<Record<string, unknown>>(),
    db.prepare('SELECT payload_id, kind, chunk_index, content FROM conversation_payload_chunks WHERE user_id=? AND conversation_id=? ORDER BY payload_id, chunk_index').bind(userId, row.id).all<Record<string, unknown>>(),
  ]);
  const payloads = new Map<string, string>();
  for (const chunk of chunkResult.results ?? []) payloads.set(String(chunk.payload_id), (payloads.get(String(chunk.payload_id)) ?? '') + String(chunk.content));
  const messages = (messageResult.results ?? []).map((messageRow) => {
    const payload = json<ChatMessage>(messageRow.payload_json, {} as ChatMessage);
    const attachments = payload.attachments?.map((attachment) => ({ ...attachment, text: payloads.get(attachment.id) ?? attachment.text }));
    const artifacts = payload.artifacts?.map((artifact) => ({ ...artifact, content: payloads.get(artifact.id) ?? artifact.content }));
    return { ...payload, id: String(messageRow.id), role: String(messageRow.role) as ChatMessage['role'], content: String(messageRow.content), createdAt: Number(messageRow.created_at_ms), attachments, artifacts };
  });
  return {
    id: String(row.id), title: String(row.title), messages, memory: json(row.memory_json, {} as Conversation['memory']),
    systemPrompt: String(row.system_prompt), providerProfileId: String(row.provider_profile_id), createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms), titleGenerated: Boolean(row.title_generated), revision: Number(row.revision), syncState: 'synced', namespace: `user:${userId}`,
  };
}

export async function listCloudConversations(env: WorkerEnv, user: AuthUser, cursor = 0, limit = 50) {
  const rows = await database(env).prepare(`SELECT id,title,provider_profile_id,created_at_ms,updated_at_ms,revision,size_bytes
    FROM cloud_conversations WHERE user_id=? AND updated_at_ms>? ORDER BY updated_at_ms LIMIT ?`).bind(user.id, cursor, Math.min(200, Math.max(1, limit))).all();
  const tombstones = await database(env).prepare('SELECT conversation_id,deleted_at_ms FROM conversation_tombstones WHERE user_id=? AND deleted_at_ms>?').bind(user.id, cursor).all();
  return { items: rows.results ?? [], tombstones: tombstones.results ?? [], cursor: Math.max(cursor, ...(rows.results ?? []).map((row) => Number(row.updated_at_ms)), ...(tombstones.results ?? []).map((row) => Number(row.deleted_at_ms))) };
}

export async function getCloudConversation(env: WorkerEnv, user: AuthUser, id: string): Promise<Conversation | undefined> {
  const row = await database(env).prepare('SELECT * FROM cloud_conversations WHERE user_id=? AND id=?').bind(user.id, id).first<Record<string, unknown>>();
  return row ? hydrateConversation(env, user.id, row) : undefined;
}

export async function syncCloudConversation(env: WorkerEnv, user: AuthUser, input: z.infer<typeof conversationSyncSchema>) {
  const db = database(env);
  const candidate = input.conversation as unknown as Conversation;
  const tombstone = await db.prepare('SELECT deleted_at_ms FROM conversation_tombstones WHERE user_id=? AND conversation_id=?').bind(user.id, candidate.id).first<{ deleted_at_ms: number }>();
  if (tombstone && Number(tombstone.deleted_at_ms) >= candidate.updatedAt) return { deleted: true as const };
  const existing = await db.prepare('SELECT revision,size_bytes FROM cloud_conversations WHERE user_id=? AND id=?').bind(user.id, candidate.id).first<{ revision: number; size_bytes: number }>();
  if (existing && Number(existing.revision) !== input.baseRevision) return { conflict: await getCloudConversation(env, user, candidate.id) };

  const stripped = candidate.messages.map(stripMessage);
  const metadata = JSON.stringify(candidate.memory ?? {});
  let totalBytes = byteLength(candidate.title + candidate.systemPrompt + metadata);
  const statements: D1PreparedStatement[] = [];
  for (const item of stripped) {
    const payload = JSON.stringify(item.message);
    const size = byteLength(item.message.content + payload);
    totalBytes += size;
    statements.push(db.prepare(`INSERT INTO cloud_messages (id,conversation_id,user_id,role,content,payload_json,created_at_ms,updated_at_ms,size_bytes)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET content=excluded.content,payload_json=excluded.payload_json,updated_at_ms=excluded.updated_at_ms,size_bytes=excluded.size_bytes`)
      .bind(item.message.id, candidate.id, user.id, item.message.role, item.message.content, payload, item.message.createdAt, candidate.updatedAt, size));
    for (const payloadItem of item.chunks) {
      splitUtf8(payloadItem.content).forEach((content, index) => {
        const chunkSize = byteLength(content); totalBytes += chunkSize;
        statements.push(db.prepare(`INSERT INTO conversation_payload_chunks (user_id,conversation_id,payload_id,kind,chunk_index,content,size_bytes,updated_at_ms)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,payload_id,chunk_index) DO UPDATE SET content=excluded.content,size_bytes=excluded.size_bytes,updated_at_ms=excluded.updated_at_ms`)
          .bind(user.id, candidate.id, payloadItem.payloadId, payloadItem.kind, index, content, chunkSize, candidate.updatedAt));
      });
    }
  }
  const quotaRow = await db.prepare('SELECT storage_usage_bytes,storage_quota_bytes FROM users WHERE id=?').bind(user.id).first<{ storage_usage_bytes: number; storage_quota_bytes: number }>();
  const quota = Number(quotaRow?.storage_quota_bytes ?? user.storageQuotaBytes); const projected = Number(quotaRow?.storage_usage_bytes ?? 0) - Number(existing?.size_bytes ?? 0) + totalBytes;
  if (projected > quota) return { quotaExceeded: true as const, projected, quota };
  const revision = Number(existing?.revision ?? 0) + 1;
  statements.unshift(db.prepare(`INSERT INTO cloud_conversations (id,user_id,title,system_prompt,provider_profile_id,memory_json,title_generated,revision,created_at_ms,updated_at_ms,size_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,system_prompt=excluded.system_prompt,provider_profile_id=excluded.provider_profile_id,memory_json=excluded.memory_json,title_generated=excluded.title_generated,revision=excluded.revision,updated_at_ms=excluded.updated_at_ms,size_bytes=excluded.size_bytes`)
    .bind(candidate.id, user.id, candidate.title, candidate.systemPrompt, candidate.providerProfileId, metadata, candidate.titleGenerated ? 1 : 0, revision, candidate.createdAt, candidate.updatedAt, totalBytes));
  statements.splice(1, 0,
    db.prepare('DELETE FROM conversation_payload_chunks WHERE user_id=? AND conversation_id=?').bind(user.id, candidate.id),
    db.prepare('DELETE FROM cloud_messages WHERE user_id=? AND conversation_id=?').bind(user.id, candidate.id),
  );
  statements.push(db.prepare('UPDATE users SET storage_usage_bytes=? WHERE id=?').bind(projected, user.id));
  statements.push(db.prepare('DELETE FROM conversation_tombstones WHERE user_id=? AND conversation_id=?').bind(user.id, candidate.id));
  await db.batch(statements);
  return { revision, storageUsageBytes: projected };
}

export async function deleteCloudConversation(env: WorkerEnv, user: AuthUser, id: string) {
  const db = database(env); const now = Date.now();
  const row = await db.prepare('SELECT size_bytes FROM cloud_conversations WHERE user_id=? AND id=?').bind(user.id, id).first<{ size_bytes: number }>();
  await db.batch([
    db.prepare('DELETE FROM conversation_payload_chunks WHERE user_id=? AND conversation_id=?').bind(user.id, id),
    db.prepare('DELETE FROM cloud_messages WHERE user_id=? AND conversation_id=?').bind(user.id, id),
    db.prepare('DELETE FROM cloud_conversations WHERE user_id=? AND id=?').bind(user.id, id),
    db.prepare(`INSERT INTO conversation_tombstones (user_id,conversation_id,deleted_at_ms,expires_at_ms) VALUES (?,?,?,?)
      ON CONFLICT(user_id,conversation_id) DO UPDATE SET deleted_at_ms=excluded.deleted_at_ms,expires_at_ms=excluded.expires_at_ms`).bind(user.id, id, now, now + TOMBSTONE_TTL),
    db.prepare('UPDATE users SET storage_usage_bytes=MAX(0,storage_usage_bytes-?) WHERE id=?').bind(Number(row?.size_bytes ?? 0), user.id),
  ]);
}

export async function exportCloudData(env: WorkerEnv, user: AuthUser, preferences: UserPreferencesEnvelope): Promise<DataExportBundle> {
  const rows = await database(env).prepare('SELECT * FROM cloud_conversations WHERE user_id=? ORDER BY updated_at_ms DESC').bind(user.id).all<Record<string, unknown>>();
  const conversations = await Promise.all((rows.results ?? []).map((row) => hydrateConversation(env, user.id, row)));
  return { schema: 'stingychat-export', version: 1, exportedAt: Date.now(), settings: preferences.settings, favoriteModels: preferences.favoriteModels, personalization: preferences.personalization, conversations };
}
