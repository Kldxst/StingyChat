import { describe, expect, it } from 'vitest';
import { extractGeneratedArtifacts } from '../src/lib/artifacts';
import { createPastedTextAttachment, LONG_PASTE_CHAR_THRESHOLD, retrieveAttachmentText } from '../src/lib/attachments';
import { captureClientRuntimeContext, runtimeContextPrompt } from '../src/lib/runtimeContext';
import { buildSkillsPrompt } from '../src/lib/skills';
import { formatAdminTime, parseSqliteUtc } from '../src/lib/time';
import { estimateAttachmentTokens } from '../src/lib/tokenLedger';

describe('workspace feature completion', () => {
  it('treats SQLite CURRENT_TIMESTAMP values as UTC', () => {
    expect(parseSqliteUtc('2026-08-16 04:30:00').toISOString()).toBe('2026-08-16T04:30:00.000Z');
    expect(formatAdminTime('2026-08-16 04:30:00', 'Asia/Shanghai')).toContain('12:30:00');
  });

  it('builds an explicit current-time and timezone context', () => {
    const context = captureClientRuntimeContext(new Date('2026-08-16T04:30:00.000Z'));
    const prompt = runtimeContextPrompt({ ...context, timeZone: 'Asia/Shanghai', utcOffsetMinutes: 480 });
    expect(prompt).toContain('2026-08-16T04:30:00.000Z');
    expect(prompt).toContain('Asia/Shanghai（UTC+08:00）');
  });

  it('turns a long paste into a local document attachment', () => {
    const text = '长内容'.repeat(LONG_PASTE_CHAR_THRESHOLD);
    const attachment = createPastedTextAttachment(text, new Date(2026, 7, 16, 12, 34, 56));
    expect(attachment).toMatchObject({ kind: 'document', mimeType: 'text/plain', text });
    expect(attachment.name).toBe('粘贴内容-20260816-123456.txt');
    expect(estimateAttachmentTokens([attachment])).toBeGreaterThan(0);
  });

  it('retrieves attachment chunks even for a generic zero-overlap request', () => {
    const attachment = createPastedTextAttachment('量子材料实验记录。样品在低温下发生相变。');
    const citations = retrieveAttachmentText([attachment], '请分析附件', 3);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ sourceType: 'attachment', documentName: attachment.name });
  });

  it('extracts only explicitly named generated files', () => {
    const markdown = [
      '```ts filename="app.ts"',
      'export const value = 1;',
      '```',
      '```json',
      '{"ignored":true}',
      '```',
    ].join('\n');
    expect(extractGeneratedArtifacts(markdown, 'message-1')).toMatchObject([
      { name: 'app.ts', language: 'ts', mimeType: 'text/typescript', content: 'export const value = 1;' },
    ]);
  });

  it('composes selected Skills without accepting unknown ids', () => {
    const prompt = buildSkillsPrompt(['file-generation', 'deep-research', 'unknown']);
    expect(prompt).toContain('[文件生成]');
    expect(prompt).toContain('[深度研究]');
    expect(prompt).not.toContain('unknown');
  });
});
