import {
  Archive,
  Bot,
  Database,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  FolderKanban,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { IconButton } from './ui';

export function Sidebar() {
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const view = useAppStore((state) => state.view);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const auth = useAppStore((state) => state.auth);
  const createConversation = useAppStore((state) => state.createConversation);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const setView = useAppStore((state) => state.setView);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const [query, setQuery] = useState('');
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => conversation.title.toLowerCase().includes(query.trim().toLowerCase())),
    [conversations, query],
  );

  return (
    <>
      <button
        className={`sidebar-scrim ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-label="关闭导航"
      />
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''} ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Bot size={19} /></div>
          <span><strong>StingyChat</strong><small>更少 Token，更长对话</small></span>
          <IconButton label="收起导航" className="mobile-only" onClick={() => setSidebarOpen(false)}>
            <PanelLeftClose size={18} />
          </IconButton>
          <IconButton label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} className="desktop-only sidebar-collapse" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
        </div>

        <button className="new-chat-button" onClick={() => void createConversation()}>
          <Plus size={17} />
          新对话
        </button>

        <label className="conversation-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
        </label>

        <nav className="workspace-nav" aria-label="工作区">
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
            <MessageSquare size={16} /> 对话
          </button>
          <button disabled={!auth.user?.permissions.includes('project_mode')} className={view === 'project' ? 'active' : ''} onClick={() => setView('project')} title={auth.authenticated ? '工程模式' : '登录后使用工程模式'}>
            <FolderKanban size={16} /> 工程模式
          </button>
          <button className={view === 'knowledge' ? 'active' : ''} onClick={() => setView('knowledge')}>
            <Database size={16} /> 资料库
          </button>
          <button disabled={auth.authenticated && !auth.user?.permissions.includes('batch')} className={view === 'batch' ? 'active' : ''} onClick={() => setView('batch')}>
            <Archive size={16} /> 批处理
          </button>
          {auth.user?.permissions.includes('admin_users_read') ? (
            <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
              <ShieldCheck size={16} /> 管理
            </button>
          ) : null}
        </nav>

        <div className="sidebar-section-label">最近对话</div>
        <div className="conversation-list">
          {visibleConversations.map((conversation, index) => (
            <motion.div
              key={conversation.id}
              className={`conversation-row ${activeId === conversation.id && view === 'chat' ? 'active' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index * 0.025, 0.18) }}
            >
              <button onClick={() => selectConversation(conversation.id)}>
                <MessageSquare className="conversation-icon" size={15} />
                <span>{conversation.title}</span>
                <small>{new Date(conversation.updatedAt).toLocaleDateString('zh-CN')}</small>
              </button>
              <IconButton
                label="删除对话"
                className="row-delete"
                onClick={() => void deleteConversation(conversation.id)}
              >
                <Trash2 size={14} />
              </IconButton>
            </motion.div>
          ))}
        </div>

      </aside>
    </>
  );
}
