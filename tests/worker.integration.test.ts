import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../worker/index';
import { DEFAULT_SETTINGS } from '../src/config';

afterEach(() => vi.unstubAllGlobals());

describe('Worker chat integration', () => {
  it('normalizes OpenAI Responses SSE and provider usage', async () => {
    const upstream = [
      'data: {"type":"response.reasoning_summary_text.delta","delta":"先分析"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"精简"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":3,"input_tokens_details":{"cached_tokens":4},"output_tokens_details":{"reasoning_tokens":1}}}}\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      conversationId: 'integration-test',
      profile: {
        id: 'openai', name: 'OpenAI', kind: 'openai', model: 'gpt-5-mini', contextWindow: 400000,
        capabilities: { responses: true, webSearch: true, reasoning: true, reasoningEffort: true, promptCache: true, batch: true, structuredOutput: true },
      },
      messages: [{ role: 'user', content: '回答' }],
      systemPrompt: '简洁',
      settings: { ...DEFAULT_SETTINGS, webSearch: true, reasoningEnabled: true },
      estimatedBaseline: 30,
      estimatedSent: 15,
      citations: [],
      savings: { promptCompression: 5, contextPruning: 5, jitRetrieval: 10, semanticCache: 0, promptCache: 0 },
    };
    const response = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-api-key': 'test-key' },
      body: JSON.stringify(body),
    }, { GLM_BASE_URL: '', GLM_MODEL: '', ASSETS: { fetch: vi.fn() } as never });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('"type":"delta","text":"精简"');
    expect(text).not.toContain('"type":"reasoning_delta"');
    expect(text).toContain('"cachedTokens":4');
    expect(text).toContain('"estimatedSaved":19');
    expect(text).toContain('"contextSavedTokens":15');
    expect(text).toContain('"cacheReuseTokens":4');
    expect(text).toContain('"estimatedGrossSaved":24');
    expect(text).toContain('"optimizationOverhead":9');
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(upstreamBody.tools).toBeUndefined();
  });

  it('protects image understanding from anonymous use', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '图片中有一张折线图' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/assist/understand-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '描述图表', dataUrl: 'data:image/png;base64,aGVsbG8=' }),
    }, {
      GLM_BASE_URL: 'https://assistant.example/v1', GLM_MODEL: 'text-model', GLM_VISION_MODEL: 'vision-model', GLM_API_KEY: 'worker-only',
      ASSETS: { fetch: vi.fn() } as never,
    });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('protects semantic cache normalization from anonymous use', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '查询 2026 年上海天气' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/assist/cache-normalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '那明天呢？', context: '用户正在查询 2026 年上海天气' }),
    }, { GLM_BASE_URL: 'https://assistant.example/v1', GLM_MODEL: 'assistant', GLM_API_KEY: 'test', ASSETS: { fetch: vi.fn() } as never });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/assist/optimize-prompt', { text: '请优化' }],
    ['/api/assist/generate-system-prompt', { text: '代码助手' }],
    ['/api/assist/route', { prompt: '分析任务', needsWebSearch: false, needsReasoning: true }],
    ['/api/assist/cache-match', { prompt: '问题', candidatePrompt: '问题', contextFingerprint: 'fingerprint' }],
    ['/api/conversation/compress', { messages: [{ role: 'user', content: '记住 A' }, { role: 'assistant', content: '已记录' }], currentMemory: '' }],
  ])('rejects anonymous internal endpoint %s', async (path, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '不应调用' } }],
    }), { headers: { 'content-type': 'application/json' } })));
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, { GLM_BASE_URL: 'https://assistant.example/v1', GLM_MODEL: 'assistant', GLM_API_KEY: 'worker-only', ASSETS: { fetch: vi.fn() } as never });
    expect(response.status).toBe(401);
  });

  it('uses the Worker free-model secret without a browser Provider key', async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"免费回复"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":4,"completion_tokens":2},"choices":[]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'free-test',
        profile: {
          id: 'stingy-free', name: 'StingyChat', kind: 'stingy', model: 'client-model', contextWindow: 128000,
          capabilities: { responses: false, webSearch: false, reasoning: false, reasoningEffort: false, promptCache: false, batch: false, structuredOutput: true },
        },
        messages: [{ role: 'user', content: '你好' }],
        systemPrompt: '简洁',
        settings: DEFAULT_SETTINGS,
        estimatedBaseline: 8,
        estimatedSent: 6,
        citations: [],
      }),
    }, {
      GLM_BASE_URL: '', GLM_MODEL: '', FREE_GLM_API_KEY: 'worker-secret', FREE_GLM_BASE_URL: 'https://free.example/v1', FREE_GLM_MODEL: 'server-model',
      ASSETS: { fetch: vi.fn() } as never,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('免费回复');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://free.example/v1/chat/completions');
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer worker-secret');
    expect(JSON.parse(String(call[1].body)).model).toBe('server-model');
  });

  it('replaces every developer GLM credential with the personal key for StingyChat', async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"个人 Key 回复"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-glm-api-key': 'personal-secret' },
      body: JSON.stringify({
        conversationId: 'personal-free-test',
        profile: {
          id: 'stingy-free', name: 'StingyChat', kind: 'stingy', model: 'client-model', contextWindow: 128000,
          capabilities: { responses: false, webSearch: false, reasoning: false, reasoningEffort: false, promptCache: false, batch: false, structuredOutput: true },
        },
        messages: [{ role: 'user', content: '你好' }],
        systemPrompt: '简洁',
        settings: DEFAULT_SETTINGS,
        estimatedBaseline: 8,
        estimatedSent: 6,
        citations: [],
      }),
    }, {
      GLM_API_KEY: 'developer-primary', GLM_FALLBACK_API_KEYS: '["developer-fallback"]',
      GLM_BASE_URL: 'https://assistant.example/v1', GLM_MODEL: 'assistant-model',
      FREE_GLM_API_KEY: 'developer-free', FREE_GLM_BASE_URL: 'https://free.example/v1', FREE_GLM_MODEL: 'server-model',
      ASSETS: { fetch: vi.fn() } as never,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('个人 Key 回复');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer personal-secret');
    expect(JSON.stringify(init)).not.toContain('developer-');
  });

  it('does not let a private key bypass login for assistant requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '私人助手结果' } }],
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/assist/understand-image', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-assistant-api-key': 'personal-secret',
        'x-user-assistant-base-url': encodeURIComponent('https://private.example/v9'),
        'x-user-assistant-model': encodeURIComponent('private-vision-model'),
      },
      body: JSON.stringify({ text: '描述图片', dataUrl: 'data:image/png;base64,aGVsbG8=' }),
    }, {
      GLM_API_KEY: 'developer-primary', GLM_BASE_URL: 'https://assistant.example/v1', GLM_MODEL: 'assistant-model', GLM_VISION_MODEL: 'developer-vision-model',
      ASSETS: { fetch: vi.fn() } as never,
    });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'http://assistant.example/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://192.168.1.10/v1',
  ])('rejects unsafe private assistant endpoint %s', async (baseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.request('/api/assist/optimize-prompt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-assistant-api-key': 'personal-secret',
        'x-user-assistant-base-url': encodeURIComponent(baseUrl),
        'x-user-assistant-model': 'private-model',
      },
      body: JSON.stringify({ text: '优化' }),
    }, { GLM_BASE_URL: '', GLM_MODEL: '', ASSETS: { fetch: vi.fn() } as never });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
