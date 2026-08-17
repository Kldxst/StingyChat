import { AlertTriangle, Box, Check, Download, ExternalLink, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { fetchMarketplace, installPlugin, listInstalledPlugins, uninstallPlugin } from '../lib/marketplace';
import { pluginFormatLabel } from '../lib/pluginAdapters';
import type { PluginInstallRecord, PluginManifest } from '../types';
import { useAppStore } from '../store';
import { connectHttpMcp, type ConnectedMcp } from '../lib/mcpClient';

const LEVEL_LABEL = { native: '原生兼容', bridge: '本地桥接', partial: '部分兼容', unavailable: '不可用' } as const;
type MarketTab = 'featured' | 'codex' | 'dsh' | 'mcp' | 'skills' | 'installed';

export function PluginMarketplace({ projectId }: { projectId?: string }) {
  const canInstall = useAppStore((state) => Boolean(state.auth.user?.permissions.includes('plugin_install')));
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<PluginInstallRecord[]>([]);
  const [tab, setTab] = useState<MarketTab>('featured');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [mcpConnection, setMcpConnection] = useState<ConnectedMcp>();
  const refreshInstalled = () => listInstalledPlugins().then(setInstalled);
  const refresh = () => { setLoading(true); Promise.all([fetchMarketplace(), listInstalledPlugins()]).then(([catalog, records]) => { setPlugins(catalog); setInstalled(records); setNotice(''); }).catch((error) => setNotice(error instanceof Error ? error.message : '插件市场暂不可用')).finally(() => setLoading(false)); };
  useEffect(refresh, []);
  const installedIds = useMemo(() => new Set(installed.map((item) => item.pluginId)), [installed]);
  const visible = useMemo(() => {
    if (tab === 'installed') return installed.map((item) => item.manifest).filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
    return plugins.filter((plugin) => {
      if (query && !`${plugin.name} ${plugin.description} ${plugin.categories.join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (tab === 'featured') return plugin.featured;
      if (tab === 'codex') return plugin.format === 'codex-agent-plugin';
      if (tab === 'dsh') return plugin.format === 'dsh-bundle';
      if (tab === 'mcp') return plugin.format === 'mcp';
      return plugin.format === 'agent-skill' || plugin.format === 'stingy';
    });
  }, [installed, plugins, query, tab]);

  return <section className="plugin-market" aria-label="插件市场">
    <header><div><span className="market-mark"><PlugZap size={19} /></span><div><h2>插件市场</h2><p>经过来源校验的 Codex、DeepSeek Harness、MCP 与 Agent Skills</p></div></div><button className="project-icon-button" onClick={refresh} disabled={loading} title="刷新市场"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></header>
    <div className="market-controls"><div className="market-tabs" role="tablist">{([['featured','精选'],['codex','Codex'],['dsh','DSH'],['mcp','MCP'],['skills','Skills'],['installed','已安装']] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div><label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件、能力或来源" /></label></div>
    {notice ? <div className="market-notice"><AlertTriangle size={15} />{notice}</div> : null}
    {tab === 'mcp' ? <div className="mcp-connect"><input value={mcpEndpoint} onChange={(event) => setMcpEndpoint(event.target.value)} placeholder="https://mcp.example.com/mcp" /><button disabled={!canInstall || !mcpEndpoint} onClick={async () => { try { await mcpConnection?.close(); const connected = await connectHttpMcp(new URL(mcpEndpoint).hostname, mcpEndpoint); setMcpConnection(connected); setNotice(`已连接 ${connected.tools.length} 个工具`); } catch (error) { setNotice(error instanceof Error ? error.message : 'MCP 连接失败'); } }}>连接 HTTP MCP</button>{mcpConnection ? <div>{mcpConnection.tools.map((tool) => <span key={tool.name} title={tool.originalName}>{tool.name}</span>)}</div> : null}</div> : null}
    <div className="plugin-grid"><AnimatePresence mode="popLayout">{visible.map((plugin) => {
      const record = installed.find((item) => item.pluginId === plugin.id);
      const active = installedIds.has(plugin.id);
      return <motion.article layout key={plugin.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .98 }}>
        <div className="plugin-card-head"><span><Box size={17} /></span><div><h3>{plugin.name}</h3><small>{pluginFormatLabel(plugin.format)} · {plugin.version}</small></div><i className={`compat-${plugin.compatibility.level}`}>{LEVEL_LABEL[plugin.compatibility.level]}</i></div>
        <p>{plugin.description}</p>
        <div className="plugin-permissions">{plugin.permissions.length ? plugin.permissions.slice(0, 4).map((permission) => <span key={permission}>{permission}</span>) : <span>无需额外权限</span>}</div>
        <div className="plugin-reason"><ShieldCheck size={13} /><span>{plugin.compatibility.reasons[0]}</span></div>
        <footer><a href={plugin.sourceUrl} target="_blank" rel="noreferrer">来源 <ExternalLink size={12} /></a>{active ? <button className="plugin-remove" onClick={async () => { if (record) await uninstallPlugin(record.id); await refreshInstalled(); }}><Trash2 size={14} /> 卸载</button> : <button disabled={!canInstall || plugin.compatibility.level === 'unavailable'} title={!canInstall ? '当前账号没有插件安装权限' : undefined} onClick={async () => { try { await installPlugin(plugin, projectId); await refreshInstalled(); } catch (error) { setNotice(error instanceof Error ? error.message : '安装失败'); } }}><Download size={14} /> 安装</button>}</footer>
        {record?.state === 'pending-device-install' ? <div className="bridge-required">需连接本地桥后完成安装</div> : active ? <div className="installed-state"><Check size={12} /> 已在当前设备启用</div> : null}
      </motion.article>;
    })}</AnimatePresence>{!loading && !visible.length ? <div className="market-empty">当前分类暂无匹配插件</div> : null}</div>
  </section>;
}
