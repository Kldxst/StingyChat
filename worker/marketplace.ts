import { z } from 'zod';
import type { MarketplaceSource, PluginManifest } from '../src/types';
import { safeFetch, validateCustomBaseUrl } from './security';

export const marketplaceResolveSchema = z.object({
  url: z.string().url().max(1_000),
  format: z.enum(['codex-agent-plugin', 'dsh-bundle', 'mcp', 'agent-skill']),
});

export const CURATED_PLUGINS: PluginManifest[] = [
  {
    id: 'stingy:codex-agent-plugin-adapter', name: 'Codex Agent Plugin 兼容层', version: '1.0.0', description: '导入 Codex plugin.json、Skills 与 MCP 配置，并按权限映射到工程模式。', format: 'stingy', sourceUrl: 'https://github.com/openai/codex', license: 'Apache-2.0', author: 'StingyChat', permissions: ['files:read', 'mcp'], compatibility: { level: 'native', reasons: ['内置适配器，无需下载可执行代码'], requiresBridge: false, supportedFeatures: ['plugin.json', 'Skills', 'HTTP MCP'], unsupportedFeatures: ['Codex 专属 App UI'] }, categories: ['Codex', '开发'], featured: true,
  },
  {
    id: 'mcp:official-filesystem', name: 'MCP Filesystem', version: '2026.7.10', description: 'Model Context Protocol 官方文件系统服务器，通过本地桥限制在授权项目根目录。', format: 'mcp', sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', license: 'MIT', author: 'Model Context Protocol', permissions: ['files:read', 'files:write', 'mcp', 'command:execute'], compatibility: { level: 'bridge', reasons: ['stdio MCP 需要本地桥托管'], requiresBridge: true, supportedFeatures: ['文件读取', '目录检索', '受控写入'], unsupportedFeatures: [] }, categories: ['MCP', '文件'], featured: true,
  },
  {
    id: 'dsh:official-mcp-client', name: 'DeepSeek Harness MCP Client', version: '0.0.1-rc.1', description: 'DeepSeek Harness 官方 MCP Client bundle，在隔离 DSH profile 中发现并桥接工具。', format: 'dsh-bundle', sourceUrl: 'https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client', license: 'BSD-3-Clause', author: 'DeepSeek AI', permissions: ['command:execute', 'network', 'mcp'], compatibility: { level: 'bridge', reasons: ['需要 DeepSeek Harness/Cordis 本地运行时'], requiresBridge: true, supportedFeatures: ['DSH bundle', 'stdio MCP', 'HTTP MCP'], unsupportedFeatures: ['DSH 专属客户端 UI'] }, categories: ['DeepSeek Harness', 'MCP'], featured: true,
  },
  {
    id: 'skill:codex-code-review', name: 'Codex Code Review Skills', version: '1.0.0', description: '来自 OpenAI Codex 仓库的分层代码审查 Skills，按需加载以减少工具上下文。', format: 'agent-skill', sourceUrl: 'https://github.com/openai/codex/tree/main/.codex/skills/code-review', license: 'Apache-2.0', author: 'OpenAI', permissions: ['files:read'], compatibility: { level: 'native', reasons: ['标准 SKILL.md，可直接渐进加载'], requiresBridge: false, supportedFeatures: ['代码审查', '测试审查', '变更范围分析'], unsupportedFeatures: [] }, categories: ['Codex', 'Skills', '代码审查'], featured: true,
  },
  {
    id: 'skill:dsh-plugin-development', name: 'DSH Plugin Development', version: '1.0.0', description: 'DeepSeek Harness 官方 Cordis 插件开发 Skill，用于分析 bundle 与 patch 结构。', format: 'agent-skill', sourceUrl: 'https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli/config/agent-presets/cordis/skills/cordis-plugin-development', license: 'MIT', author: 'DeepSeek AI', permissions: ['files:read'], compatibility: { level: 'native', reasons: ['标准 SKILL.md，可直接导入'], requiresBridge: false, supportedFeatures: ['Cordis 插件开发', 'DSH bundle 分析'], unsupportedFeatures: [] }, categories: ['DeepSeek Harness', 'Skills'], featured: false,
  },
];

export const DEFAULT_MARKETPLACE_SOURCES: MarketplaceSource[] = [
  { id: 'openai-codex', name: 'OpenAI Codex', url: 'https://github.com/openai/codex', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'mcp-registry', name: 'Model Context Protocol Registry', url: 'https://registry.modelcontextprotocol.io', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'deepseek-harness', name: 'DeepSeek Harness', url: 'https://github.com/deepseek-ai/deepseek-harness', authority: 'official', enabled: true, updatedAt: 0 },
];

export async function resolveMarketplaceManifest(url: string): Promise<{ url: string; text: string; sha256: string }> {
  const safe = validateCustomBaseUrl(url);
  const response = await safeFetch(safe.toString(), { headers: { Accept: 'application/json, text/plain;q=0.9' }, redirect: 'manual' });
  if (!response.ok) throw new Error(`远端插件清单获取失败 (${response.status})`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 512 * 1024) throw new Error('插件清单超过 512 KiB 限制');
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error('插件清单超过 512 KiB 限制');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { url: safe.toString(), text, sha256 };
}
