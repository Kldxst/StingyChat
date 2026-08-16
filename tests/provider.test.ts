import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config';
import type { ChatRequest, ProviderProfile } from '../src/types';
import { createProviderConfig } from '../worker/providers';

const openai: ProviderProfile = {
  id: 'openai', name: 'OpenAI', kind: 'openai', model: 'gpt-5-mini', contextWindow: 400000,
  capabilities: { responses: true, webSearch: true, reasoning: true, reasoningEffort: true, promptCache: true, batch: true, structuredOutput: true },
};

function request(profile = openai): ChatRequest {
  return {
    conversationId: 'test-conversation',
    profile,
    messages: [{ role: 'user', content: '今天有什么新闻？' }],
    systemPrompt: '简洁回答',
    settings: { ...DEFAULT_SETTINGS, webSearch: true, reasoningEnabled: true },
    estimatedBaseline: 120,
    estimatedSent: 60,
    citations: [],
  };
}

describe('provider request mapping', () => {
  it('maps OpenAI web search to the Responses server-side tool', () => {
    const config = createProviderConfig(request(), 'secret');
    const body = JSON.parse(String(config.init.body)) as Record<string, unknown>;
    expect(config.url).toBe('https://api.openai.com/v1/responses');
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.reasoning).toEqual({ effort: 'medium' });
  });

  it('normalizes OpenAI Responses URL citations', () => {
    const config = createProviderConfig(request(), 'secret');
    expect(config.parse({
      type: 'response.output_text.annotation.added',
      annotation: { type: 'url_citation', url: 'https://example.com/news', title: 'Example News', start_index: 3 },
    }).citations).toMatchObject([{ sourceType: 'web', url: 'https://example.com/news', documentName: 'Example News' }]);
  });

  it('normalizes Gemini grounding sources', () => {
    const profile: ProviderProfile = {
      ...openai,
      id: 'gemini', kind: 'gemini', name: 'Gemini', model: 'gemini-test',
      capabilities: { ...openai.capabilities, responses: false },
    };
    const config = createProviderConfig(request(profile), 'secret');
    expect(config.parse({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source', title: 'Source' } }] } }] }).citations)
      .toMatchObject([{ sourceType: 'web', url: 'https://example.com/source' }]);
  });

  it('maps Anthropic prompt caching to an ephemeral system block', () => {
    const profile: ProviderProfile = {
      ...openai,
      id: 'anthropic', kind: 'anthropic', name: 'Anthropic', model: 'claude-sonnet',
      capabilities: { ...openai.capabilities, responses: false, webSearch: false, structuredOutput: false },
    };
    const config = createProviderConfig({ ...request(profile), settings: { ...DEFAULT_SETTINGS, promptCache: true } }, 'secret');
    const body = JSON.parse(String(config.init.body)) as { system: Array<Record<string, unknown>> };
    expect(config.url).toContain('anthropic.com');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('maps built-in OpenAI-compatible providers to their official endpoints', () => {
    const cases = [
      ['xai', 'https://api.x.ai/v1/chat/completions'],
      ['mistral', 'https://api.mistral.ai/v1/chat/completions'],
      ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
      ['moonshot', 'https://api.moonshot.cn/v1/chat/completions'],
      ['minimax', 'https://api.minimax.io/v1/chat/completions'],
    ] as const;
    for (const [kind, expected] of cases) {
      const profile: ProviderProfile = { ...openai, id: kind, name: kind, kind, capabilities: { ...openai.capabilities, responses: false, webSearch: false } };
      expect(createProviderConfig({ ...request(profile), settings: { ...DEFAULT_SETTINGS, webSearch: false } }, 'secret').url).toBe(expected);
    }
  });

  it('separates OpenAI-compatible reasoning deltas from answer text', () => {
    const profile: ProviderProfile = {
      ...openai,
      id: 'deepseek', kind: 'deepseek', name: 'DeepSeek', model: 'deepseek-v4-flash',
      capabilities: { ...openai.capabilities, responses: false, webSearch: false, batch: false },
    };
    const config = createProviderConfig({ ...request(profile), settings: { ...DEFAULT_SETTINGS, webSearch: false, reasoningEnabled: true } }, 'secret');
    expect(config.parse({ choices: [{ delta: { content: '答案', reasoning_content: '推理' } }] })).toMatchObject({
      delta: '答案',
      reasoningDelta: '推理',
    });
  });

  it('suppresses provider reasoning deltas when reasoning is disabled', () => {
    const profile: ProviderProfile = {
      ...openai,
      id: 'deepseek-off', kind: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat',
      capabilities: { ...openai.capabilities, responses: false, webSearch: false, batch: false },
    };
    const config = createProviderConfig({ ...request(profile), settings: { ...DEFAULT_SETTINGS, reasoningEnabled: false } }, 'secret');
    const body = JSON.parse(String(config.init.body)) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(config.parse({ choices: [{ delta: { content: '答案', reasoning_content: '不应显示' } }] }).reasoningDelta).toBeUndefined();
  });

  it('explicitly disables hidden reasoning for the free StingyChat model', () => {
    const profile: ProviderProfile = {
      ...openai,
      id: 'stingy-free', kind: 'stingy', name: 'StingyChat', model: 'GLM-4.5-Flash',
      capabilities: { ...openai.capabilities, responses: false, webSearch: false, reasoning: false, reasoningEffort: false, batch: false },
    };
    const config = createProviderConfig({ ...request(profile), settings: { ...DEFAULT_SETTINGS, reasoningEnabled: false } }, 'worker-secret');
    const body = JSON.parse(String(config.init.body)) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});
