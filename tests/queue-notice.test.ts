// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlmQueueNotice } from '../src/components/GlmQueueNotice';
import type { GlmQueueStatus } from '../src/types';

type QueueEvent = GlmQueueStatus | { state: 'unavailable'; requestId: string; operation?: string; message: string };

function emit(detail: QueueEvent) {
  window.dispatchEvent(new CustomEvent('stingy:glm-status', { detail }));
}

function status(requestId: string, state: GlmQueueStatus['state'], queuedAt = Date.now() - 3_000): GlmQueueStatus {
  return { requestId, state, operation: '工程对话', position: 1, queuedAt, estimatedWaitMs: 6_000 };
}

describe('GLM queue notice lifecycle', () => {
  afterEach(cleanup);

  it('ignores stale polls after completion and after manual dismissal', async () => {
    render(createElement(GlmQueueNotice));
    act(() => emit(status('completed-request', 'running')));
    expect(await screen.findByText('工程对话')).toBeTruthy();

    act(() => emit(status('completed-request', 'completed')));
    await waitFor(() => expect(screen.queryByText('工程对话')).toBeNull());
    act(() => emit(status('completed-request', 'running')));
    expect(screen.queryByText('工程对话')).toBeNull();

    act(() => emit(status('dismissed-request', 'running')));
    expect(await screen.findByText('工程对话')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭队列提示' }));
    await waitFor(() => expect(screen.queryByText('工程对话')).toBeNull());
    act(() => emit(status('dismissed-request', 'waiting')));
    expect(screen.queryByText('工程对话')).toBeNull();
  });

  it('does not surface fast or background-only operations', () => {
    render(createElement(GlmQueueNotice));
    act(() => emit({ ...status('fast-request', 'running', Date.now()), estimatedWaitMs: 0 }));
    act(() => emit({ ...status('title-request', 'running'), operation: '生成对话标题' }));
    act(() => emit({ requestId: 'title-failure', state: 'unavailable', operation: '生成对话标题', message: '暂不可用' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
