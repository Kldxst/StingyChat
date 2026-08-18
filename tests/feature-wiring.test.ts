import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment feature wiring', () => {
  const settings = readFileSync(new URL('../src/components/SettingsDrawer.tsx', import.meta.url), 'utf8');
  const batch = readFileSync(new URL('../src/components/BatchView.tsx', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');

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

  it('exposes reasoning and search toggle state to assistive technology', () => {
    expect(composer).toContain('aria-pressed={settings.reasoningEnabled}');
    expect(composer).toContain('aria-pressed={settings.webSearch}');
  });

  it('routes StingyChat search through the source-preserving assistant fallback', () => {
    expect(config).toMatch(/kind: 'stingy'[\s\S]*?webSearch: false/u);
    expect(composer).toContain('由智能助手联网检索并注入可验证来源');
  });

  it('degrades slow search enhancement instead of blocking the provider request indefinitely', () => {
    expect(chat).toContain('withinDeadline(searchWithGlm(rawPrompt)');
    expect(chat).toContain('7_000, emptySearch, controller.signal');
    expect(chat).toContain('联网增强等待超时，本轮已跳过');
  });

  it('does not let a stale queue poll replace the completed request state', () => {
    expect(api.match(/if \(!settled && response\.ok\)/gu)).toHaveLength(2);
    expect(api).toMatch(/settled = true;\s*emitGlmStatus\(\{ requestId, state: 'completed'/u);
  });
});
