import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURATED_PLUGINS } from '../worker/marketplace';

vi.mock('../src/lib/crypto', () => ({
  loadPersonalGlmSecret: vi.fn().mockResolvedValue('personal-key'),
}));
vi.mock('../src/lib/preferences', () => ({
  loadPersonalAssistantConfig: () => ({ baseUrl: 'https://assistant.example/v1', model: 'private-model' }),
}));

import { projectAgentStep } from '../src/lib/api';

describe('project mode integration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes engineering requests through the personal assistant configuration and supports abort signals', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      const headers = new Headers(init?.headers);
      expect(headers.get('x-user-assistant-api-key')).toBe('personal-key');
      expect(decodeURIComponent(headers.get('x-user-assistant-base-url') ?? '')).toBe('https://assistant.example/v1');
      expect(decodeURIComponent(headers.get('x-user-assistant-model') ?? '')).toBe('private-model');
      expect(headers.get('x-glm-request-id')).toBeTruthy();
      return new Response(JSON.stringify({ summary: 'ready', files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(projectAgentStep({ projectId: crypto.randomUUID(), prompt: 'inspect', permissionMode: 'read', fileIndex: [] }, controller.signal)).resolves.toEqual({ summary: 'ready', files: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps independent engineering chat available without a connected directory', () => {
    const source = readFileSync(new URL('../src/components/ProjectView.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("project?.id ?? sessionId.current");
    expect(source).toContain('await streamChat({');
    expect(source).toContain('projectProfileId');
    expect(source).toContain("loadProviderSecret(profile.id)");
    expect(app).toContain('onSelectProfile={(next) => setProjectProfileId(next.id)}');
    expect(source).toContain('无需打开目录即可开始');
  });

  it('publishes a standalone bridge and documents the repository-independent command', () => {
    const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../src/components/ProjectView.tsx', import.meta.url), 'utf8');
    expect(packageJson).toContain('scripts/sync-bridge.mjs');
    expect(existsSync(new URL('../public/stingy-bridge.mjs', import.meta.url))).toBe(true);
    expect(source).toContain('node "$env:USERPROFILE');
    expect(source).toContain('pairBridge(bridgeCode, bridgeUrl)');
  });

  it('offers a materially larger curated catalog with explicit compatible licenses', () => {
    expect(CURATED_PLUGINS.length).toBeGreaterThanOrEqual(17);
    expect(CURATED_PLUGINS.map((plugin) => plugin.id)).toEqual(expect.arrayContaining([
      'mcp:microsoft-playwright', 'mcp:github-official', 'mcp:upstash-context7',
      'mcp:cloudflare-official', 'mcp:desktop-commander', 'mcp:chrome-devtools',
      'mcp:notion-official', 'mcp:stripe-official', 'mcp:aws-labs',
      'mcp:microsoft-catalog', 'mcp:microsoft-learn', 'mcp:markitdown',
    ]));
    expect(CURATED_PLUGINS.every((plugin) => Boolean(plugin.license))).toBe(true);
    expect(CURATED_PLUGINS.every((plugin) => plugin.featured)).toBe(true);
  });
});
