import Editor from '@monaco-editor/react';
import { diffLines } from 'diff';
import {
  BookMarked, Braces, Check, ChevronDown, Code2, Copy, Download, FileCode2,
  FolderOpen, GitBranch, History, LoaderCircle, MessageSquare, PlugZap, RotateCcw,
  Save, Send, Shield, Square, SquareTerminal, X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectAgentStep } from '../lib/api';
import { pairBridge, type BridgeCapabilities } from '../lib/bridge';
import { syncBrowserGit } from '../lib/browserGit';
import { db } from '../lib/db';
import {
  appendProjectEvent, createCheckpoint, listProjectFiles, openProjectDirectory,
  restoreCheckpoint, saveProjectFile,
} from '../lib/projectWorkspace';
import { useAppStore } from '../store';
import type {
  ProjectCheckpoint, ProjectEvent, ProjectFile, ProjectPermissionMode, ProjectWorkspace,
} from '../types';
import { PluginMarketplace } from './PluginMarketplace';

type ProjectSurface = 'chat' | 'editor' | 'changes' | 'plugins' | 'bridge';
const MODE_LABEL: Record<ProjectPermissionMode, string> = { read: '只读', workspace: '工作区', full: '完全访问' };
const SURFACES: Array<{ id: ProjectSurface; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'editor', label: '编辑', icon: Code2 },
  { id: 'changes', label: '更改', icon: GitBranch },
  { id: 'plugins', label: '插件', icon: PlugZap },
  { id: 'bridge', label: '桥接', icon: SquareTerminal },
];
const BRIDGE_COMMAND = 'node "$env:USERPROFILE\\Downloads\\stingy-bridge.mjs" --root .';
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:47321';

function localEvent(projectId: string, type: ProjectEvent['type'], content: string): ProjectEvent {
  return { id: crypto.randomUUID(), projectId, type, content, createdAt: Date.now() };
}

export function ProjectView() {
  const auth = useAppStore((state) => state.auth);
  const namespace = useAppStore((state) => state.namespace);
  const sessionId = useRef(crypto.randomUUID());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ProjectWorkspace[]>([]);
  const [activeId, setActiveId] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [draft, setDraft] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [surface, setSurface] = useState<ProjectSurface>('chat');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [failedPrompt, setFailedPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [bridgeCode, setBridgeCode] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(() => localStorage.getItem('stingy:bridge-url') ?? DEFAULT_BRIDGE_URL);
  const [bridgeInfo, setBridgeInfo] = useState<BridgeCapabilities>();
  const [copied, setCopied] = useState(false);
  const [gitStatus, setGitStatus] = useState<string[]>([]);
  const project = projects.find((item) => item.id === activeId);
  const activeFile = files.find((item) => item.path === activePath);
  const canProject = Boolean(auth.user?.permissions.includes('project_mode'));
  const canFull = Boolean(auth.user?.permissions.includes('project_full_access'));

  const loadProject = async (id: string, knownProjects = projects) => {
    const [nextFiles, nextEvents, nextCheckpoints] = await Promise.all([
      listProjectFiles(id),
      db.projectEvents.where('projectId').equals(id).sortBy('createdAt'),
      db.projectCheckpoints.where('projectId').equals(id).reverse().sortBy('createdAt'),
    ]);
    setFiles(nextFiles);
    setEvents(nextEvents);
    setCheckpoints(nextCheckpoints);
    const preferred = knownProjects.find((item) => item.id === id)?.activeFilePath;
    const path = nextFiles.some((item) => item.path === preferred) ? preferred! : nextFiles[0]?.path ?? '';
    const file = nextFiles.find((item) => item.path === path);
    setActivePath(path);
    setDraft(file?.content ?? '');
    setSavedContent(file?.content ?? '');
  };

  useEffect(() => {
    void db.projects.where('namespace').equals(namespace).reverse().sortBy('updatedAt').then((items) => {
      setProjects(items);
      const id = items[0]?.id ?? '';
      setActiveId(id);
      if (id) void loadProject(id, items);
    });
  }, [namespace]);
  useEffect(() => {
    const file = files.find((item) => item.path === activePath);
    setDraft(file?.content ?? '');
    setSavedContent(file?.content ?? '');
  }, [activePath]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end', behavior: busy ? 'smooth' : 'auto' });
  }, [events, busy, phase]);

  const changed = Boolean(activeFile && draft !== savedContent);
  const changes = useMemo(() => changed ? diffLines(savedContent, draft) : [], [changed, draft, savedContent]);
  const persistDraft = async () => {
    if (!project || !activeFile || !changed || project.permissionMode === 'read') return;
    await createCheckpoint(project.id, `自动保存前 · ${activeFile.path}`);
    const updated = await saveProjectFile(project, activeFile, draft);
    setFiles((items) => items.map((item) => item.id === updated.id ? updated : item));
    setSavedContent(draft);
    setCheckpoints(await db.projectCheckpoints.where('projectId').equals(project.id).reverse().sortBy('createdAt'));
  };
  useEffect(() => {
    clearTimeout(saveTimer.current);
    if (changed && project?.permissionMode !== 'read') {
      saveTimer.current = setTimeout(() => void persistDraft().catch((error) => setNotice(error instanceof Error ? error.message : '自动保存失败')), 700);
    }
    return () => clearTimeout(saveTimer.current);
  }, [draft, changed, activePath, project?.permissionMode]);

  const openProject = async () => {
    try {
      const next = await openProjectDirectory(namespace, 'read');
      const nextProjects = [next, ...projects.filter((item) => item.id !== next.id)];
      setProjects(nextProjects);
      setActiveId(next.id);
      await loadProject(next.id, nextProjects);
      setSurface('chat');
      setNotice('');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setNotice(error instanceof Error ? error.message : '无法打开项目');
    }
  };
  const selectProject = async (id: string) => {
    setActiveId(id);
    setProjectMenuOpen(false);
    await loadProject(id);
  };
  const changeMode = async (mode: ProjectPermissionMode) => {
    if (!project || (mode === 'full' && !canFull)) return;
    const effective = project.fallback && mode === 'full' ? 'workspace' : mode;
    const updated = { ...project, permissionMode: effective, updatedAt: Date.now() };
    await db.projects.put(updated);
    setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    if (mode === 'full' && effective !== 'full') setNotice('导入副本不支持完全访问，请使用支持目录授权的浏览器。');
  };
  const recordEvent = async (type: ProjectEvent['type'], content: string) => {
    const event = project ? await appendProjectEvent(project.id, type, content) : localEvent(sessionId.current, type, content);
    setEvents((items) => [...items, event]);
    return event;
  };
  const askAgent = async () => {
    if (!prompt.trim() || busy) return;
    const question = prompt.trim();
    setPrompt('');
    setBusy(true);
    setPhase('正在建立工程上下文');
    setNotice('');
    await recordEvent('user', question);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase(project ? `正在分析 ${files.length} 个文件的索引` : '正在启动独立工程对话');
      const payload = await projectAgentStep({
        projectId: project?.id ?? sessionId.current,
        prompt: question,
        permissionMode: project?.permissionMode ?? 'read',
        activeFile: activeFile ? { path: activeFile.path, content: draft.slice(0, 80_000), language: activeFile.language } : undefined,
        fileIndex: files.map(({ path, language, size }) => ({ path, language, size })).slice(0, 1_000),
      }, controller.signal);
      setPhase('正在整理结果');
      if (payload.files?.length && project && project.permissionMode !== 'read') {
        await createCheckpoint(project.id, `智能助手修改前 · ${question.slice(0, 30)}`);
        for (const proposal of payload.files.slice(0, 20)) {
          if (proposal.path.includes('..')) continue;
          const existing = files.find((item) => item.path === proposal.path) ?? {
            id: `${project.id}:${proposal.path}`, projectId: project.id, path: proposal.path,
            content: '', language: 'plaintext', size: 0, updatedAt: Date.now(),
          };
          await saveProjectFile(project, existing, proposal.content);
        }
        setFiles(await listProjectFiles(project.id));
      }
      await recordEvent('assistant', payload.summary);
      setFailedPrompt('');
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      const message = aborted ? '已停止本次工程任务。' : error instanceof Error ? error.message : '工程助手执行失败';
      await recordEvent(aborted ? 'assistant' : 'error', message);
      if (!aborted) { setFailedPrompt(question); setNotice(message); }
    } finally {
      abortRef.current = undefined;
      setBusy(false);
      setPhase('');
    }
  };

  if (!auth.authenticated || !canProject) return <section className="project-locked"><span><Shield size={24} /></span><h2>工程模式需要账号权限</h2><p>登录后可使用工程对话、项目文件、插件和受控工具。源码不会上传到账号数据。</p><a href="/api/auth/login?returnTo=%2Fproject">登录并继续</a></section>;

  return <div className="project-console">
    <header className="project-commandbar">
      <div className="project-picker">
        <button className="project-picker-trigger" onClick={() => setProjectMenuOpen((value) => !value)} aria-expanded={projectMenuOpen}>
          <span><FolderOpen size={17} /></span><div><strong>{project?.name ?? '独立工程对话'}</strong><small>{project ? `${files.length} 个文件，仅存于本机` : '无需打开目录即可开始'}</small></div><ChevronDown size={15} />
        </button>
        <AnimatePresence>{projectMenuOpen ? <motion.div className="project-picker-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .128 }}>
          <button className={!project ? 'active' : ''} onClick={() => { setActiveId(''); setFiles([]); setEvents([]); setProjectMenuOpen(false); }}><MessageSquare size={15} /><span>独立工程对话</span></button>
          {projects.map((item) => <button key={item.id} className={item.id === activeId ? 'active' : ''} onClick={() => void selectProject(item.id)}><FolderOpen size={15} /><span>{item.name}</span></button>)}
          <button className="project-picker-add" onClick={() => void openProject()}><FolderOpen size={15} /><span>打开本地目录</span></button>
        </motion.div> : null}</AnimatePresence>
      </div>
      {project ? <div className="project-mode-control" aria-label="工程权限">{(['read', 'workspace', 'full'] as const).map((mode) => <button key={mode} className={project.permissionMode === mode ? 'active' : ''} disabled={mode === 'full' && !canFull} onClick={() => void changeMode(mode)}>{MODE_LABEL[mode]}</button>)}</div> : <span className="project-readonly-badge"><Shield size={13} /> 独立只读会话</span>}
      <button className="project-open-button" onClick={() => void openProject()} aria-label="打开项目"><FolderOpen size={16} /><span>打开项目</span></button>
    </header>

    <nav className="project-surface-tabs" aria-label="工程功能区">{SURFACES.map(({ id, label, icon: Icon }) => <button key={id} className={surface === id ? 'active' : ''} onClick={() => setSurface(id)}><Icon size={16} /><span>{label}</span>{id === 'changes' && changed ? <i /> : null}</button>)}</nav>

    <AnimatePresence mode="wait">
      <motion.main key={surface} className={`project-surface project-surface-${surface}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: .128 }}>
        {surface === 'chat' ? <section className="project-chat">
          <div className="project-chat-stream">
            {!events.length ? <div className="project-chat-empty"><span><Braces size={28} /></span><h1>工程对话</h1><p>{project ? `已连接 ${project.name}。可以询问代码、定位问题或提出修改任务。` : '可以先讨论架构、代码与调试方案，需要读取或修改文件时再连接项目。'}</p><div><button onClick={() => setPrompt('检查当前项目的结构并指出最优先处理的问题')}>检查项目结构</button><button onClick={() => setPrompt('为这个工程任务制定可执行的实现步骤')}>制定实现步骤</button></div></div> : null}
            {events.map((event) => <article key={event.id} className={`project-chat-message event-${event.type}`}><header><span>{event.type === 'user' ? '你' : event.type === 'assistant' ? '智能助手' : event.type === 'error' ? '请求失败' : '工程事件'}</span><time>{new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></header><p>{event.content}</p>{event.type === 'error' && failedPrompt ? <button className="project-retry-button" onClick={() => { setPrompt(failedPrompt); setFailedPrompt(''); }}><RotateCcw size={13} /> 放回输入框重试</button> : null}</article>)}
            {busy ? <div className="project-agent-progress"><LoaderCircle className="spin" size={17} /><div><strong>智能助手正在处理</strong><small>{phase}</small></div><button onClick={() => abortRef.current?.abort()}><Square size={13} /> 停止</button></div> : null}
            <div ref={chatEndRef} />
          </div>
          <div className="project-chat-composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={project ? '描述需要分析、修改或验证的工程任务' : '输入工程问题，或先打开项目以提供文件上下文'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAgent(); } }} /><footer><span>{project ? `${MODE_LABEL[project.permissionMode]} · ${activePath || '未选择文件'}` : '独立工程对话 · 不读取本机文件'}</span><button onClick={() => void askAgent()} disabled={busy || !prompt.trim()} aria-label="发送工程任务"><Send size={17} /></button></footer></div>
        </section> : null}

        {surface === 'editor' ? <section className="project-editor-shell">
          <aside className="project-file-panel"><header><strong>文件</strong><button onClick={() => void openProject()} title="打开目录"><FolderOpen size={16} /></button></header><div>{files.map((file) => <button key={file.id} className={activePath === file.path ? 'active' : ''} onClick={() => setActivePath(file.path)}><FileCode2 size={14} /><span>{file.path}</span><small>{Math.max(1, Math.round(file.size / 1024))}K</small></button>)}{!files.length ? <p>打开项目后在此浏览文件。</p> : null}</div></aside>
          <div className="project-code-editor"><header><div><Code2 size={15} /><span>{activePath || '未选择文件'}</span>{changed ? <i>修改中</i> : null}</div><button disabled={!changed || project?.permissionMode === 'read'} onClick={() => void persistDraft()}><Save size={15} /> 保存</button></header>{activeFile ? <Editor height="100%" language={activeFile.language} value={draft} onChange={(value) => setDraft(value ?? '')} theme={document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'light'} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', smoothScrolling: true, readOnly: project?.permissionMode === 'read', padding: { top: 14 }, automaticLayout: true }} /> : <div className="editor-empty"><Braces size={35} /><h2>连接一个项目目录</h2><p>文件树与编辑器仅在需要时出现，不再挤占工程对话空间。</p><button onClick={() => void openProject()}><FolderOpen size={16} /> 打开目录</button></div>}</div>
        </section> : null}

        {surface === 'changes' ? <section className="project-changes-view"><header><div><GitBranch size={18} /><div><h2>更改与检查点</h2><p>审查当前文件差异并恢复本地检查点</p></div></div><button disabled={!project} onClick={async () => { if (!project) return; const matrix = await syncBrowserGit(project.id, files); setGitStatus(matrix.filter(([, head, workdir, stage]) => head !== workdir || workdir !== stage).map(([path]) => path)); }}><GitBranch size={14} /> 刷新状态</button></header><div className="project-diff">{changes.length ? changes.map((part, index) => <pre key={index} className={part.added ? 'added' : part.removed ? 'removed' : ''}>{part.value}</pre>) : <div className="project-panel-empty"><GitBranch size={25} /><p>当前文件没有未保存更改。</p></div>}</div>{gitStatus.length ? <div className="browser-git-status">{gitStatus.map((path) => <span key={path}>{path}</span>)}</div> : null}<div className="project-checkpoints"><h3><History size={15} /> 本地检查点</h3>{checkpoints.map((checkpoint) => <button key={checkpoint.id} onClick={async () => { if (!project) return; await restoreCheckpoint(project, checkpoint); await loadProject(project.id); }}><BookMarked size={15} /><span>{checkpoint.label}</span><small>{new Date(checkpoint.createdAt).toLocaleString('zh-CN')}</small><RotateCcw size={14} /></button>)}</div></section> : null}

        {surface === 'plugins' ? <section className="project-market-surface"><PluginMarketplace projectId={project?.id} /></section> : null}

        {surface === 'bridge' ? <section className="project-bridge-view"><header><span><SquareTerminal size={22} /></span><div><h2>连接本地桥</h2><p>在任意项目目录启动独立脚本，无需修改项目的 package.json。</p></div>{bridgeInfo ? <i><Check size={13} /> 已连接</i> : null}</header><div className="bridge-setup-grid">
          <article><b>1</b><div><h3>下载桥接脚本</h3><p>脚本仅使用 Node.js 内置模块，保存到下载目录后即可运行。</p><a href="/stingy-bridge.mjs" download><Download size={15} /> 下载 stingy-bridge.mjs</a></div></article>
          <article><b>2</b><div><h3>在项目目录启动</h3><p>先进入需要授权的项目目录，再执行下方 PowerShell 命令。</p><code>{BRIDGE_COMMAND}</code><button onClick={async () => { await navigator.clipboard.writeText(BRIDGE_COMMAND); setCopied(true); setTimeout(() => setCopied(false), 1_500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制命令'}</button></div></article>
          <article><b>3</b><div><h3>输入地址与配对码</h3><p>使用终端显示的六位配对码。连接仅允许环回地址。</p><label><span>桥接地址</span><input value={bridgeUrl} onChange={(event) => { setBridgeUrl(event.target.value); localStorage.setItem('stingy:bridge-url', event.target.value); }} spellCheck={false} /></label><div className="bridge-pair"><input inputMode="numeric" maxLength={6} value={bridgeCode} onChange={(event) => setBridgeCode(event.target.value.replace(/\D/gu, ''))} placeholder="六位配对码" /><button disabled={bridgeCode.length !== 6} onClick={async () => { try { setBridgeInfo(await pairBridge(bridgeCode, bridgeUrl)); setBridgeCode(''); } catch (error) { setNotice(error instanceof Error ? error.message : '本地桥配对失败'); } }}><SquareTerminal size={15} /> 配对</button></div></div></article>
        </div>{bridgeInfo ? <div className="bridge-connected"><strong>Stingy Bridge {bridgeInfo.version}</strong><span>授权根目录：{bridgeInfo.root}</span><span>能力：{bridgeInfo.capabilities.join('、')}</span></div> : null}</section> : null}
      </motion.main>
    </AnimatePresence>
    {notice ? <div className="project-toast"><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div> : null}
  </div>;
}
