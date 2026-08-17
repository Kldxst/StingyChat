import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { conversationSyncSchema } from '../worker/history';
import { createDataExport } from '../src/lib/cloudSync';
import { DEFAULT_SETTINGS } from '../src/config';
import type { Conversation } from '../src/types';

const conversation: Conversation = {
  id: 'conversation-1', title: '测试', systemPrompt: 'system', providerProfileId: 'stingy-free', createdAt: 1, updatedAt: 2,
  memory: { summary: '', facts: [], preferences: [], openTasks: [], constraints: [], citations: [], updatedAt: 1 },
  messages: [{ id: 'message-1', role: 'user', content: '查看图片', createdAt: 1, attachments: [{ id: 'image-1', name: 'secret.png', mimeType: 'image/png', size: 10, kind: 'image', dataUrl: 'data:image/png;base64,SECRET' }] }],
};

describe('cloud history and RBAC migration', () => {
  it('accepts versioned conversation sync payloads and rejects mismatched message roles', () => {
    expect(conversationSyncSchema.safeParse({ baseRevision: 0, conversation }).success).toBe(true);
    expect(conversationSyncSchema.safeParse({ baseRevision: 0, conversation: { ...conversation, messages: [{ ...conversation.messages[0], role: 'tool' }] } }).success).toBe(false);
  });

  it('never includes raw attachment binary in exported data', () => {
    const bundle = createDataExport(DEFAULT_SETTINGS, [], undefined, [conversation]);
    expect(JSON.stringify(bundle)).not.toContain('base64,SECRET');
    expect(bundle.conversations[0].messages[0].attachments?.[0].name).toBe('secret.png');
  });

  it('removes the password admin route and client session token', () => {
    const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
    expect(worker).not.toContain("/api/admin/login");
    expect(worker).not.toContain('ADMIN_PASSWORD');
    expect(store).not.toContain('stingy-admin-token');
  });
});
