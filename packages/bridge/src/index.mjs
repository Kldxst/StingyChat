#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { realpath, readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const valueAfter = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const port = Math.max(1_024, Math.min(65_535, Number(valueAfter('--port', '47321')) || 47_321));
const requestedRoot = resolve(valueAfter('--root', process.cwd()));
const workspaceRoot = await realpath(requestedRoot);
const allowedOrigins = new Set(['https://chat.kldxst.me', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const pairingCode = String(randomInt(100_000, 999_999));
const sessions = new Map();
const MAX_BODY = 512 * 1024;
const MAX_OUTPUT = 256 * 1024;

function headers(origin) {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : '', 'Access-Control-Allow-Headers': 'content-type, authorization, x-stingy-confirm', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' };
}
function send(response, status, body, origin = '') { response.writeHead(status, headers(origin)); response.end(JSON.stringify(body)); }
async function body(request) {
  let text = ''; for await (const chunk of request) { text += chunk; if (text.length > MAX_BODY) throw new Error('请求体过大'); }
  return text ? JSON.parse(text) : {};
}
function authorize(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/iu, ''); if (!token) return false;
  const session = sessions.get(token); if (!session || session.expiresAt < Date.now()) { sessions.delete(token); return false; }
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1_000; return true;
}
async function inside(relativePath, allowMissing = false) {
  if (typeof relativePath !== 'string' || isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) throw new Error('路径必须位于授权工作区内');
  const target = resolve(workspaceRoot, relativePath || '.');
  const rel = relative(workspaceRoot, target); if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('路径越出授权工作区');
  if (allowMissing) { const parent = await realpath(dirname(target)); if (relative(workspaceRoot, parent).startsWith('..')) throw new Error('路径越出授权工作区'); return target; }
  const canonical = await realpath(target); if (relative(workspaceRoot, canonical).startsWith('..')) throw new Error('符号链接越出授权工作区'); return canonical;
}
async function run(program, argv, cwd, timeoutMs) {
  const safeCwd = await inside(cwd || '.');
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, argv, { cwd: safeCwd, shell: false, windowsHide: true, env: { ...process.env, STINGY_BRIDGE: '1' } });
    let stdout = '', stderr = ''; const collect = (key, chunk) => { const text = chunk.toString(); if (key === 'out') stdout = (stdout + text).slice(-MAX_OUTPUT); else stderr = (stderr + text).slice(-MAX_OUTPUT); };
    child.stdout?.on('data', (chunk) => collect('out', chunk)); child.stderr?.on('data', (chunk) => collect('err', chunk));
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_500).unref(); }, Math.min(Math.max(timeoutMs || 60_000, 1_000), 120_000));
    child.once('error', reject); child.once('close', (code, signal) => { clearTimeout(timer); resolveResult({ exitCode: code, signal, stdout, stderr, truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT }); });
  });
}
function risky(program, argv) { return /(?:rm|del|rmdir|format|diskpart|sudo|runas|powershell|cmd|bash|sh)$/iu.test(program) || argv.some((value) => /(?:--force|--global|-rf|install|publish|push|reset|clean)/iu.test(value)); }

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  try {
    if (!allowedOrigins.has(origin)) return send(response, 403, { error: '请求来源不受信任' }, origin);
    if (request.method === 'OPTIONS') return send(response, 204, {}, origin);
    if (request.headers['content-type'] !== 'application/json' && request.method !== 'GET') return send(response, 415, { error: '仅接受 application/json' }, origin);
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/v1/pair' && request.method === 'POST') {
      const input = await body(request); const supplied = Buffer.from(String(input.code || '')); const expected = Buffer.from(pairingCode);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(response, 401, { error: '配对码无效' }, origin);
      const token = randomBytes(32).toString('base64url'); sessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1_000 }); return send(response, 200, { token, rootName: workspaceRoot.split(/[\\/]/u).at(-1), expiresInMs: 8 * 60 * 60 * 1_000 }, origin);
    }
    if (!authorize(request)) return send(response, 401, { error: '本地桥会话无效或已过期' }, origin);
    if (url.pathname === '/v1/capabilities') return send(response, 200, { version: '1.0.0', root: workspaceRoot, capabilities: ['files','exec','git','dsh','stdio-mcp'] }, origin);
    if (url.pathname === '/v1/files/list') { const input = await body(request); const root = await inside(input.path || '.'); const entries = await readdir(root, { withFileTypes: true }); return send(response, 200, { entries: await Promise.all(entries.slice(0, 2_000).map(async (entry) => { const target = join(root, entry.name); const info = await stat(target); return { name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file', size: info.size, updatedAt: info.mtimeMs }; })) }, origin); }
    if (url.pathname === '/v1/files/read') { const input = await body(request); const target = await inside(input.path); const content = await readFile(target, 'utf8'); return send(response, 200, { content: content.slice(0, MAX_OUTPUT), truncated: content.length > MAX_OUTPUT }, origin); }
    if (url.pathname === '/v1/files/write') { const input = await body(request); const target = await inside(input.path, true); await mkdir(dirname(target), { recursive: true }); await writeFile(target, String(input.content ?? ''), 'utf8'); return send(response, 200, { ok: true }, origin); }
    if (url.pathname === '/v1/exec' || url.pathname === '/v1/git') {
      const input = await body(request); const program = url.pathname === '/v1/git' ? 'git' : String(input.program || ''); const argv = url.pathname === '/v1/git' ? input.args : input.args;
      if (!program || !Array.isArray(argv) || argv.some((item) => typeof item !== 'string' || item.length > 2_000)) return send(response, 400, { error: '命令参数无效' }, origin);
      if (risky(program, argv) && request.headers['x-stingy-confirm'] !== 'true') return send(response, 409, { error: '该命令需要显式确认', approvalRequired: true }, origin);
      return send(response, 200, await run(program, argv, input.cwd, input.timeoutMs), origin);
    }
    if (url.pathname === '/v1/dsh/install') {
      const input = await body(request); if (!/^@?[a-z0-9._/-]+$/iu.test(input.package || '') || !/^[a-z0-9.+_-]+$/iu.test(input.version || '')) return send(response, 400, { error: 'DSH 包名或版本无效' }, origin);
      const profile = join(homedir(), '.stingychat', 'dsh-profile'); await mkdir(profile, { recursive: true });
      return send(response, 200, await run('pnpm', ['add', '--ignore-scripts', `${input.package}@${input.version}`], profile, 120_000), origin);
    }
    return send(response, 404, { error: '接口不存在' }, origin);
  } catch (error) { return send(response, 500, { error: error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{24,}/gu, '[REDACTED]') : '本地桥执行失败' }, origin); }
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Stingy Bridge 已启动\n地址: http://127.0.0.1:${port}\n授权目录: ${workspaceRoot}\n一次性配对码: ${pairingCode}\n`);
});

