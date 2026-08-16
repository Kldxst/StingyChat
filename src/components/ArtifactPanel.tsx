import { Check, Copy, Download, FileCode2, Files, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadArtifact } from '../lib/artifacts';
import { useAppStore } from '../store';
import { IconButton } from './ui';

export function ArtifactPanel() {
  const conversations = useAppStore((state) => state.conversations);
  const open = useAppStore((state) => state.artifactPanelOpen);
  const activeArtifactId = useAppStore((state) => state.activeArtifactId);
  const setOpen = useAppStore((state) => state.setArtifactPanelOpen);
  const setActive = useAppStore((state) => state.setActiveArtifact);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const artifacts = useMemo(
    () => conversations.flatMap((conversation) => conversation.messages.flatMap((message) => message.artifacts ?? [])),
    [conversations],
  );
  const active = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts.at(-1);

  useEffect(() => {
    if (open && active && active.id !== activeArtifactId) setActive(active.id);
  }, [active, activeArtifactId, open, setActive]);

  return (
    <>
      <button className={`artifact-scrim ${open ? 'is-open' : ''}`} aria-label="关闭文件栏" onClick={() => setOpen(false)} />
      <aside className={`artifact-panel ${open ? 'is-open' : ''}`} aria-label="生成文件">
        <header>
          <span><Files size={18} /><strong>生成文件</strong><small>{artifacts.length} 个</small></span>
          <IconButton label="关闭文件栏" onClick={() => setOpen(false)}><X size={18} /></IconButton>
        </header>
        {artifacts.length ? (
          <>
            <nav className="artifact-list" aria-label="文件列表">
              {artifacts.map((artifact) => (
                <button type="button" className={artifact.id === active?.id ? 'active' : ''} key={artifact.id} onClick={() => setActive(artifact.id)}>
                  <FileCode2 size={15} /><span><b>{artifact.name}</b><small>{artifact.language || artifact.mimeType}</small></span>
                </button>
              ))}
            </nav>
            {active ? (
              <section className="artifact-preview">
                <div className="artifact-toolbar">
                  <span title={active.name}>{active.name}</span>
                  <IconButton label="复制文件内容" onClick={() => {
                    void navigator.clipboard.writeText(active.content);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1_200);
                  }}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconButton>
                  <IconButton label="下载文件" disabled={downloading} onClick={async () => {
                    setDownloading(true);
                    try { await downloadArtifact(active); } finally { setDownloading(false); }
                  }}><Download size={15} /></IconButton>
                </div>
                <pre><code>{active.content}</code></pre>
              </section>
            ) : null}
          </>
        ) : (
          <div className="artifact-empty"><FileCode2 size={26} /><strong>还没有生成文件</strong><p>在输入框选择“文件生成” Skill，模型返回的具名文件会出现在这里。</p></div>
        )}
      </aside>
    </>
  );
}
