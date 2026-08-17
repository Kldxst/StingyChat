import { Activity, Ban, Database, FileClock, Gauge, RefreshCw, Search, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import type { FeaturePermission, UserRole } from '../types';
import { formatAdminTime, parseSqliteUtc } from '../lib/time';
import { useAppStore } from '../store';
import { Modal } from './ui';

type Tab = 'overview' | 'users' | 'restrictions' | 'chats' | 'audit';
interface Overview { users: number; conversations: number; requests24h: number; suspended: number }
interface AdminUser { id: string; username: string; display_name: string; role: UserRole; status: 'active' | 'suspended'; storage_quota_bytes: number; storage_usage_bytes: number; created_at: string }
interface ChatLog { id: number; ip: string; model: string; request_json: string; response_text: string; created_at: string }
interface Restriction { id: number; cidr: string; reason: string; }
interface AuditEvent { id: number; actor_user_id?: string; target_user_id?: string; action: string; details_json: string; ip?: string; created_at_ms: number }

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`); return payload;
}
const FEATURES: Array<[FeaturePermission, string]> = [['skills','Skills'],['smart_assist','智能辅助'],['reasoning','思考'],['web_search','联网'],['model_routing','模型路由'],['batch','批处理'],['history_sync','历史同步']];
const TABS: Array<[Tab, string, typeof Gauge]> = [['overview','仪表盘',Gauge],['users','用户',Users],['restrictions','网络限制',Ban],['chats','聊天审计',Database],['audit','操作日志',FileClock]];
function bytes(value: number) { return `${(value / 1024 / 1024).toFixed(value > 10 * 1024 * 1024 ? 0 : 1)} MB`; }

export function AdminView() {
  const currentUser = useAppStore((state) => state.auth.user);
  const [tab, setTab] = useState<Tab>('overview'); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview>(); const [users, setUsers] = useState<AdminUser[]>([]); const [total, setTotal] = useState(0); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]); const [chats, setChats] = useState<ChatLog[]>([]); const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [cidr, setCidr] = useState(''); const [reason, setReason] = useState(''); const [deleteTarget, setDeleteTarget] = useState<AdminUser>(); const [confirmation, setConfirmation] = useState('');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'overview') setOverview(await adminRequest('/api/admin/overview'));
      else if (tab === 'users') { const result = await adminRequest<{ items: AdminUser[]; total: number }>(`/api/admin/users?page=${page}&q=${encodeURIComponent(query)}`); setUsers(result.items); setTotal(result.total); }
      else if (tab === 'restrictions') setRestrictions((await adminRequest<{ items: Restriction[] }>('/api/admin/restrictions')).items);
      else if (tab === 'chats') setChats((await adminRequest<{ items: ChatLog[] }>('/api/admin/chats')).items);
      else setAudit((await adminRequest<{ items: AuditEvent[] }>('/api/admin/audit')).items);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '管理数据加载失败'); } finally { setLoading(false); }
  }, [page, query, tab]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mutateUser = async (user: AdminUser, path: string, body?: object, method = 'PATCH') => { try { await adminRequest(`/api/admin/users/${encodeURIComponent(user.id)}${path}`, { method, body: JSON.stringify(body ?? {}) }); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败'); } };

  return <main className="workspace-view admin-view">
    <header className="admin-heading"><div><ShieldCheck size={20}/><span><h1>管理控制台</h1><small>基于 CP OAuth 的权限与服务治理 · {timeZone}</small></span></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/>刷新</button></header>
    <nav className="admin-tabs" aria-label="管理模块">{TABS.filter(([value]) => value !== 'chats' || currentUser?.permissions.includes('admin_chat_read')).map(([value,label,Icon]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setPage(1); }}><Icon size={15}/><span>{label}</span></button>)}</nav>
    {error ? <div className="inline-error">{error}</div> : null}
    <AnimatePresence mode="wait"><motion.div key={tab} className="admin-content" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.144}}>
      {tab === 'overview' ? <div className="admin-metrics">{([['用户总数',overview?.users ?? 0,Users],['云端对话',overview?.conversations ?? 0,Database],['24 小时请求',overview?.requests24h ?? 0,Activity],['已停用账号',overview?.suspended ?? 0,Ban]] as const).map(([label,value,Icon]) => <article key={label}><Icon size={17}/><small>{label}</small><strong>{value.toLocaleString()}</strong></article>)}</div> : null}
      {tab === 'users' ? <section className="admin-band"><div className="admin-toolbar"><label><Search size={15}/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索用户名、显示名或用户 ID"/></label><span>{total} 位用户</span></div><div className="admin-user-list">{users.map((user) => <article key={user.id}>
        <div className="admin-user-main"><span className="admin-user-avatar">{user.display_name.slice(0,1)}</span><div><strong>{user.display_name}</strong><small>{user.username} · {user.id}</small></div><em className={`role-badge role-${user.role}`}>{user.role}</em><em className={`status-badge is-${user.status}`}>{user.status === 'active' ? '正常' : '已停用'}</em></div>
        <div className="admin-user-detail"><span>云空间 <b>{bytes(user.storage_usage_bytes)}</b> / {bytes(user.storage_quota_bytes)}</span><span>加入于 {formatAdminTime(user.created_at,timeZone)}</span></div>
        <div className="admin-user-actions"><div className="role-control">{(['member','support','admin'] as UserRole[]).map((role) => <button key={role} className={user.role === role ? 'active' : ''} disabled={user.role === 'owner' || (currentUser?.role !== 'owner' && role === 'admin')} onClick={() => void mutateUser(user,'/role',{role})}>{role}</button>)}</div><button onClick={() => void mutateUser(user,'/quota',{bytes:user.storage_quota_bytes + 100*1024*1024})}>配额 +100 MB</button><button onClick={() => void mutateUser(user,'/revoke-sessions',{},'POST')}>撤销会话</button><button disabled={user.role === 'owner'} onClick={() => void mutateUser(user,'/status',{status:user.status === 'active' ? 'suspended' : 'active',reason:'管理员操作'})}>{user.status === 'active' ? '停用' : '恢复'}</button>{currentUser?.role === 'owner' && user.role !== 'owner' ? <button className="danger" onClick={() => {setDeleteTarget(user);setConfirmation('');}}><Trash2 size={13}/>永久删除</button> : null}</div>
        <div className="permission-strip"><UserCog size={14}/>{FEATURES.map(([permission,label]) => <button key={permission} onClick={() => void mutateUser(user,'/permissions',{permissions:[{permission,allowed:true}]},'PUT')}>{label}</button>)}</div>
      </article>)}</div><div className="admin-pagination"><button disabled={page<=1} onClick={() => setPage(page-1)}>上一页</button><span>第 {page} 页</span><button disabled={page*25>=total} onClick={() => setPage(page+1)}>下一页</button></div></section> : null}
      {tab === 'restrictions' ? <section className="admin-band"><h2><Ban size={16}/>IP / CIDR 限制</h2><div className="restriction-form"><input value={cidr} onChange={(event)=>setCidr(event.target.value)} placeholder="203.0.113.0/24 或单个 IP"/><input value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="限制原因"/><button className="primary-button" disabled={!cidr.trim()} onClick={async()=>{await adminRequest('/api/admin/restrictions',{method:'POST',body:JSON.stringify({cidr,reason,blockChat:true,blockAssist:true,blockWebSearch:true})});setCidr('');setReason('');await refresh();}}>添加限制</button></div><div className="restriction-list">{restrictions.map((item)=><div key={item.id}><b>{item.cidr}</b><span>{item.reason||'未填写原因'}</span><button aria-label="删除限制" onClick={async()=>{await adminRequest(`/api/admin/restrictions/${item.id}`,{method:'DELETE'});await refresh();}}><Trash2 size={14}/></button></div>)}</div></section> : null}
      {tab === 'chats' ? <section className="admin-band"><h2>聊天正文审计 <small>仅 Owner</small></h2><div className="chat-log-list">{chats.map((item)=><details key={item.id}><summary><b>{item.model}</b><span>{item.ip}</span><time dateTime={parseSqliteUtc(item.created_at).toISOString()}>{formatAdminTime(item.created_at,timeZone)}</time></summary><div><h3>请求</h3><pre>{JSON.stringify(JSON.parse(item.request_json),null,2)}</pre><h3>回复</h3><pre>{item.response_text}</pre></div></details>)}</div></section> : null}
      {tab === 'audit' ? <section className="admin-band"><h2>管理员操作日志</h2><div className="audit-list">{audit.map((item)=><article key={item.id}><strong>{item.action}</strong><span>{item.actor_user_id??'已删除账号'} → {item.target_user_id??'系统'}</span><small>{new Date(item.created_at_ms).toLocaleString('zh-CN',{timeZone})} · {item.ip??'unknown'}</small><code>{item.details_json}</code></article>)}</div></section> : null}
    </motion.div></AnimatePresence>
    <Modal open={Boolean(deleteTarget)} title="永久删除用户" onClose={()=>setDeleteTarget(undefined)}>{deleteTarget?<div className="modal-content"><p>此操作将删除该用户的偏好、会话、云端历史、权限和相关数据，无法恢复。请输入用户 ID <b>{deleteTarget.id}</b> 继续。</p><input value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} placeholder="输入完整用户 ID"/><div className="modal-actions"><button className="secondary-button" onClick={()=>setDeleteTarget(undefined)}>取消</button><button className="danger-button" disabled={confirmation!==deleteTarget.id} onClick={async()=>{await adminRequest(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`,{method:'DELETE',body:JSON.stringify({confirmation})});setDeleteTarget(undefined);await refresh();}}>永久删除</button></div></div>:null}</Modal>
  </main>;
}
