const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:47321';

interface BridgeSession { url: string; token: string; rootName: string; expiresAt: number }
export interface BridgeCapabilities { version: string; root: string; capabilities: string[] }

let session: BridgeSession | undefined;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!session || session.expiresAt <= Date.now()) throw new Error('本地桥尚未配对或会话已过期');
  const response = await fetch(`${session.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => undefined) as (T & { error?: string }) | undefined;
  if (!response.ok || !payload) throw new Error(payload?.error ?? `本地桥请求失败 (${response.status})`);
  return payload;
}

export async function pairBridge(code: string, url = DEFAULT_BRIDGE_URL): Promise<BridgeCapabilities> {
  const normalized = url.replace(/\/+$/u, '');
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/u.test(normalized)) throw new Error('本地桥地址必须使用环回主机');
  const response = await fetch(`${normalized}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const payload = await response.json().catch(() => undefined) as { token?: string; rootName?: string; expiresInMs?: number; error?: string } | undefined;
  if (!response.ok || !payload?.token) throw new Error(payload?.error ?? '本地桥配对失败');
  session = { url: normalized, token: payload.token, rootName: payload.rootName ?? 'workspace', expiresAt: Date.now() + Number(payload.expiresInMs ?? 0) };
  return request<BridgeCapabilities>('/v1/capabilities', { method: 'GET' });
}
