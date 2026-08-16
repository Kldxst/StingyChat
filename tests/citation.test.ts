import { describe, expect, it } from 'vitest';
import { groupCitations } from '../src/components/ChatView';

describe('citation grouping', () => {
  it('groups chunks from one document and keeps the best score', () => {
    const grouped = groupCitations([
      { chunkId: 'a', documentName: 'guide.pdf', excerpt: 'first', score: 2 },
      { chunkId: 'b', documentName: 'guide.pdf', excerpt: 'second', score: 5 },
      { chunkId: 'c', documentName: 'notes.md', excerpt: 'note', score: 3 },
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ documentName: 'guide.pdf', chunkCount: 2, bestScore: 5 });
    expect(grouped[0].excerpts).toEqual(['first', 'second']);
  });
});
