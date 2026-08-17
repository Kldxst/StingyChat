import type { WorkerEnv } from './glm';

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
