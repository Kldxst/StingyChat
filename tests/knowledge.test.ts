import { describe, expect, it } from 'vitest';
import { chunkText, tokenizeForSearch } from '../src/lib/knowledge';

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
});
