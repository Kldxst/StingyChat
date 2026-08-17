import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { chunkText, retrieveKnowledge, tokenizeForSearch } from '../src/lib/knowledge';
import { db } from '../src/lib/db';

describe('local JIT retrieval primitives', () => {
  it('creates Chinese unigrams and bigrams', () => {
    const terms = tokenizeForSearch('上下文压缩 Token cache');
    expect(terms).toContain('上下');
    expect(terms).toContain('token');
  });

  it('chunks long text with stable document metadata', () => {
    const chunks = chunkText('第一段。\n'.repeat(500), 'doc-1', 'notes.md');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.documentId === 'doc-1')).toBe(true);
    expect(chunks[0].documentName).toBe('notes.md');
  });

  it('keeps a long-lived Orama index and ranks the relevant Chinese chunk first', async () => {
    await db.chunks.bulkPut([
      ...chunkText('量子缓存通过稳定前缀减少重复计算。', 'doc-cache', 'cache.md'),
      ...chunkText('番茄炒蛋需要先处理番茄和鸡蛋。', 'doc-food', 'food.md'),
    ]);
    const results = await retrieveKnowledge('如何减少量子缓存的重复计算', 2);
    expect(results[0]).toMatchObject({ documentName: 'cache.md' });
    expect(results[0].score).toBeGreaterThan(0);
  });
});
