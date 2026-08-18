import { db } from './db';
import type { PluginInstallRecord, PluginManifest, ProjectPluginCapability } from '../types';

const ALLOWED_LICENSES = new Set(['GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', 'ISC', 'CC-BY-4.0']);

export type MarketplaceTab = 'featured' | 'codex' | 'dsh' | 'mcp' | 'skills' | 'installed';

export function matchesMarketplaceTab(plugin: PluginManifest, tab: Exclude<MarketplaceTab, 'installed'>): boolean {
  if (tab === 'featured') return Boolean(plugin.featured);
  if (tab === 'codex') return plugin.format === 'codex-agent-plugin' || plugin.categories.includes('Codex');
  if (tab === 'dsh') return plugin.format === 'dsh-bundle' || plugin.categories.includes('DeepSeek Harness');
  if (tab === 'mcp') return plugin.format === 'mcp';
  return plugin.format === 'agent-skill' || plugin.format === 'stingy';
}

export function assertPluginInstallable(manifest: PluginManifest): void {
  if (!manifest.license) throw new Error('插件未声明许可证，不能安装');
  if (/\bAGPL\b/iu.test(manifest.license)) throw new Error('为避免引入 AGPL 代码，当前策略不允许安装此插件');
  if (!ALLOWED_LICENSES.has(manifest.license)) throw new Error(`许可证 ${manifest.license} 尚未通过 GPL-3.0-only 兼容审核`);
  if (manifest.compatibility.level === 'unavailable') throw new Error('当前宿主无法安装此插件');
}

export function addedPermissions(previous: PluginManifest | undefined, next: PluginManifest) {
  const existing = new Set(previous?.permissions ?? []);
  return next.permissions.filter((permission) => !existing.has(permission));
}

export async function fetchMarketplace(): Promise<PluginManifest[]> {
  const response = await fetch('/api/marketplace/catalog', { credentials: 'same-origin' });
  const payload = await response.json().catch(() => undefined) as { plugins?: PluginManifest[]; error?: string } | undefined;
  if (!response.ok || !payload?.plugins) throw new Error(payload?.error ?? `插件市场加载失败 (${response.status})`);
  return payload.plugins;
}

export async function installPlugin(manifest: PluginManifest, projectId?: string): Promise<PluginInstallRecord> {
  assertPluginInstallable(manifest);
  const current = await db.installedPlugins.where('pluginId').equals(manifest.id).first();
  const permissionChanges = addedPermissions(current?.manifest, manifest);
  if (current && permissionChanges.length) throw new Error(`更新新增权限：${permissionChanges.join('、')}，需要重新确认后安装`);
  const now = Date.now();
  const state: PluginInstallRecord['state'] = manifest.compatibility.requiresBridge
    ? 'pending-device-install'
    : manifest.format === 'mcp' ? 'pending-configuration' : 'installed';
  const record: PluginInstallRecord = { id: current?.id ?? crypto.randomUUID(), pluginId: manifest.id, manifest, previousManifest: current?.manifest, enabled: true, installScope: projectId ? 'project' : 'global', projectId, installedAt: current?.installedAt ?? now, updatedAt: now, state };
  await db.installedPlugins.put(record);
  return record;
}

export async function uninstallPlugin(id: string): Promise<void> { await db.installedPlugins.delete(id); }
export async function listInstalledPlugins(): Promise<PluginInstallRecord[]> { return db.installedPlugins.orderBy('updatedAt').reverse().toArray(); }

export async function listActiveProjectPluginCapabilities(projectId?: string): Promise<ProjectPluginCapability[]> {
  const records = await listInstalledPlugins();
  return records
    .filter((record) => record.enabled && record.state === 'installed' && (record.installScope === 'global' || record.projectId === projectId))
    .slice(0, 20)
    .map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      format: manifest.format,
      description: manifest.description,
      supportedFeatures: manifest.compatibility.supportedFeatures.slice(0, 12),
    }));
}
