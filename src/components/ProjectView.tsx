import Editor from '@monaco-editor/react';
import { diffLines } from 'diff';
import { BookMarked, Braces, Code2, FileCode2, FolderOpen, GitBranch, History, LoaderCircle, PlugZap, RotateCcw, Save, Send, Shield, SquareTerminal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/db';
import { appendProjectEvent, createCheckpoint, listProjectFiles, openProjectDirectory, restoreCheckpoint, saveProjectFile } from '../lib/projectWorkspace';
import { useAppStore } from '../store';
import type { ProjectCheckpoint, ProjectEvent, ProjectFile, ProjectPermissionMode, ProjectWorkspace } from '../types';
import { PluginMarketplace } from './PluginMarketplace';
import { pairBridge, type BridgeCapabilities } from '../lib/bridge';
import { syncBrowserGit } from '../lib/browserGit';

type ProjectPanel = 'assistant' | 'changes' | 'terminal' | 'plugins';
const MODE_LABEL: Record<ProjectPermissionMode, string> = { read: '只读', workspace: '工作区', full: '完全访问' };

export function ProjectView() {
  const auth = useAppStore((state) => state.auth);
  const namespace = useAppStore((state) => state.namespace);
  const [projects, setProjects] = useState<ProjectWorkspace[]>([]);
  const [activeId, setActiveId] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [draft, setDraft] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [panel, setPanel] = useState<ProjectPanel>('assistant');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [bridgeCode, setBridgeCode] = useState('');
  const [bridgeInfo, setBridgeInfo] = useState<BridgeCapabilities>();
  const [gitStatus, setGitStatus] = useState<string[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const project = projects.find((item) => item.id === activeId);
  const activeFile = files.find((item) => item.path === activePath);
  const canProject = Boolean(auth.user?.permissions.includes('project_mode'));
  const canFull = Boolean(auth.user?.permissions.includes('project_full_access'));

  const loadProject = async (id: string) => {
    const [nextFiles, nextEvents, nextCheckpoints] = await Promise.all([listProjectFiles(id), db.projectEvents.where('projectId').equals(id).sortBy('createdAt'), db.projectCheckpoints.where('projectId').equals(id).reverse().sortBy('createdAt')]);
    setFiles(nextFiles); setEvents(nextEvents); setCheckpoints(nextCheckpoints);
    const preferred = projects.find((item) => item.id === id)?.activeFilePath;
    const path = nextFiles.some((item) => item.path === preferred) ? preferred! : nextFiles[0]?.path ?? '';
    setActivePath(path); const file = nextFiles.find((item) => item.path === path); setDraft(file?.content ?? ''); setSavedContent(file?.content ?? '');
  };
  useEffect(() => { db.projects.where('namespace').equals(namespace).reverse().sortBy('updatedAt').then((items) => { setProjects(items); const id = items[0]?.id ?? ''; setActiveId(id); if (id) void loadProject(id); }); }, [namespace]);
  useEffect(() => { const file = files.find((item) => item.path === activePath); setDraft(file?.content ?? ''); setSavedContent(file?.content ?? ''); }, [activePath]);

  const changed = Boolean(activeFile && draft !== savedContent);
  const changes = useMemo(() => changed ? diffLines(savedContent, draft) : [], [changed, draft, savedContent]);
  const persistDraft = async () => {
    if (!project || !activeFile || !changed || project.permissionMode === 'read') return;
    await createCheckpoint(project.id, `自动保存前 · ${activeFile.path}`);
    const updated = await saveProjectFile(project, activeFile, draft);
    setFiles((items) => items.map((item) => item.id === updated.id ? updated : item)); setSavedContent(draft);
    setCheckpoints(await db.projectCheckpoints.where('projectId').equals(project.id).reverse().sortBy('createdAt'));
  };
  useEffect(() => { clearTimeout(saveTimer.current); if (changed && project?.permissionMode !== 'read') saveTimer.current = setTimeout(() => void persistDraft().catch((error) => setNotice(error instanceof Error ? error.message : '自动保存失败')), 700); return () => clearTimeout(saveTimer.current); }, [draft, changed, activePath, project?.permissionMode]);

  const openProject = async () => {
    try { const next = await openProjectDirectory(namespace, 'read'); setProjects((items) => [next, ...items]); setActiveId(next.id); await loadProject(next.id); setNotice(''); }
    catch (error) { if ((error as DOMException)?.name !== 'AbortError') setNotice(error instanceof Error ? error.message : '无法打开项目'); }
  };
  const changeMode = async (mode: ProjectPermissionMode) => {
    if (!project || (mode === 'full' && !canFull)) return;
    const effective = project.fallback && mode === 'full' ? 'workspace' : mode;
    const updated = { ...project, permissionMode: effective, updatedAt: Date.now() };
    await db.projects.put(updated); setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    if (mode === 'full' && effective !== 'full') setNotice('当前浏览器使用导入副本，无法启用完全访问。');
  };
  const askAgent = async () => {
    if (!project || !prompt.trim() || busy) return;
    const question = prompt.trim(); setPrompt(''); setBusy(true); setNotice('');
    const userEvent = await appendProjectEvent(project.id, 'user', question); setEvents((items) => [...items, userEvent]);
    try {
      const response = await fetch('/api/project/agent/step', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, prompt: question, permissionMode: project.permissionMode, activeFile: activeFile ? { path: activeFile.path, content: activeFile.content.slice(0, 80_000), language: activeFile.language } : undefined, fileIndex: files.map(({ path, language, size }) => ({ path, language, size })).slice(0, 1_000) }) });
      const payload = await response.json().catch(() => undefined) as { summary?: string; files?: Array<{ path: string; content: string }>; error?: string } | undefined;
      if (!response.ok || !payload?.summary) throw new Error(payload?.error ?? `工程助手请求失败 (${response.status})`);
      if (payload.files?.length && project.permissionMode !== 'read') {
        await createCheckpoint(project.id, `智能助手修改前 · ${question.slice(0, 30)}`);
        for (const proposal of payload.files.slice(0, 20)) {
          if (proposal.path.includes('..')) continue;
          const existing = files.find((item) => item.path === proposal.path) ?? { id: `${project.id}:${proposal.path}`, projectId: project.id, path: proposal.path, content: '', language: 'plaintext', size: 0, updatedAt: Date.now() };
          await saveProjectFile(project, existing, proposal.content);
        }
        setFiles(await listProjectFiles(project.id));
      }
      const assistantEvent = await appendProjectEvent(project.id, 'assistant', payload.summary); setEvents((items) => [...items, assistantEvent]);
    } catch (error) { const message = error instanceof Error ? error.message : '工程助手执行失败'; const event = await appendProjectEvent(project.id, 'error', message); setEvents((items) => [...items, event]); setNotice(message); }
    finally { setBusy(false); }
  };

  if (!auth.authenticated || !canProject) return <section className="project-locked"><span><Shield size={24} /></span><h2>工程模式需要账号权限</h2><p>登录后可在授权目录内使用文件分析、检查点、插件和受控工具。源码不会上传到账号数据。</p><a href="/api/auth/login?returnTo=%2Fproject">登录并继续</a></section>;

  return <div className="project-workbench">
    <aside className="project-explorer"><header><div><strong>项目</strong><small>{projects.length} 个本地工作区</small></div><button onClick={openProject} title="打开本地目录"><FolderOpen size={17} /></button></header>
      {projects.length ? <select value={activeId} onChange={(event) => { setActiveId(event.target.value); void loadProject(event.target.value); }}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <button className="open-project-empty" onClick={openProject}><FolderOpen size={22} /><span>打开本地项目</span><small>目录内容仅保存在此设备</small></button>}
      {project ? <div className="permission-control" aria-label="工程权限">{(['read','workspace','full'] as const).map((mode) => <button key={mode} className={project.permissionMode === mode ? 'active' : ''} disabled={mode === 'full' && !canFull} onClick={() => void changeMode(mode)}>{MODE_LABEL[mode]}</button>)}</div> : null}
      <div className="project-file-list">{files.map((file) => <button key={file.id} className={activePath === file.path ? 'active' : ''} onClick={() => setActivePath(file.path)} title={file.path}><FileCode2 size={14} /><span>{file.path}</span><small>{Math.max(1, Math.round(file.size / 1024))}K</small></button>)}</div>
    </aside>
    <main className="project-editor"><header><div><Code2 size={15} /><span>{activePath || '未选择文件'}</span>{changed ? <i>修改中</i> : null}</div><button disabled={!changed || project?.permissionMode === 'read'} onClick={() => void persistDraft()}><Save size={15} /> 保存</button></header>
      {activeFile ? <Editor height="100%" language={activeFile.language} value={draft} onChange={(value) => setDraft(value ?? '')} theme={document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'light'} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', smoothScrolling: true, readOnly: project?.permissionMode === 'read', padding: { top: 14 }, automaticLayout: true }} /> : <div className="editor-empty"><Braces size={35} /><h2>连接一个项目目录</h2><p>选择文件后可在此编辑、审查差异并让智能助手执行工程任务。</p><button onClick={openProject}><FolderOpen size={16} /> 打开目录</button></div>}
    </main>
    <aside className="project-inspector"><nav>{([['assistant',<Send size={15}/>,'助手'],['changes',<GitBranch size={15}/>,'更改'],['terminal',<SquareTerminal size={15}/>,'终端'],['plugins',<PlugZap size={15}/>,'插件']] as const).map(([id,icon,label]) => <button key={id} className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}>{icon}<span>{label}</span></button>)}</nav>
      <AnimatePresence mode="wait"><motion.div key={panel} className="inspector-content" initial={{ opacity: 0, x: 7 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -5 }} transition={{ duration: .128 }}>
        {panel === 'assistant' ? <><div className="project-events">{events.map((event) => <article key={event.id} className={`event-${event.type}`}><small>{event.type === 'user' ? '你' : event.type === 'assistant' ? '智能助手' : event.type === 'error' ? '失败' : event.type}</small><p>{event.content}</p></article>)}{!events.length ? <div className="project-panel-empty"><Send size={24} /><p>描述需要分析、修改或验证的工程任务。</p></div> : null}</div><div className="project-agent-composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="向智能助手描述工程任务" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAgent(); } }} /><button onClick={() => void askAgent()} disabled={busy || !prompt.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button></div></> : null}
        {panel === 'changes' ? <div className="changes-panel">{changes.length ? changes.map((part, index) => <pre key={index} className={part.added ? 'added' : part.removed ? 'removed' : ''}>{part.value}</pre>) : <div className="project-panel-empty"><GitBranch size={24} /><p>当前文件没有未保存更改。</p></div>}<button className="browser-git-refresh" disabled={!project} onClick={async () => { if (!project) return; const matrix = await syncBrowserGit(project.id, files); setGitStatus(matrix.filter(([,head,workdir,stage]) => head !== workdir || workdir !== stage).map(([path]) => path)); }}><GitBranch size={14} /> 刷新浏览器 Git 状态</button>{gitStatus.length ? <div className="browser-git-status">{gitStatus.map((path) => <span key={path}>{path}</span>)}</div> : null}<details><summary><History size={14} /> 本地检查点</summary>{checkpoints.map((checkpoint) => <button key={checkpoint.id} onClick={async () => { if (!project) return; await restoreCheckpoint(project, checkpoint); await loadProject(project.id); }}><BookMarked size={14} /><span>{checkpoint.label}</span><small>{new Date(checkpoint.createdAt).toLocaleString('zh-CN')}</small><RotateCcw size={13} /></button>)}</details></div> : null}
        {panel === 'terminal' ? <div className="terminal-panel"><div><span /> <span /> <span /></div><pre>{project?.permissionMode !== 'full' ? '终端仅在“完全访问”权限下可用。\n工作区模式不会执行任何本机命令。' : bridgeInfo ? `Stingy Bridge ${bridgeInfo.version} 已连接\n授权根目录：${bridgeInfo.root}\n能力：${bridgeInfo.capabilities.join(', ')}` : '未连接本地桥。\n在项目目录运行 npm run bridge -- --root <目录>，然后输入终端显示的一次性配对码。'}</pre>{project?.permissionMode === 'full' && !bridgeInfo ? <div className="bridge-pair"><input inputMode="numeric" maxLength={6} value={bridgeCode} onChange={(event) => setBridgeCode(event.target.value.replace(/\D/gu, ''))} placeholder="六位配对码" /><button disabled={bridgeCode.length !== 6} onClick={async () => { try { setBridgeInfo(await pairBridge(bridgeCode)); setBridgeCode(''); } catch (error) { setNotice(error instanceof Error ? error.message : '本地桥配对失败'); } }}><SquareTerminal size={15} /> 配对</button></div> : null}</div> : null}
        {panel === 'plugins' ? <PluginMarketplace projectId={project?.id} /> : null}
      </motion.div></AnimatePresence>
    </aside>
    {notice ? <div className="project-toast"><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div> : null}
  </div>;
}
