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
    id: 'skill:dsh-plugin-development', name: 'DSH Plugin Development', version: '1.0.0', description: 'DeepSeek Harness 官方 Cordis 插件开发 Skill，用于分析 bundle 与 patch 结构。', format: 'agent-skill', sourceUrl: 'https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli/config/agent-presets/cordis/skills/cordis-plugin-development', license: 'MIT', author: 'DeepSeek AI', permissions: ['files:read'], compatibility: { level: 'native', reasons: ['标准 SKILL.md，可直接导入'], requiresBridge: false, supportedFeatures: ['Cordis 插件开发', 'DSH bundle 分析'], unsupportedFeatures: [] }, categories: ['DeepSeek Harness', 'Skills'], featured: true,
  },
  {
    id: 'mcp:microsoft-playwright', name: 'Playwright MCP', version: '2026.8.0', description: 'Microsoft 维护的浏览器自动化 MCP，通过可访问性树执行页面检查、交互和端到端验证。', format: 'mcp', sourceUrl: 'https://github.com/microsoft/playwright-mcp', license: 'Apache-2.0', author: 'Microsoft', permissions: ['command:execute', 'network', 'mcp'], compatibility: { level: 'bridge', reasons: ['浏览器进程与 stdio MCP 需要本地桥托管'], requiresBridge: true, supportedFeatures: ['页面导航', '可访问性快照', '表单交互', '浏览器测试'], unsupportedFeatures: [] }, categories: ['MCP', '浏览器', '测试'], featured: true,
  },
  {
    id: 'mcp:github-official', name: 'GitHub MCP Server', version: '2026.8.0', description: 'GitHub 官方 MCP Server，用于读取仓库、议题、拉取请求和自动化工作流。', format: 'mcp', sourceUrl: 'https://github.com/github/github-mcp-server', license: 'MIT', author: 'GitHub', permissions: ['network', 'credentials', 'mcp', 'git'], compatibility: { level: 'partial', reasons: ['远程模式可直接连接；本地 stdio 模式需要桥接'], requiresBridge: false, supportedFeatures: ['仓库读取', 'Issues', 'Pull Requests', 'Actions'], unsupportedFeatures: ['未授权的组织资源'] }, categories: ['MCP', 'GitHub', '协作'], featured: true,
  },
  {
    id: 'mcp:upstash-context7', name: 'Context7', version: '2026.8.0', description: '按库与版本检索最新开发文档，将相关 API 片段按需提供给工程对话。', format: 'mcp', sourceUrl: 'https://github.com/upstash/context7', license: 'MIT', author: 'Upstash', permissions: ['network', 'mcp'], compatibility: { level: 'native', reasons: ['支持可由浏览器连接的远程 MCP 服务'], requiresBridge: false, supportedFeatures: ['文档检索', '版本定位', '代码示例'], unsupportedFeatures: [] }, categories: ['MCP', '文档', '检索'], featured: true,
  },
  {
    id: 'mcp:cloudflare-official', name: 'Cloudflare MCP Servers', version: '2026.8.0', description: 'Cloudflare 官方远程 MCP 集合，覆盖 Workers、文档、可观测性与开发者平台资源。', format: 'mcp', sourceUrl: 'https://github.com/cloudflare/mcp-server-cloudflare', license: 'Apache-2.0', author: 'Cloudflare', permissions: ['network', 'credentials', 'mcp'], compatibility: { level: 'native', reasons: ['官方服务器提供远程 MCP 连接路径'], requiresBridge: false, supportedFeatures: ['Workers', '文档检索', '日志与分析'], unsupportedFeatures: ['未授权账户操作'] }, categories: ['MCP', 'Cloudflare', '部署'], featured: true,
  },
  {
    id: 'mcp:desktop-commander', name: 'Desktop Commander', version: '2026.8.0', description: '面向本机工程任务的文件、搜索、进程与终端工具，受 StingyChat 授权根目录限制。', format: 'mcp', sourceUrl: 'https://github.com/wonderwhy-er/DesktopCommanderMCP', license: 'MIT', author: 'Desktop Commander', permissions: ['files:read', 'files:write', 'command:execute', 'network', 'mcp'], compatibility: { level: 'bridge', reasons: ['包含本机文件和进程能力，必须在完全访问模式隔离运行'], requiresBridge: true, supportedFeatures: ['文件管理', '内容搜索', '受控终端', '进程管理'], unsupportedFeatures: ['授权根目录外自动访问'] }, categories: ['MCP', '文件', '终端'], featured: true,
  },
  {
    id: 'mcp:chrome-devtools', name: 'Chrome DevTools MCP', version: '2026.8.0', description: 'Chrome DevTools 团队维护的浏览器调试 MCP，支持性能分析、网络检查与页面自动化。', format: 'mcp', sourceUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', license: 'Apache-2.0', author: 'Chrome DevTools', permissions: ['command:execute', 'network', 'mcp'], compatibility: { level: 'bridge', reasons: ['需要启动或附加本机 Chrome 调试进程'], requiresBridge: true, supportedFeatures: ['性能追踪', '网络检查', '控制台诊断', '页面自动化'], unsupportedFeatures: [] }, categories: ['MCP', '浏览器', '调试'], featured: true,
  },
  {
    id: 'mcp:notion-official', name: 'Notion MCP Server', version: '2026.8.0', description: 'Notion 官方 MCP Server，为工程任务提供页面、数据库与工作区内容访问。', format: 'mcp', sourceUrl: 'https://github.com/makenotion/notion-mcp-server', license: 'MIT', author: 'Notion', permissions: ['network', 'credentials', 'mcp'], compatibility: { level: 'native', reasons: ['官方提供远程 MCP 连接方式'], requiresBridge: false, supportedFeatures: ['页面检索', '数据库查询', '内容更新'], unsupportedFeatures: ['未授权工作区内容'] }, categories: ['MCP', 'Notion', '知识库'], featured: true,
  },
  {
    id: 'mcp:stripe-official', name: 'Stripe MCP Server', version: '2026.8.0', description: 'Stripe 官方 AI 工具集中的 MCP Server，用于查询开发文档和受控账户资源。', format: 'mcp', sourceUrl: 'https://github.com/stripe/ai', license: 'MIT', author: 'Stripe', permissions: ['network', 'credentials', 'mcp'], compatibility: { level: 'native', reasons: ['支持远程 MCP；账户操作仍受 Stripe 授权范围约束'], requiresBridge: false, supportedFeatures: ['开发文档', '账户资源查询', '支付集成辅助'], unsupportedFeatures: ['未确认的高风险支付操作'] }, categories: ['MCP', 'Stripe', '支付'], featured: true,
  },
  {
    id: 'mcp:aws-labs', name: 'AWS Labs MCP Servers', version: '2026.8.0', description: 'AWS Labs 维护的开源 MCP Server 集合，覆盖文档、架构、成本与云资源开发工作流。', format: 'mcp', sourceUrl: 'https://github.com/awslabs/mcp', license: 'Apache-2.0', author: 'AWS Labs', permissions: ['command:execute', 'network', 'credentials', 'mcp'], compatibility: { level: 'bridge', reasons: ['本地服务器与云凭据需要在本地桥隔离运行'], requiresBridge: true, supportedFeatures: ['AWS 文档', '架构辅助', '成本分析', '资源工具'], unsupportedFeatures: ['超出 IAM 权限的资源'] }, categories: ['MCP', 'AWS', '云平台'], featured: true,
  },
  {
    id: 'mcp:microsoft-catalog', name: 'Microsoft MCP Servers', version: '2026.8.0', description: 'Microsoft 官方 MCP 实现目录，为 Azure 与 Microsoft 开发者服务提供统一工具入口。', format: 'mcp', sourceUrl: 'https://github.com/microsoft/mcp', license: 'MIT', author: 'Microsoft', permissions: ['command:execute', 'network', 'credentials', 'mcp'], compatibility: { level: 'partial', reasons: ['远程服务可直接连接；本地实现需要桥接'], requiresBridge: false, supportedFeatures: ['官方服务器目录', 'Azure 开发工具', '数据服务连接'], unsupportedFeatures: ['未安装的本地运行时'] }, categories: ['MCP', 'Microsoft', 'Azure'], featured: true,
  },
  {
    id: 'mcp:microsoft-learn', name: 'Microsoft Learn MCP', version: '2026.8.0', description: 'Microsoft Learn 官方 MCP Server，提供实时文档、代码示例与产品知识检索。', format: 'mcp', sourceUrl: 'https://github.com/MicrosoftDocs/mcp', license: 'CC-BY-4.0', author: 'Microsoft Learn', permissions: ['network', 'mcp'], compatibility: { level: 'native', reasons: ['官方远程 MCP 可由浏览器直接连接'], requiresBridge: false, supportedFeatures: ['文档检索', '代码示例', '产品概念查询'], unsupportedFeatures: [] }, categories: ['MCP', 'Microsoft', '文档'], featured: true,
  },
  {
    id: 'mcp:markitdown', name: 'MarkItDown MCP', version: '2026.8.0', description: 'Microsoft MarkItDown 提供的 MCP 服务，将 PDF、Office 与常见文件转换为适合模型处理的 Markdown。', format: 'mcp', sourceUrl: 'https://github.com/microsoft/markitdown', license: 'MIT', author: 'Microsoft', permissions: ['files:read', 'command:execute', 'mcp'], compatibility: { level: 'bridge', reasons: ['Python MCP 进程与本地文件读取需要本地桥'], requiresBridge: true, supportedFeatures: ['PDF 转换', 'Office 转换', '结构化 Markdown'], unsupportedFeatures: ['授权根目录外文件'] }, categories: ['MCP', '文件', '文档转换'], featured: true,
  },
];

export const DEFAULT_MARKETPLACE_SOURCES: MarketplaceSource[] = [
  { id: 'openai-codex', name: 'OpenAI Codex', url: 'https://github.com/openai/codex', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'mcp-registry', name: 'Model Context Protocol Registry', url: 'https://registry.modelcontextprotocol.io', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'deepseek-harness', name: 'DeepSeek Harness', url: 'https://github.com/deepseek-ai/deepseek-harness', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'github-mcp', name: 'GitHub MCP Server', url: 'https://github.com/github/github-mcp-server', authority: 'official', enabled: true, updatedAt: 0 },
  { id: 'cloudflare-mcp', name: 'Cloudflare MCP Servers', url: 'https://github.com/cloudflare/mcp-server-cloudflare', authority: 'official', enabled: true, updatedAt: 0 },
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
