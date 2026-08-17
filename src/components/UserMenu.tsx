import { Check, DatabaseBackup, Download, Files, Github, LogIn, LogOut, Moon, Settings2, ShieldCheck, Sun, Upload, UserRound } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { GITHUB_REPOSITORY_URL } from '../config';
import { loginUrl } from '../lib/auth';
import { createDataExport, validateDataImport } from '../lib/cloudSync';
import { useAppStore } from '../store';
import type { DataExportBundle } from '../types';
import { IconButton, Modal } from './ui';

const SYNC_LABEL = { idle: '已同步', syncing: '正在同步', pending: '等待同步', offline: '离线保存', error: '部分内容未同步' } as const;

function downloadJson(bundle: DataExportBundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `stingychat-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function downloadCloudData(): Promise<void> {
  const response = await fetch('/api/conversations/export', { credentials: 'same-origin' });
  const payload = await response.json().catch(() => undefined) as (DataExportBundle & { error?: string }) | undefined;
  if (!response.ok || !payload) throw new Error(payload?.error ?? `云端副本下载失败 (${response.status})`);
  downloadJson(validateDataImport(payload));
}

export function UserMenu() {
  const reduceMotion = useReducedMotion(); const rootRef = useRef<HTMLDivElement>(null); const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false); const [pinned, setPinned] = useState(false); const [importBundle, setImportBundle] = useState<DataExportBundle>(); const [notice, setNotice] = useState('');
  const auth = useAppStore((state) => state.auth); const settings = useAppStore((state) => state.settings); const conversations = useAppStore((state) => state.conversations);
  const favoriteModels = useAppStore((state) => state.favoriteModels); const personalization = useAppStore((state) => state.personalization); const syncStatus = useAppStore((state) => state.syncStatus); const syncDetail = useAppStore((state) => state.syncDetail);
  const view = useAppStore((state) => state.view); const setView = useAppStore((state) => state.setView); const updateSettings = useAppStore((state) => state.updateSettings); const setSettingsOpen = useAppStore((state) => state.setSettingsOpen); const setArtifactPanelOpen = useAppStore((state) => state.setArtifactPanelOpen); const importData = useAppStore((state) => state.importData); const logout = useAppStore((state) => state.logout);
  const canAdmin = auth.user?.permissions.includes('admin_users_read');

  const close = () => { setOpen(false); setPinned(false); };
  useEffect(close, [view]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]; if (!items.length) return;
      event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLElement); const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length; items[next].focus();
    };
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const desktopHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const enter = () => { if (!desktopHover()) return; clearTimeout(closeTimer.current); setOpen(true); };
  const leave = () => { if (!desktopHover() || pinned) return; closeTimer.current = setTimeout(() => setOpen(false), 120); };
  const choose = (action: () => void) => { action(); close(); };

  return (
    <>
      <a className="topbar-github" href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="打开 GitHub 开源仓库" title="GitHub 开源仓库">
        <motion.span animate={reduceMotion ? undefined : { opacity: [1, .58, 1], filter: ['drop-shadow(0 0 2px #39d98a)', 'drop-shadow(0 0 9px #39d98a)', 'drop-shadow(0 0 2px #39d98a)'] }} transition={{ duration: 1.44, repeat: Infinity }}><Github size={18} /></motion.span>
      </a>
      <IconButton label="打开生成文件" className="topbar-artifacts" onClick={() => setArtifactPanelOpen(true)}><Files size={18} /></IconButton>
      <div className="user-menu-root" ref={rootRef} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter}>
        <button className={`user-avatar-button ${open ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => { setPinned(!open || !pinned); setOpen(!open || !pinned); }}>
          {auth.user?.avatarUrl ? <img src={auth.user.avatarUrl} alt="" /> : <span>{auth.user?.displayName?.slice(0, 1) ?? <UserRound size={17} />}</span>}
        </button>
        <AnimatePresence>
          {open ? <motion.div className="user-menu" role="menu" initial={{ opacity: 0, y: -7, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .99 }} transition={{ duration: reduceMotion ? 0 : .144 }}>
            <div className="user-menu-account">
              <span>{auth.user?.displayName?.slice(0, 1) ?? <UserRound size={18} />}</span>
              <div><strong>{auth.user?.displayName ?? '访客模式'}</strong><small>{auth.user ? `${auth.user.role.toUpperCase()} · ${auth.user.username}` : '登录后启用云同步与优化能力'}</small></div>
            </div>
            {auth.authenticated ? <div className={`sync-menu-status is-${syncStatus}`} title={syncDetail}><i /> <span>{SYNC_LABEL[syncStatus]}</span>{syncStatus === 'idle' ? <Check size={13} /> : null}</div> : null}
            <div className="user-menu-group">
              <button role="menuitem" onClick={() => choose(() => setSettingsOpen(true))}><Settings2 size={16} /><span>设置</span></button>
              <button role="menuitem" className="menu-artifacts" onClick={() => choose(() => setArtifactPanelOpen(true))}><Files size={16} /><span>生成文件</span></button>
              <button role="menuitem" onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>{settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}<span>{settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'}</span></button>
            </div>
            <div className="user-menu-group">
              <button role="menuitem" onClick={() => downloadJson(createDataExport(settings, favoriteModels, personalization, conversations))}><Download size={16} /><span>导出数据</span></button>
              <label role="menuitem" tabIndex={0}><Upload size={16} /><span>导入数据与对话</span><input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { setImportBundle(validateDataImport(JSON.parse(await file.text()))); } catch { setNotice('导入文件格式无效或版本不受支持。'); } close(); }} /></label>
              {auth.authenticated ? <button role="menuitem" onClick={() => { close(); void downloadCloudData().catch((error) => setNotice(error instanceof Error ? error.message : '云端副本下载失败')); }}><DatabaseBackup size={16} /><span>下载云端副本</span></button> : null}
            </div>
            {canAdmin ? <div className="user-menu-group"><button role="menuitem" onClick={() => choose(() => setView('admin'))}><ShieldCheck size={16} /><span>管理后台</span></button></div> : null}
            <div className="user-menu-group">
              {auth.authenticated ? <button role="menuitem" className="danger" onClick={() => choose(() => void logout())}><LogOut size={16} /><span>退出登录</span></button> : <a role="menuitem" href={loginUrl()}><LogIn size={16} /><span>使用 CP OAuth 登录</span></a>}
            </div>
          </motion.div> : null}
        </AnimatePresence>
      </div>
      <Modal open={Boolean(importBundle)} title="确认导入数据" onClose={() => setImportBundle(undefined)}>
        {importBundle ? <div className="modal-content"><p>将导入 {importBundle.conversations.length} 个对话，并按 UUID 与更新时间去重。密钥和原始附件二进制不在导入范围内。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setImportBundle(undefined)}>取消</button><button className="primary-button" onClick={async () => { const result = await importData(importBundle); setNotice(`导入完成：新增 ${result.added} 个，更新 ${result.updated} 个。`); setImportBundle(undefined); }}>确认导入</button></div></div> : null}
      </Modal>
      <Modal open={Boolean(notice)} title="数据工具" onClose={() => setNotice('')}><div className="modal-content"><p>{notice}</p><div className="modal-actions"><button className="primary-button" onClick={() => setNotice('')}>完成</button></div></div></Modal>
    </>
  );
}
