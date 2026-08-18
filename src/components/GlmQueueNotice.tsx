import { Clock3, KeyRound, LoaderCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { GlmQueueStatus } from '../types';
import { useAppStore } from '../store';
import { IconButton } from './ui';

type QueueEvent = GlmQueueStatus | { state: 'unavailable'; requestId: string; operation?: string; message: string };
const QUIET_OPERATIONS = new Set(['生成对话标题', '模型路由', '语义增强', '语义缓存验证']);

function rememberRequest(target: Set<string>, requestId: string) {
  if (target.size >= 100) target.delete(target.values().next().value!);
  target.add(requestId);
}

export function GlmQueueNotice() {
  const [status, setStatus] = useState<QueueEvent>();
  const [now, setNow] = useState(Date.now());
  const terminalIds = useRef(new Set<string>());
  const dismissedIds = useRef(new Set<string>());
  const hideTimer = useRef<number | undefined>(undefined);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<QueueEvent>).detail;
      if (!detail?.requestId) return;
      if (detail.state === 'completed' || detail.state === 'personal' || detail.state === 'failed') {
        rememberRequest(terminalIds.current, detail.requestId);
        setStatus((current) => current?.requestId === detail.requestId ? undefined : current);
        return;
      }
      if (terminalIds.current.has(detail.requestId) || dismissedIds.current.has(detail.requestId)) return;
      if ('operation' in detail && detail.operation && QUIET_OPERATIONS.has(detail.operation)) return;
      if (detail.state !== 'unavailable' && Date.now() - detail.queuedAt < 2_000 && detail.estimatedWaitMs < 5_000) return;
      window.clearTimeout(hideTimer.current);
      setStatus(detail);
      if (detail.state === 'unavailable') {
        rememberRequest(terminalIds.current, detail.requestId);
        hideTimer.current = window.setTimeout(() => setStatus((current) => current?.requestId === detail.requestId ? undefined : current), 8_000);
      }
    };
    window.addEventListener('stingy:glm-status', listener);
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener('stingy:glm-status', listener);
    };
  }, []);

  useEffect(() => {
    if (!status || !('queuedAt' in status) || status.state === 'completed' || status.state === 'personal') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const waited = status && 'queuedAt' in status ? now - status.queuedAt : 0;
  const needsKey = status?.state === 'unavailable' || (status && 'poolExhausted' in status && status.poolExhausted) || waited >= 60_000;
  const visible = status && (status.state === 'waiting' || status.state === 'running' || status.state === 'unavailable');
  const dismiss = () => {
    if (status) rememberRequest(dismissedIds.current, status.requestId);
    window.clearTimeout(hideTimer.current);
    setStatus(undefined);
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          className={`glm-queue-notice ${needsKey ? 'needs-key' : ''}`}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          role="status"
        >
          <div className="glm-queue-icon">{needsKey ? <KeyRound size={17} /> : <LoaderCircle size={17} className="spin" />}</div>
          <div>
            <b>{needsKey ? '智能助手服务当前繁忙' : ('operation' in status ? status.operation : '智能助手正在处理')}</b>
            <small>
              {status.state === 'unavailable'
                ? status.message
                : `当前队列位置：${status.position || '正在处理'} · 预计等待 ${Math.max(1, Math.ceil(status.estimatedWaitMs / 1_000))} 秒`}
            </small>
          </div>
          {needsKey ? (
            <button type="button" className="queue-key-button" onClick={() => setSettingsOpen(true)}>
              <Clock3 size={14} /> 配置私人智能助手
            </button>
          ) : null}
          <IconButton label="关闭队列提示" onClick={dismiss}><X size={15} /></IconButton>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
