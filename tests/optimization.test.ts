import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import {
  applyExtremeMode,
  buildSystemPrompt,
  deduplicateInstructions,
  optimizePromptLocally,
  removeChinesePoliteness,
  selectContext,
  isSafeCompressionCandidate,
} from '../src/lib/optimization';
import type { ChatMessage, ConversationMemory } from '../src/types';

const memory: ConversationMemory = {
  summary: '', facts: [], preferences: [], openTasks: [], constraints: [], citations: [], updatedAt: 0,
};

describe('prompt optimization', () => {
  it('removes Chinese politeness without dropping the task', () => {
    expect(removeChinesePoliteness('麻烦帮我 请问一下解释一下 TypeScript，谢谢！')).toContain('解释一下 TypeScript');
  });

  it('deduplicates repeated instructions', () => {
    expect(deduplicateInstructions('只输出代码。只输出代码。不要解释。')).toBe('只输出代码。不要解释。');
  });

  it('preserves the original and reports non-negative savings', () => {
    const result = optimizePromptLocally('麻烦帮我   只输出答案。只输出答案。谢谢！', DEFAULT_SETTINGS);
    expect(result.original).toContain('麻烦');
    expect(result.optimized).not.toContain('麻烦');
    expect(result.saved).toBeGreaterThanOrEqual(0);
  });

  it('adds strict output contracts to the stable system prompt', () => {
    const system = buildSystemPrompt('你是助手。', { ...DEFAULT_SETTINGS, outputContract: 'json' });
    expect(system).toContain('只输出合法 JSON');
  });

  it('rejects compression that loses numbers, negation, URLs, code, or contracts', () => {
    const original = '必须访问 https://example.com/v2，保留数值 42，不要删除 `user_id`，只输出 JSON。';
    expect(isSafeCompressionCandidate(original, '访问 example 并输出结果')).toBe(false);
    expect(isSafeCompressionCandidate(original, original)).toBe(false);
  });

  it('keeps recent messages when the context budget is exceeded', () => {
    const messages: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({
      id: String(index), role: index % 2 ? 'assistant' : 'user', content: `消息${index}${'内容'.repeat(160)}`, createdAt: index,
    }));
    const result = selectContext(messages, memory, 1024, 0.4);
    expect(result.shouldCompress).toBe(true);
    expect(result.messages.at(-1)?.content).toContain('消息11');
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('enables every supported optimizer in extreme mode', () => {
    const result = applyExtremeMode(DEFAULT_SETTINGS, true);
    expect(result.extremeMode).toBe(true);
    expect(result.semanticCache).toBe(true);
    expect(result.modelRouting).toBe(true);
    expect(result.maxCompletionTokens).toBe(DEFAULT_SETTINGS.maxCompletionTokens);
  });
});
