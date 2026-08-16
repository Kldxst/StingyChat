import { Github, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GITHUB_REPOSITORY_URL } from '../config';
import type { Conversation } from '../types';
import { Modal } from './ui';

const STAR_PROMPT_STORAGE_KEY = 'stingy-star-prompt-shown-v1';
const STAR_PROMPT_PROGRESS_KEY = 'stingy-star-prompt-progress-v1';
const REQUIRED_TURNS = 5;
const AUTO_CLOSE_MS = 10_000;

function completedTurnIds(conversations: Conversation[]): string[] {
  return conversations.flatMap((conversation) => conversation.messages
    .filter((message) => message.role === 'assistant' && message.content.trim().length > 0)
    .map((message) => message.id));
}

export function countCompletedTurns(conversations: Conversation[]): number {
  return completedTurnIds(conversations).length;
}

function readProgress(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STAR_PROMPT_PROGRESS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function hasShownPrompt(): boolean {
  try { return Boolean(localStorage.getItem(STAR_PROMPT_STORAGE_KEY)); }
  catch { return false; }
}

function persistPromptState(ids: string[], shown: boolean): void {
  try {
    localStorage.setItem(STAR_PROMPT_PROGRESS_KEY, JSON.stringify(ids.slice(0, REQUIRED_TURNS)));
    if (shown) localStorage.setItem(STAR_PROMPT_STORAGE_KEY, new Date().toISOString());
  } catch {
    // Storage may be disabled; the in-memory guard still prevents repeats this session.
  }
}

export function StarPrompt({ initialized, conversations }: { initialized: boolean; conversations: Conversation[] }) {
  const promptedThisMount = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!initialized || promptedThisMount.current || hasShownPrompt()) return;

    const accumulatedIds = new Set(readProgress());
    for (const id of completedTurnIds(conversations)) {
      accumulatedIds.add(id);
      if (accumulatedIds.size >= REQUIRED_TURNS) break;
    }
    const reachedThreshold = accumulatedIds.size >= REQUIRED_TURNS;
    persistPromptState([...accumulatedIds], reachedThreshold);
    if (!reachedThreshold) return;

    promptedThisMount.current = true;
    setOpen(true);
  }, [conversations, initialized]);

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
