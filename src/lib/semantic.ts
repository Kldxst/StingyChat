import type { Conversation, SemanticCacheEntry } from '../types';
import { db } from './db';
import { ngramTokenizer, tokenizeForSearch } from './knowledge';
import { create, insert, insertMultiple, search } from '@orama/orama';

type CacheSearchDocument = SemanticCacheEntry & { scope: string; searchText: string };
let cacheIndex: Awaited<ReturnType<typeof create<{ id: 'string'; scope: 'enum'; prompt: 'string'; searchText: 'string'; answer: 'string'; createdAt: 'number' }>>> | undefined;
let cacheIndexPromise: Promise<NonNullable<typeof cacheIndex>> | undefined;
async function ensureCacheIndex() {
  if (cacheIndex) return cacheIndex;
  if (!cacheIndexPromise) cacheIndexPromise = (async () => {
    const index = await create({ schema: { id: 'string', scope: 'enum', prompt: 'string', searchText: 'string', answer: 'string', createdAt: 'number' } as const, components: { tokenizer: ngramTokenizer } });
    const entries = await db.cache.toArray();
    if (entries.length) await insertMultiple(index, entries.map((entry): CacheSearchDocument => ({ ...entry, scope: `${entry.conversationId}:${entry.fingerprint}`, searchText: tokenizeForSearch(entry.prompt).join(' ') })));
    cacheIndex = index;
    return index;
  })();
  return cacheIndexPromise;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(tokenizeForSearch(a));
  const right = new Set(tokenizeForSearch(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export async function conversationFingerprint(
  conversation: Conversation,
  providerModel: string,
  citationIds: string[],
): Promise<string> {
  return sha256(
    JSON.stringify({
      providerModel,
      systemPrompt: conversation.systemPrompt,
      memory: conversation.memory,
      citations: citationIds.toSorted(),
    }),
  );
}

export async function findCacheCandidate(
  conversationId: string,
  fingerprint: string,
  prompt: string,
): Promise<SemanticCacheEntry | undefined> {
  const index = await ensureCacheIndex();
  const result = await search(index, { term: tokenizeForSearch(prompt).join(' '), properties: ['searchText'], where: { scope: { eq: `${conversationId}:${fingerprint}` } }, limit: 8, threshold: 0 });
  const entries = result.hits.map((hit) => hit.document as CacheSearchDocument);
  const candidate = entries
    .map((entry) => ({ entry, score: lexicalSimilarity(prompt, entry.prompt) }))
    .filter(({ score }) => score >= 0.55)
    .sort((a, b) => b.score - a.score)[0]?.entry;
  return candidate ? db.cache.get(candidate.id) : undefined;
}

export async function saveCacheEntry(entry: Omit<SemanticCacheEntry, 'id' | 'createdAt'>): Promise<void> {
  const value = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() };
  await db.cache.put(value);
  await insert(await ensureCacheIndex(), { ...value, scope: `${value.conversationId}:${value.fingerprint}`, searchText: tokenizeForSearch(value.prompt).join(' ') });
}
