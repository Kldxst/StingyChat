import { describe, expect, it, vi } from 'vitest';
import { heuristicTokenEstimate, withinDeadline } from '../src/lib/preparation';

describe('preparation deadlines', () => {
  it('uses the completed value inside the deadline', async () => {
    await expect(withinDeadline(Promise.resolve('ready'), 50, 'fallback')).resolves.toMatchObject({ value: 'ready', timedOut: false });
  });

  it('falls back without waiting for a slow enhancement', async () => {
    vi.useFakeTimers();
    const result = withinDeadline(new Promise<string>(() => undefined), 150, 'original');
    await vi.advanceTimersByTimeAsync(151);
    await expect(result).resolves.toMatchObject({ value: 'original', timedOut: true });
    vi.useRealTimers();
  });

  it('provides a synchronous tokenizer fallback for mixed text', () => {
    expect(heuristicTokenEstimate('你好 TypeScript')).toBeGreaterThan(2);
  });

  it('cancels an in-flight preparation immediately', async () => {
    const controller = new AbortController();
    const result = withinDeadline(new Promise<string>(() => undefined), 5_000, 'fallback', controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
