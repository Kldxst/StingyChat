import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGlm, type WorkerEnv } from '../worker/glm';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const env = {
  ASSETS: { fetch: vi.fn() } as never,
  GLM_API_KEY: 'primary-secret',
  GLM_BASE_URL: 'https://primary.example/v1',
  GLM_MODEL: 'GLM-4.7-Flash',
  FREE_GLM_API_KEY: 'fallback-secret',
  FREE_GLM_BASE_URL: 'https://fallback.example/v1',
  FREE_GLM_MODEL: 'GLM-4.5-Flash',
} satisfies WorkerEnv;

describe('internal GLM availability', () => {
  it.each([429, 524, 503])('falls back after upstream status %s', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback result' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callGlm(env, 'system', 'user')).resolves.toBe('fallback result');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1].body)) as Record<string, unknown>;
    expect(fallbackBody).toMatchObject({ model: 'GLM-4.5-Flash', thinking: { type: 'disabled' } });
  });

  it('disables reasoning on the primary assistant request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'primary result' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callGlm(env, 'system', 'user')).resolves.toBe('primary result');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'GLM-4.7-Flash', thinking: { type: 'disabled' } });
  });

  it('uses only the personal key when one is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'personal result' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callGlm(env, 'system', 'user', 0.2, 'personal-secret')).resolves.toBe('personal result');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer personal-secret');
    expect(JSON.stringify(init)).not.toContain('primary-secret');
    expect(JSON.stringify(init)).not.toContain('fallback-secret');
  });

  it('moves to the fallback when the primary request never responds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback result' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = callGlm(env, 'system', 'user');
    await vi.advanceTimersByTimeAsync(4_001);
    await expect(result).resolves.toBe('fallback result');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});
