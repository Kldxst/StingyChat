import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment feature wiring', () => {
  const settings = readFileSync(new URL('../src/components/SettingsDrawer.tsx', import.meta.url), 'utf8');
  const batch = readFileSync(new URL('../src/components/BatchView.tsx', import.meta.url), 'utf8');

  it('connects manual context compression to persisted conversation memory', () => {
    expect(settings).toContain('const compressNow = async () =>');
    expect(settings).toContain('await compressConversation(');
    expect(settings).toContain("await updateConversation(conversation.id, { memory })");
    expect(settings).toContain('手动压缩早期对话');
  });

  it('supports batch file import and explicit price estimation', () => {
    expect(batch).toContain('accept=".jsonl,.csv,application/json,text/csv"');
    expect(batch).toContain('file.text().then(setInput)');
    expect(batch).toContain('费用上限估算');
  });
});
