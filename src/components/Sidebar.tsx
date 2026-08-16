import {
  Archive,
  Bot,
  Database,
  Github,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { GITHUB_REPOSITORY_URL } from '../config';
import { useAppStore } from '../store';
import { IconButton } from './ui';

export function Sidebar() {
  const reduceMotion = useReducedMotion();
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const view = useAppStore((state) => state.view);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const adminToken = useAppStore((state) => state.adminToken);
  const createConversation = useAppStore((state) => state.createConversation);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const setView = useAppStore((state) => state.setView);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
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
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Bot size={19} /></div>
          <span><strong>StingyChat</strong><small>更少 Token，更长对话</small></span>
          <IconButton label="收起导航" className="mobile-only" onClick={() => setSidebarOpen(false)}>
            <PanelLeftClose size={18} />
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
          <button className={view === 'knowledge' ? 'active' : ''} onClick={() => setView('knowledge')}>
            <Database size={16} /> 资料库
          </button>
          <button className={view === 'batch' ? 'active' : ''} onClick={() => setView('batch')}>
            <Archive size={16} /> 批处理
          </button>
          {adminToken ? (
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

        <a
          className="sidebar-github"
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() => setSidebarOpen(false)}
          aria-label="在 GitHub 查看 StingyChat 开源仓库"
        >
          <motion.span
            className="github-link-icon"
            animate={reduceMotion ? undefined : { opacity: [1, 0.58, 1], scale: [1, 0.94, 1] }}
            transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Github size={19} />
          </motion.span>
          <span><strong>GitHub 开源仓库</strong><small>查看源码与参与贡献</small></span>
        </a>

        <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
          <span className="settings-avatar">S</span>
          <span><strong>设置与偏好</strong><small>模型、优化与密钥</small></span>
          <Settings2 size={17} />
        </button>
      </aside>
    </>
  );
}
