import { Ban, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';

interface ChatLog {
  id: number;
  conversation_id: string;
  ip: string;
  provider: string;
  model: string;
  request_json: string;
  response_text: string;
  created_at: string;
}

interface Restriction {
  id: number;
  cidr: string;
  block_chat: number;
  block_assist: number;
  block_web_search: number;
  reason: string;
  created_at: string;
}

async function adminRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload;
}

export function AdminView() {
  const token = useAppStore((state) => state.adminToken);
  const setAdminToken = useAppStore((state) => state.setAdminToken);
  const [chats, setChats] = useState<ChatLog[]>([]);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [cidr, setCidr] = useState('');
  const [reason, setReason] = useState('');
  const [blockChat, setBlockChat] = useState(true);
  const [blockAssist, setBlockAssist] = useState(false);
  const [blockWebSearch, setBlockWebSearch] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [chatResult, restrictionResult] = await Promise.all([
        adminRequest<{ items: ChatLog[] }>('/api/admin/chats', token),
        adminRequest<{ items: Restriction[] }>('/api/admin/restrictions', token),
      ]);
      setChats(chatResult.items);
      setRestrictions(restrictionResult.items);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '管理数据加载失败');
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  if (!token) return null;

  return (
    <main className="workspace-view admin-view">
      <header className="admin-heading">
        <div><ShieldCheck size={19} /><span><h1>管理控制台</h1><small>聊天审计与网络段限制</small></span></div>
        <div>
          <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={14} /> 刷新</button>
          <button className="secondary-button" onClick={() => setAdminToken(undefined)}><LogOut size={14} /> 退出</button>
        </div>
      </header>
      {error ? <div className="inline-error">{error}</div> : null}
      <section className="admin-band">
        <h2><Ban size={16} /> IP / CIDR 限制</h2>
        <div className="restriction-form">
          <input value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="203.0.113.0/24 或单个 IP" />
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="原因" />
          <label><input type="checkbox" checked={blockChat} onChange={(event) => setBlockChat(event.target.checked)} />聊天</label>
          <label><input type="checkbox" checked={blockAssist} onChange={(event) => setBlockAssist(event.target.checked)} />辅助</label>
          <label><input type="checkbox" checked={blockWebSearch} onChange={(event) => setBlockWebSearch(event.target.checked)} />联网</label>
          <button className="primary-button" disabled={!cidr.trim()} onClick={async () => {
            await adminRequest('/api/admin/restrictions', token, { method: 'POST', body: JSON.stringify({ cidr, reason, blockChat, blockAssist, blockWebSearch }) });
            setCidr(''); setReason(''); await refresh();
          }}>保存限制</button>
        </div>
        <div className="restriction-list">
          {restrictions.map((item) => (
            <div key={item.id}><b>{item.cidr}</b><span>{[item.block_chat && '聊天', item.block_assist && '辅助', item.block_web_search && '联网'].filter(Boolean).join('、')} · {item.reason || '无备注'}</span><button aria-label="删除限制" onClick={async () => { await adminRequest(`/api/admin/restrictions/${item.id}`, token, { method: 'DELETE' }); await refresh(); }}><Trash2 size={14} /></button></div>
          ))}
        </div>
      </section>
      <section className="admin-band">
        <h2>聊天记录 <small>{chats.length}</small></h2>
        <div className="chat-log-list">
          {chats.map((item) => (
            <details key={item.id}>
              <summary><b>{item.model}</b><span>{item.ip}</span><time>{new Date(item.created_at).toLocaleString('zh-CN')}</time></summary>
              <div><h3>请求</h3><pre>{JSON.stringify(JSON.parse(item.request_json), null, 2)}</pre><h3>回复</h3><pre>{item.response_text}</pre></div>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
