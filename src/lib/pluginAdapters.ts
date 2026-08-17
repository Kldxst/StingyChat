import type { PluginCompatibilityReport, PluginFormat, PluginManifest, PluginPermission } from '../types';

const CODEX_SCHEMA_PREFIX = 'https://developers.openai.com/codex/schemas/agent-plugin';

function compatibility(level: PluginCompatibilityReport['level'], reasons: string[], supportedFeatures: string[], unsupportedFeatures: string[] = []): PluginCompatibilityReport {
  return { level, reasons, requiresBridge: level === 'bridge' || supportedFeatures.some((item) => /stdio|hook|dsh/iu.test(item)), supportedFeatures, unsupportedFeatures };
}

function permissionsForMcp(value: unknown): PluginPermission[] {
  const text = JSON.stringify(value ?? {});
  const permissions: PluginPermission[] = ['mcp'];
  if (/https?:\/\//iu.test(text)) permissions.push('network');
  if (/"command"\s*:/u.test(text)) permissions.push('command:execute');
  if (/env|token|key|secret/iu.test(text)) permissions.push('credentials');
  return permissions;
}

export function parseCodexPlugin(manifestText: string, sourceUrl: string, mcpText?: string): PluginManifest {
  const raw = JSON.parse(manifestText) as Record<string, unknown>;
  const name = String(raw.name ?? '').trim();
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u.test(name) || name.includes('..') || name.includes('--')) throw new Error('Codex 插件名称无效');
  const schema = String(raw.$schema ?? '');
  if (schema && !schema.startsWith(CODEX_SCHEMA_PREFIX)) throw new Error('不支持的 Codex Agent Plugin Schema');
  const mcp = mcpText ? JSON.parse(mcpText) : undefined;
  const extension = (raw.extensions as Record<string, unknown> | undefined)?.['com.openai'] as Record<string, unknown> | undefined;
  const hasHooks = Boolean(extension?.hooks);
  const hasApps = Boolean(extension?.apps);
  const permissions = [...new Set<PluginPermission>([...(mcp ? permissionsForMcp(mcp) : []), ...(hasHooks ? ['hooks', 'command:execute'] as PluginPermission[] : []), ...(hasApps ? ['ui'] as PluginPermission[] : [])])];
  const supported = ['Skills', ...(mcp ? ['MCP'] : []), ...(hasHooks ? ['Hooks（本地桥）'] : [])];
  const unsupported = hasApps ? ['Codex 专属 App UI；仅 MCP Apps 可沙箱显示'] : [];
  const level = hasHooks ? 'bridge' : unsupported.length ? 'partial' : 'native';
  return { id: `codex:${name}`, name, version: String(raw.version ?? '0.0.0'), description: String(raw.description ?? 'Codex Agent Plugin'), format: 'codex-agent-plugin', sourceUrl, license: typeof raw.license === 'string' ? raw.license : undefined, author: typeof raw.author === 'object' && raw.author ? String((raw.author as Record<string, unknown>).name ?? '') : undefined, permissions, compatibility: compatibility(level, level === 'bridge' ? ['包含需要本地运行时的 Hook 或 stdio MCP'] : unsupported.length ? unsupported : ['可直接导入 Skills 与 MCP'], supported, unsupported), categories: Array.isArray(raw.keywords) ? raw.keywords.map(String).slice(0, 8) : ['Codex'] };
}

export function parseDshBundle(packageText: string, sourceUrl: string): PluginManifest {
  const raw = JSON.parse(packageText) as Record<string, unknown>;
  const dsh = raw.dsh as { bundle?: { patch?: string } } | undefined;
  if (!dsh?.bundle?.patch) throw new Error('该 npm 包没有声明 dsh.bundle.patch');
  const name = String(raw.name ?? '').trim();
  if (!name) throw new Error('DSH bundle 缺少包名');
  return { id: `dsh:${name}`, name, version: String(raw.version ?? '0.0.0'), description: String(raw.description ?? 'DeepSeek Harness bundle'), format: 'dsh-bundle', sourceUrl, license: typeof raw.license === 'string' ? raw.license : undefined, author: typeof raw.author === 'string' ? raw.author : undefined, permissions: ['command:execute', 'files:read', 'network'], compatibility: compatibility('bridge', ['需要官方 DeepSeek Harness/Cordis 运行时'], ['DSH bundle', 'Cordis patch'], ['DSH 客户端专属 UI 可能无法投影到 StingyChat']), categories: ['DeepSeek Harness'] };
}

export function normalizeMcpToolName(serverName: string, rawName: string): Promise<string> {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/gu, '_');
  if (normalized === joined && normalized.length <= 64) return Promise.resolve(normalized);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${serverName}\0${rawName}`)).then((digest) => {
    const hash = [...new Uint8Array(digest)].slice(0, 6).map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${normalized.slice(0, 51)}_${hash}`;
  });
}

export function pluginFormatLabel(format: PluginFormat): string {
  return ({ stingy: 'StingyChat', 'codex-agent-plugin': 'Codex', 'dsh-bundle': 'DeepSeek Harness', mcp: 'MCP', 'agent-skill': 'Agent Skill' } as Record<PluginFormat, string>)[format];
}

