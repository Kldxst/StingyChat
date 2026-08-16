import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat scroll containment', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const chatView = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('prevents grid ancestors from expanding with long conversations', () => {
    expect(css).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.main-column\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.chat-view\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/su);
  });

  it('keeps the message list as the only vertical scroll container', () => {
    expect(css).toMatch(/\.messages\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/su);
  });

  it('contains large conversation lists inside the sidebar', () => {
    expect(css).toMatch(/\.sidebar\s*\{[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.conversation-list\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/su);
    expect(css).toContain('.sidebar > .sidebar-settings { flex: 0 0 auto; }');
  });

  it('keeps token details and rich content inside the viewport', () => {
    expect(css).toMatch(/\.token-popover\s*\{[^}]*width:\s*min\(238px,\s*calc\(100vw\s*-\s*24px\)\)/su);
    expect(css).toContain('.message.user .token-popover { left: auto; right: 0; }');
    expect(css).toMatch(/\.message-body, \.message-body p,[^{]+\{[^}]*overflow-wrap:\s*anywhere/su);
    expect(css).toMatch(/\.message-body table\s*\{[^}]*overflow-x:\s*auto/su);
  });

  it('follows late content growth without overriding intentional upward scrolling', () => {
    expect(chatView).toContain('new ResizeObserver');
    expect(chatView).toContain('shouldFollowRef.current');
    expect(chatView).toContain('forceFollowUntilRef.current = performance.now() + 550');
    expect(chatView).toContain('element.scrollHeight - element.scrollTop - element.clientHeight < 72');
  });

  it('renders provider stream deltas through a character queue', () => {
    expect(chatView).toContain('revealQueueRef.current.push(...Array.from(event.text))');
    expect(chatView).toContain('requestAnimationFrame(paint)');
  });

  it('exposes sent prompt differences and one-click original restoration', () => {
    expect(chatView).toContain('提示词发送差异');
    expect(chatView).toContain('将原文放回输入框');
    expect(chatView).toContain('setReplacement(sentPromptPreview.content)');
  });

  it('resets workspace scroll when switching away from a scrolled view', () => {
    expect(app).toContain("querySelector<HTMLElement>(':scope > .workspace-view')");
    expect(app).toContain('workspace.scrollTop = 0');
    expect(app).toContain('}, [view]);');
  });

  it('supports a collapsible left rail and a contained artifact inspector', () => {
    expect(css).toContain('.app-shell.sidebar-is-collapsed { --sidebar: 72px; }');
    expect(css).toMatch(/\.app-shell\.artifact-is-open\s*\{[^}]*grid-template-columns:\s*var\(--sidebar\)\s+minmax\(0,\s*1fr\)\s+clamp\(/su);
    expect(css).toMatch(/@media \(max-width:\s*820px\)[\s\S]*\.app-shell\.artifact-is-open\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/su);
    expect(css).toContain('.artifact-preview pre { flex: 1 1 auto; min-height: 0;');
  });

  it('lets the Skills popup escape the rounded composer clipping region', () => {
    expect(css).toContain('.composer:has(.skill-picker) { overflow: visible; }');
    expect(css).toMatch(/\.skill-picker\s*\{[^}]*max-height:\s*min\(560px,\s*64dvh\)[^}]*overflow:\s*hidden/su);
  });
});
