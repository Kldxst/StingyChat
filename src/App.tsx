import { Files, Menu, Settings2, Zap } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ModelPicker } from './components/ModelPicker';
import { IconButton } from './components/ui';
import { GlmQueueNotice } from './components/GlmQueueNotice';
import { StarPrompt } from './components/StarPrompt';
import { ArtifactPanel } from './components/ArtifactPanel';
import { useAppStore } from './store';
import { OnboardingWizard } from './components/OnboardingWizard';

const ChatView = lazy(() => import('./components/ChatView').then((module) => ({ default: module.ChatView })));
const KnowledgeView = lazy(() => import('./components/KnowledgeView').then((module) => ({ default: module.KnowledgeView })));
const BatchView = lazy(() => import('./components/BatchView').then((module) => ({ default: module.BatchView })));
const SettingsDrawer = lazy(() => import('./components/SettingsDrawer').then((module) => ({ default: module.SettingsDrawer })));
const AdminView = lazy(() => import('./components/AdminView').then((module) => ({ default: module.AdminView })));

export default function App() {
  const mainColumnRef = useRef<HTMLElement>(null);
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useAppStore((state) => state.initialized);
  const view = useAppStore((state) => state.view);
  const profiles = useAppStore((state) => state.profiles);
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const settings = useAppStore((state) => state.settings);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const artifactPanelOpen = useAppStore((state) => state.artifactPanelOpen);
  const auth = useAppStore((state) => state.auth);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setArtifactPanelOpen = useAppStore((state) => state.setArtifactPanelOpen);
  const conversation = conversations.find((item) => item.id === activeId);
  const profile = profiles.find((item) => item.id === conversation?.providerProfileId) ?? profiles[0];

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const preference = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
      const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);
  useLayoutEffect(() => {
    const workspace = mainColumnRef.current?.querySelector<HTMLElement>(':scope > .workspace-view');
    if (workspace) workspace.scrollTop = 0;
  }, [view]);

  if (!initialized || !conversation || !profile) {
    return <div className="boot-screen"><div className="brand-mark"><Zap size={20} /></div><span>StingyChat</span></div>;
  }
  if (auth.authenticated && auth.user?.onboardingStatus === 'required') return <OnboardingWizard />;

  const pageTitle = view === 'chat' ? conversation.title : view === 'knowledge' ? '资料库' : view === 'batch' ? '批处理工作台' : '管理员后台';

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${artifactPanelOpen ? 'artifact-is-open' : ''}`}>
      <Sidebar />
      <section className="main-column" ref={mainColumnRef}>
        <header className="topbar">
          <div className="topbar-title">
            <IconButton label="打开导航" className="mobile-only" onClick={() => setSidebarOpen(true)}><Menu size={19} /></IconButton>
            <strong>{pageTitle}</strong>
          </div>
          {view === 'chat' ? (
            <ModelPicker conversationId={conversation.id} profile={profile} />
          ) : <strong className="workspace-title">{pageTitle}</strong>}
          <div className="topbar-actions">
            {settings.extremeMode ? <span className="extreme-badge"><Zap size={13} /> 极省</span> : null}
            <IconButton label="打开生成文件" onClick={() => setArtifactPanelOpen(true)}><Files size={18} /></IconButton>
            <IconButton label="打开设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></IconButton>
          </div>
        </header>
        <Suspense fallback={<div className="view-loading">正在加载工作区…</div>}>
          {view === 'chat' ? <ChatView /> : view === 'knowledge' ? <KnowledgeView /> : view === 'batch' ? <BatchView /> : <AdminView />}
        </Suspense>
      </section>
      <ArtifactPanel />
      {settingsOpen ? <Suspense fallback={null}><SettingsDrawer /></Suspense> : null}
      <GlmQueueNotice />
      <StarPrompt initialized={initialized} conversations={conversations} />
    </div>
  );
}
