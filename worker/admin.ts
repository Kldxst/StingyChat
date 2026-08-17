import type { WorkerEnv } from './glm';

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export async function createAdminToken(secret: string): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ exp: Date.now() + 2 * 60 * 60 * 1000 })));
  return `${payload}.${await hmac(secret, payload)}`;
}

function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export async function verifyAdminPassword(candidate: string, secret?: string): Promise<boolean> {
  if (!secret) return false;
  return timingSafeEqual(await hmac(secret, candidate), await hmac(secret, secret));
}

export async function verifyAdminToken(token: string | undefined, secret?: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !timingSafeEqual(signature, await hmac(secret, payload))) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/gu, '+').replace(/_/gu, '/')), (char) => char.charCodeAt(0)))) as { exp?: number };
    return typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function ipv4Number(value: string): number | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((numbers[0] * 256 + numbers[1]) * 256 + numbers[2]) * 256 + numbers[3]) >>> 0;
}

export function matchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip.toLowerCase() === cidr.toLowerCase();
  const [networkText, bitsText] = cidr.split('/');
  const ipValue = ipv4Number(ip);
  const network = ipv4Number(networkText);
  const bits = Number(bitsText);
  if (ipValue === undefined || network === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipValue & mask) === (network & mask);
}

interface IpRestriction {
  id: number;
  cidr: string;
  block_chat: number;
  block_assist: number;
  block_web_search: number;
  reason: string | null;
  created_at: string;
}

export function requestIp(context: { req: { header(name: string): string | undefined } }): string {
  return context.req.header('cf-connecting-ip') ?? 'unknown';
}

export async function getRestriction(env: WorkerEnv, ip: string): Promise<IpRestriction | undefined> {
  if (!env.ADMIN_DB || ip === 'unknown') return undefined;
  const rows = await env.ADMIN_DB.prepare('SELECT * FROM ip_restrictions ORDER BY id DESC').all<IpRestriction>();
  return rows.results.find((item) => matchesCidr(ip, item.cidr));
}

export function extractAssistantText(sse: string): string {
  let text = '';
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const event = JSON.parse(line.slice(5).trim()) as { type?: string; text?: string };
      if (event.type === 'delta') text += event.text ?? '';
    } catch {
      // Ignore partial or terminal SSE frames.
    }
  }
  return text;
}
