import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { drainConversationSync, queueConversationSync } from '../src/lib/cloudSync';
import type { ChatMessage, Conversation } from '../src/types';

const namespace = 'user:sync-race';

function message(id: string, role: ChatMessage['role'], content: string, createdAt: number): ChatMessage {
  return { id, role, content, createdAt };
}

function conversation(messages: ChatMessage[], updatedAt: number): Conversation {
  return {
    id: 'sync-race-conversation', title: 'Race', messages, memory: { summary: '', facts: [], preferences: [], openTasks: [], constraints: [], citations: [], updatedAt },
    systemPrompt: '', providerProfileId: 'stingy-free', createdAt: 1, updatedAt, namespace, revision: 0, syncState: 'pending',
  };
}

describe('cloud conversation synchronization', () => {
  beforeEach(async () => {
    await db.conversationSync.clear();
    await db.conversations.clear();
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not overwrite a reply appended while an older snapshot is in flight', async () => {
    let releaseFirst!: () => void;
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = () => resolve(Response.json({ revision: 1 })); });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(Response.json({ revision: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const user = message('user-1', 'user', 'question', 10);
    await db.conversations.put(conversation([user], 10));
    await queueConversationSync(namespace, 'sync-race-conversation', 'upsert');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const assistant = message('assistant-1', 'assistant', 'answer', 20);
    await db.conversations.put(conversation([user, assistant], 20));
    await queueConversationSync(namespace, 'sync-race-conversation', 'upsert');
    releaseFirst();
    await drainConversationSync(namespace);

    await vi.waitFor(async () => expect((await db.conversationSync.count())).toBe(0));
    const saved = await db.conversations.get('sync-race-conversation');
    expect(saved?.messages.map(({ id }) => id)).toEqual(['user-1', 'assistant-1']);
    expect(saved?.revision).toBe(2);
    expect(saved?.syncState).toBe('synced');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
