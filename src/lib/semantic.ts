import type { Conversation, SemanticCacheEntry } from '../types';
import { db } from './db';
import { tokenizeForSearch } from './knowledge';

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
  const entries = await db.cache
    .where('conversationId')
    .equals(conversationId)
    .filter((entry) => entry.fingerprint === fingerprint)
    .toArray();
  return entries
    .map((entry) => ({ entry, score: lexicalSimilarity(prompt, entry.prompt) }))
    .filter(({ score }) => score >= 0.55)
    .sort((a, b) => b.score - a.score)[0]?.entry;
}

export async function saveCacheEntry(entry: Omit<SemanticCacheEntry, 'id' | 'createdAt'>): Promise<void> {
  await db.cache.put({ ...entry, id: crypto.randomUUID(), createdAt: Date.now() });
}
