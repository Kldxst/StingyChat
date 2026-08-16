// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarPrompt, countCompletedTurns } from '../src/components/StarPrompt';
import type { ChatMessage, Conversation } from '../src/types';

function conversationWithReplies(replyCount: number): Conversation {
  const messages: ChatMessage[] = Array.from({ length: replyCount }, (_, index) => [
    { id: `u-${index}`, role: 'user' as const, content: `问题 ${index}`, createdAt: index * 2 },
    { id: `a-${index}`, role: 'assistant' as const, content: `回答 ${index}`, createdAt: index * 2 + 1 },
  ]).flat();
  return {
    id: 'conversation', title: '测试', messages,
    memory: { summary: '', facts: [], preferences: [], openTasks: [], constraints: [], citations: [], updatedAt: 0 },
    systemPrompt: '', providerProfileId: 'stingy', createdAt: 0, updatedAt: 0,
  };
}

describe('StarPrompt', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts completed assistant replies across conversations', () => {
    expect(countCompletedTurns([conversationWithReplies(2), conversationWithReplies(3)])).toBe(5);
  });

  it('appears at five completed turns and auto closes after ten seconds', () => {
    render(createElement(StarPrompt, { initialized: true, conversations: [conversationWithReplies(5)] }));
    expect(screen.getByRole('dialog', { name: '感谢你使用 StingyChat' })).toBeTruthy();
    expect(localStorage.getItem('stingy-star-prompt-shown-v1')).toBeTruthy();

    act(() => vi.advanceTimersByTime(10_000));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('dialog', { name: '感谢你使用 StingyChat' }).getAttribute('style')).toContain('opacity: 0');
  });

  it('does not appear again after it has been shown', () => {
    localStorage.setItem('stingy-star-prompt-shown-v1', 'shown');
    render(createElement(StarPrompt, { initialized: true, conversations: [conversationWithReplies(6)] }));
    expect(screen.queryByRole('dialog', { name: '感谢你使用 StingyChat' })).toBeNull();
  });
});
