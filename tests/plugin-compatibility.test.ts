import { describe, expect, it } from 'vitest';
import { addedPermissions, assertPluginInstallable } from '../src/lib/marketplace';
import { normalizeMcpToolName, parseCodexPlugin, parseDshBundle } from '../src/lib/pluginAdapters';
import type { PluginManifest } from '../src/types';

describe('plugin compatibility adapters', () => {
  it('maps Codex skills and stdio MCP to bridge permissions', () => {
    const plugin = parseCodexPlugin(JSON.stringify({ name: 'review-tools', version: '1.2.0', license: 'Apache-2.0', extensions: { 'com.openai': { hooks: { beforeTool: 'check' } } } }), 'https://example.com/plugin.json', JSON.stringify({ servers: { local: { command: 'node', args: ['server.js'] } } }));
    expect(plugin.format).toBe('codex-agent-plugin');
    expect(plugin.compatibility.level).toBe('bridge');
    expect(plugin.permissions).toContain('command:execute');
  });

  it('recognizes a DSH bundle patch', () => {
    expect(parseDshBundle(JSON.stringify({ name: '@demo/dsh', version: '1.0.0', license: 'MIT', dsh: { bundle: { patch: './patch.js' } } }), 'https://example.com/package.json').compatibility.requiresBridge).toBe(true);
  });

  it('normalizes colliding MCP tool names with a stable hash', async () => {
    const first = await normalizeMcpToolName('files.local', 'read/path/with/a/very/long/name/that/exceeds/the/tool/name/limit');
    const second = await normalizeMcpToolName('files.local', 'read/path/with/a/very/long/name/that/exceeds/the/tool/name/limit');
    expect(first).toBe(second);
    expect(first).toMatch(/^mcp__/u);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it('blocks missing and AGPL licenses and detects permission escalation', () => {
    const base = { id: 'x', name: 'x', version: '1', description: '', format: 'stingy', sourceUrl: 'https://example.com', permissions: ['files:read'], compatibility: { level: 'native', reasons: [], requiresBridge: false, supportedFeatures: [], unsupportedFeatures: [] }, categories: [] } satisfies Omit<PluginManifest, 'license'>;
    expect(() => assertPluginInstallable(base as PluginManifest)).toThrow('许可证');
    expect(() => assertPluginInstallable({ ...base, license: 'AGPL-3.0-only' } as PluginManifest)).toThrow('AGPL');
    expect(addedPermissions({ ...base, license: 'MIT' } as PluginManifest, { ...base, license: 'MIT', permissions: ['files:read', 'network'] } as PluginManifest)).toEqual(['network']);
  });
});
