import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import type { ChatRequest } from '../src/types';
import { GlmScheduler } from '../worker/glmScheduler';
import type { WorkerEnv } from '../worker/glm';

const env = {
  ASSETS: { fetch: vi.fn() } as never,
  GLM_API_KEY: 'only-slot',
  GLM_BASE_URL: 'https://glm.example/v1',
  GLM_MODEL: 'GLM-4.7-Flash',
} satisfies WorkerEnv;

const assist = (id: string) => new Request('https://scheduler/run', {
  method: 'POST',
  body: JSON.stringify({ requestId: id, operation: 'test', system: 'system', user: id }),
});

function chatRequest(): ChatRequest {
  return {
    conversationId: 'queue-chat',
    profile: {
      id: 'stingy-free', name: 'StingyChat', kind: 'stingy', model: 'GLM-4.5-Flash', contextWindow: 128_000,
      capabilities: { responses: false, webSearch: false, reasoning: false, reasoningEffort: false, promptCache: false, batch: false, structuredOutput: true },
    },
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: 'concise',
    settings: DEFAULT_SETTINGS,
    estimatedBaseline: 10,
    estimatedSent: 8,
    citations: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GlmScheduler', () => {
  it('keeps FIFO order and one in-flight task per key', async () => {
    let releaseFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'second' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const scheduler = new GlmScheduler({} as DurableObjectState, env);

    const firstResult = scheduler.fetch(assist('first'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const secondResult = scheduler.fetch(assist('second'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst(Response.json({ choices: [{ message: { content: 'first' } }] }));
    await expect((await firstResult).json()).resolves.toMatchObject({ content: 'first' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect((await secondResult).json()).resolves.toMatchObject({ content: 'second' });
  });

  it('holds the key slot until a StingyChat response stream is consumed', async () => {
    let closeFirst!: () => void;
    const firstBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'));
        closeFirst = () => controller.close();
      },
    });
    const secondBody = 'data: {"choices":[{"delta":{"content":"second"}}]}\n\ndata: [DONE]\n\n';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(firstBody, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(secondBody, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const scheduler = new GlmScheduler({} as DurableObjectState, env);
    const streamBody = (id: string) => new Request('https://scheduler/stream', {
      method: 'POST',
      body: JSON.stringify({ requestId: id, operation: 'stingy-chat', request: chatRequest() }),
    });

    const firstResponse = await scheduler.fetch(streamBody('stream-first'));
    const secondResponsePromise = scheduler.fetch(streamBody('stream-second'));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstText = firstResponse.text();
    closeFirst();
    await expect(firstText).resolves.toContain('first');
    const secondResponse = await secondResponsePromise;
    await expect(secondResponse.text()).resolves.toContain('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit after three 429 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    const scheduler = new GlmScheduler({} as DurableObjectState, env);
    for (const id of ['one', 'two', 'three']) expect((await scheduler.fetch(assist(id))).status).toBe(503);
    const exhausted = await scheduler.fetch(assist('four'));
    expect(exhausted.status).toBe(503);
    await expect(exhausted.json()).resolves.toMatchObject({ code: 'GLM_POOL_EXHAUSTED' });
  });
});
