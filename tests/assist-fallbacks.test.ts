import { describe, expect, it } from 'vitest';
import {
  fallbackCacheKey,
  fallbackCacheMatch,
  fallbackMemory,
  fallbackOptimizePrompt,
  fallbackRoute,
  fallbackSystemPrompt,
} from '../worker/assistFallbacks';

describe('internal assistant deterministic fallbacks', () => {
  it('keeps every assistant feature usable when both GLM models are busy', () => {
    expect(fallbackOptimizePrompt('麻烦帮我  解释 Token，谢谢！')).toBe('解释 Token，');
    expect(fallbackSystemPrompt('TypeScript 审查助手')).toContain('角色：TypeScript 审查助手');
    expect(fallbackCacheKey('  那明天呢？  ')).toBe('那明天呢？');
    expect(fallbackRoute('请分析架构', false, false).route).toBe('complex');
    expect(fallbackCacheMatch('同一问题', '同一问题').equivalent).toBe(true);
    expect(fallbackMemory([{ role: 'user', content: '记住 A' }]).summary).toContain('记住 A');
  });
});
