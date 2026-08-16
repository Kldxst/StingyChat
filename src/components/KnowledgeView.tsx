import { Database, File, FileUp, LoaderCircle, Search, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import { importKnowledgeFile, removeKnowledgeDocument, retrieveKnowledge } from '../lib/knowledge';
import type { KnowledgeCitation, KnowledgeDocument } from '../types';
import { IconButton } from './ui';

export function KnowledgeView() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeCitation[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setDocuments(await db.documents.orderBy('createdAt').reverse().toArray());
  useEffect(() => { void refresh(); }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) await importKnowledgeFile(file);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '文件导入失败');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const search = async () => setResults(await retrieveKnowledge(query, 6));

  return (
    <main className="workspace-view">
      <header className="workspace-heading">
        <div><Database size={22} /><span><h1>本地资料库</h1><p>内容与索引只保存在当前设备</p></span></div>
        <button className="primary-button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />} 导入资料
        </button>
        <input ref={inputRef} type="file" accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf" multiple hidden onChange={(event) => void upload(event.target.files)} />
      </header>

      <div className="knowledge-search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="测试 JIT 检索…" />
        <button onClick={() => void search()} disabled={!query.trim()}>检索</button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}

      {results.length ? (
        <section className="retrieval-results">
          <div className="section-label">检索片段</div>
          {results.map((result) => (
            <article key={result.chunkId}>
              <header><span>{result.documentName}</span><b>{result.score.toFixed(2)}</b></header>
              <p>{result.excerpt}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="document-list">
        <div className="section-label">{documents.length} 个文档</div>
        {documents.length ? documents.map((document, index) => (
          <motion.article key={document.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
            <div className="document-icon"><File size={19} /></div>
            <div><h3>{document.name}</h3><p>{document.chunkCount} 个片段 · {(document.size / 1024).toFixed(1)} KB</p></div>
            <IconButton label="删除文档" onClick={() => void removeKnowledgeDocument(document.id).then(refresh)}><Trash2 size={15} /></IconButton>
          </motion.article>
        )) : (
          <div className="empty-panel"><FileUp size={22} /><p>尚未导入资料</p></div>
        )}
      </section>
    </main>
  );
}
