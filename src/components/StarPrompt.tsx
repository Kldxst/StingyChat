import { Github, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GITHUB_REPOSITORY_URL } from '../config';
import type { Conversation } from '../types';
import { Modal } from './ui';

const STAR_PROMPT_STORAGE_KEY = 'stingy-star-prompt-shown-v1';
const REQUIRED_TURNS = 5;
const AUTO_CLOSE_MS = 10_000;

export function countCompletedTurns(conversations: Conversation[]): number {
  return conversations.reduce(
    (total, conversation) => total + conversation.messages.filter(
      (message) => message.role === 'assistant' && message.content.trim().length > 0,
    ).length,
    0,
  );
}

export function StarPrompt({ initialized, conversations }: { initialized: boolean; conversations: Conversation[] }) {
  const completedTurns = countCompletedTurns(conversations);
  const promptedThisMount = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!initialized || completedTurns < REQUIRED_TURNS || promptedThisMount.current) return;
    if (localStorage.getItem(STAR_PROMPT_STORAGE_KEY)) return;

    promptedThisMount.current = true;
    localStorage.setItem(STAR_PROMPT_STORAGE_KEY, new Date().toISOString());
    setOpen(true);
  }, [completedTurns, initialized]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Modal open={open} title="感谢你使用 StingyChat" onClose={() => setOpen(false)}>
      <div className="modal-content star-prompt-content">
        <div className="star-prompt-mark" aria-hidden="true"><Star size={25} /></div>
        <p>你已经完成了 5 轮对话，感谢你的使用与支持。</p>
        <p>如果 StingyChat 帮你节省了 Token，欢迎在 GitHub 给项目一个 Star。你的支持会帮助更多人发现这个项目。</p>
        <div className="star-prompt-timer" aria-label="此窗口将在 10 秒后自动关闭"><span /></div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setOpen(false)}>稍后再说</button>
          <a className="primary-button star-prompt-action" href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Github size={17} /> 前往 GitHub
          </a>
        </div>
      </div>
    </Modal>
  );
}
