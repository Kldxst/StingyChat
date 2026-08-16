import { Clock3, KeyRound, LoaderCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { GlmQueueStatus } from '../types';
import { useAppStore } from '../store';
import { IconButton } from './ui';

type QueueEvent = GlmQueueStatus | { state: 'unavailable'; requestId: string; message: string };

export function GlmQueueNotice() {
  const [status, setStatus] = useState<QueueEvent>();
  const [now, setNow] = useState(Date.now());
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<QueueEvent>).detail;
      setStatus(detail);
      if (detail.state === 'completed') window.setTimeout(() => setStatus((current) => current === detail ? undefined : current), 700);
    };
    window.addEventListener('stingy:glm-status', listener);
    return () => window.removeEventListener('stingy:glm-status', listener);
  }, []);

  useEffect(() => {
    if (!status || !('queuedAt' in status) || status.state === 'completed' || status.state === 'personal') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const waited = status && 'queuedAt' in status ? now - status.queuedAt : 0;
  const needsKey = status?.state === 'unavailable' || (status && 'poolExhausted' in status && status.poolExhausted) || waited >= 60_000;
  const visible = status && status.state !== 'completed' && status.state !== 'personal';

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
            <b>{needsKey ? '内置 GLM 当前繁忙' : ('operation' in status ? status.operation : '智能辅助')}</b>
            <small>
              {status.state === 'unavailable'
                ? status.message
                : `队列 ${status.position || '处理中'} · 预计 ${Math.max(1, Math.ceil(status.estimatedWaitMs / 1_000))} 秒`}
            </small>
          </div>
          {needsKey ? (
            <button type="button" className="queue-key-button" onClick={() => setSettingsOpen(true)}>
              <Clock3 size={14} /> 配置个人 Key
            </button>
          ) : null}
          <IconButton label="关闭队列提示" onClick={() => setStatus(undefined)}><X size={15} /></IconButton>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
