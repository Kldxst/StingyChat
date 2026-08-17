import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { ANONYMOUS_SETTINGS, DEFAULT_SETTINGS } from '../src/config';
import type { AuthSessionState, AuthUser, FeaturePermission, OnboardingAnswers, PersonalizationProfile, UserPreferencesEnvelope, UserRole } from '../src/types';
import type { WorkerEnv } from './glm';

type AppContext = Context<{ Bindings: WorkerEnv; Variables: { auth?: AuthSessionState } }>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_COOKIE = 'stingy_session';
const OAUTH_COOKIE = 'stingy_oauth';
const SESSION_TTL = 30 * 24 * 60 * 60;
const DEFAULT_QUOTA = 100 * 1024 * 1024;

const ROLE_PERMISSIONS: Record<UserRole, FeaturePermission[]> = {
  member: ['skills', 'smart_assist', 'reasoning', 'web_search', 'model_routing', 'batch', 'history_sync'],
  support: ['skills', 'smart_assist', 'reasoning', 'web_search', 'model_routing', 'batch', 'history_sync', 'admin_users_read', 'admin_restrictions_read', 'admin_usage_read'],
  admin: ['skills', 'smart_assist', 'reasoning', 'web_search', 'model_routing', 'batch', 'history_sync', 'admin_users_read', 'admin_users_write', 'admin_restrictions_read', 'admin_restrictions_write', 'admin_usage_read', 'admin_audit_read'],
  owner: ['skills', 'smart_assist', 'reasoning', 'web_search', 'model_routing', 'batch', 'history_sync', 'admin_users_read', 'admin_users_write', 'admin_restrictions_read', 'admin_restrictions_write', 'admin_usage_read', 'admin_audit_read', 'admin_chat_read', 'admin_owner_actions'],
};

export function rolePermissions(role: UserRole): FeaturePermission[] { return [...ROLE_PERMISSIONS[role]]; }
export function hasPermission(user: AuthUser, permission: FeaturePermission): boolean { return user.status === 'active' && user.permissions.includes(permission); }

export const onboardingAnswersSchema = z.object({
  useCase: z.string().trim().min(1).max(500),
  expertise: z.enum(['beginner', 'intermediate', 'advanced']),
  answerLength: z.enum(['brief', 'balanced', 'detailed']),
  reasoningDepth: z.enum(['minimal', 'balanced', 'deep']),
  tone: z.enum(['formal', 'neutral', 'friendly']),
  structure: z.enum(['prose', 'bullets', 'steps']),
  proactivity: z.enum(['low', 'medium', 'high']),
  evidencePreference: z.enum(['none', 'when-needed', 'always']),
  creativity: z.enum(['deterministic', 'balanced', 'creative']),
  priority: z.enum(['speed', 'cost', 'quality']),
});

export const personalizationSchema = z.object({
  systemPromptPrefix: z.string().trim().max(4000),
  answerLength: z.enum(['brief', 'balanced', 'detailed']),
  tone: z.enum(['formal', 'neutral', 'friendly']),
  structure: z.enum(['prose', 'bullets', 'steps']),
  proactivity: z.enum(['low', 'medium', 'high']),
  temperature: z.coerce.number().finite().transform((value) => Math.min(2, Math.max(0, value))),
  topP: z.coerce.number().finite().transform((value) => Math.min(1, Math.max(0.1, value))),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']),
  webSearch: z.boolean(),
  citations: z.boolean(),
  autoSkills: z.boolean(),
  optimizationPreset: z.enum(['balanced', 'efficient', 'quality']),
});

function database(env: WorkerEnv): D1Database | undefined { return env.APP_DB ?? env.ADMIN_DB; }
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}
function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
async function signedPayload(secret: string, payload: object): Promise<string> {
  const value = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${value}.${await hmac(secret, value)}`;
}
async function readSignedPayload<T>(secret: string, cookie: string | undefined): Promise<T | undefined> {
  if (!cookie) return undefined;
  const [value, signature] = cookie.split('.');
  if (!value || !signature || await hmac(secret, value) !== signature) return undefined;
  try { return JSON.parse(decoder.decode(base64UrlToBytes(value))) as T; } catch { return undefined; }
}
function requireConfig(env: WorkerEnv) {
  const baseUrl = env.CP_OAUTH_BASE_URL ?? 'https://www.cpoauth.com';
  if (!env.CP_OAUTH_CLIENT_ID || !env.CP_OAUTH_CLIENT_SECRET || !env.SESSION_SECRET || !env.PUBLIC_ORIGIN) {
    throw new Error('OAuth 服务尚未完成部署配置');
  }
  return { baseUrl: baseUrl.replace(/\/+$/u, ''), clientId: env.CP_OAUTH_CLIENT_ID, clientSecret: env.CP_OAUTH_CLIENT_SECRET, origin: env.PUBLIC_ORIGIN.replace(/\/+$/u, '') };
}
function randomToken(size = 32): string { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return bytesToBase64Url(bytes); }
function safeReturnPath(value: string | undefined): string { return value?.startsWith('/') && !value.startsWith('//') ? value : '/'; }

export async function beginOAuth(context: AppContext): Promise<Response> {
  const config = requireConfig(context.env);
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  const payload = await signedPayload(context.env.SESSION_SECRET!, { state, verifier, returnPath: safeReturnPath(context.req.query('returnTo')), expiresAt: Date.now() + 600_000 });
  setCookie(context, OAUTH_COOKIE, payload, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth', maxAge: 600 });
  const url = new URL(`${config.baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', `${config.origin}/api/auth/callback`);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return context.redirect(url.toString());
}

async function createLocalSession(context: AppContext, user: AuthUser): Promise<void> {
  const db = database(context.env);
  if (!db) throw new Error('用户数据库尚未配置');
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_TTL * 1000;
  await db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)').bind(tokenHash, user.id, expiresAt, Date.now()).run();
  setCookie(context, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL });
}

export async function finishOAuth(context: AppContext): Promise<Response> {
  const config = requireConfig(context.env);
  const pending = await readSignedPayload<{ state: string; verifier: string; returnPath: string; expiresAt: number }>(context.env.SESSION_SECRET!, getCookie(context, OAUTH_COOKIE));
  deleteCookie(context, OAUTH_COOKIE, { path: '/api/auth' });
  if (!pending || pending.expiresAt < Date.now() || pending.state !== context.req.query('state') || !context.req.query('code')) return context.redirect(`${config.origin}/?authError=invalid_state`);
  const tokenResponse = await fetch(`${config.baseUrl}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: context.req.query('code')!, redirect_uri: `${config.origin}/api/auth/callback`, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: pending.verifier }),
  });
  const tokens = await tokenResponse.json().catch(() => ({})) as { access_token?: string };
  if (!tokenResponse.ok || !tokens.access_token) return context.redirect(`${config.origin}/?authError=token_exchange`);
  const userResponse = await fetch(`${config.baseUrl}/api/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const remote = await userResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!userResponse.ok || !remote.sub) return context.redirect(`${config.origin}/?authError=userinfo`);
  const db = database(context.env)!;
  const id = String(remote.sub);
  const username = String(remote.preferred_username ?? remote.username ?? id).slice(0, 200);
  const displayName = String(remote.name ?? remote.display_name ?? username).slice(0, 200);
  const avatarUrl = typeof remote.picture === 'string' ? remote.picture.slice(0, 1000) : '';
  const isOwner = Boolean(context.env.OWNER_CP_SUB && id === context.env.OWNER_CP_SUB);
  await db.prepare(`INSERT INTO users (id, cp_sub, username, display_name, avatar_url, onboarding_status, role, status, updated_at)
    VALUES (?, ?, ?, ?, ?, 'required', ?, 'active', CURRENT_TIMESTAMP)
    ON CONFLICT(cp_sub) DO UPDATE SET username=excluded.username, display_name=excluded.display_name, avatar_url=excluded.avatar_url,
      role=CASE WHEN excluded.role='owner' THEN 'owner' ELSE users.role END,
      status=CASE WHEN excluded.role='owner' THEN 'active' ELSE users.status END, updated_at=CURRENT_TIMESTAMP`)
    .bind(id, id, username, displayName, avatarUrl, isOwner ? 'owner' : 'member').run();
  const row = await db.prepare('SELECT onboarding_status FROM users WHERE id = ?').bind(id).first<{ onboarding_status: AuthUser['onboardingStatus'] }>();
  const initialRole: UserRole = isOwner ? 'owner' : 'member';
  await createLocalSession(context, {
    id, username, displayName, avatarUrl: avatarUrl || undefined, onboardingStatus: row?.onboarding_status ?? 'required',
    role: initialRole, permissions: rolePermissions(initialRole), status: 'active', storageUsageBytes: 0, storageQuotaBytes: DEFAULT_QUOTA,
  });
  return context.redirect(`${config.origin}${safeReturnPath(pending.returnPath)}`);
}

export async function resolveSession(context: AppContext): Promise<AuthSessionState> {
  const token = getCookie(context, SESSION_COOKIE);
  const db = database(context.env);
  if (!token || !db) return { authenticated: false };
  const row = await db.prepare(`SELECT u.id, u.cp_sub, u.username, u.display_name, u.avatar_url, u.onboarding_status, u.role, u.status,
      u.storage_usage_bytes, u.storage_quota_bytes, s.expires_at
    FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row || Number(row.expires_at) <= Date.now()) {
    if (row) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(token)).run();
    deleteCookie(context, SESSION_COOKIE, { path: '/' });
    return { authenticated: false };
  }
  const owner = Boolean(context.env.OWNER_CP_SUB && String(row.cp_sub ?? row.id) === context.env.OWNER_CP_SUB);
  const role = owner ? 'owner' : (['admin', 'support', 'member'].includes(String(row.role)) ? String(row.role) as UserRole : 'member');
  const status = owner ? 'active' : row.status === 'suspended' ? 'suspended' : 'active';
  let permissions = rolePermissions(role);
  try {
    const overrides = await db.prepare('SELECT permission, allowed FROM user_permission_overrides WHERE user_id=?').bind(String(row.id)).all<{ permission: FeaturePermission; allowed: number }>();
    const result = new Set(permissions);
    for (const override of overrides.results ?? []) override.allowed ? result.add(override.permission) : result.delete(override.permission);
    permissions = role === 'owner' ? rolePermissions('owner') : [...result];
  } catch { /* Migration may still be rolling out; role defaults remain restrictive. */ }
  if (owner && row.role !== 'owner') context.executionCtx.waitUntil(db.prepare("UPDATE users SET role='owner', status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(row.id)).run());
  context.executionCtx.waitUntil(db.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').bind(Date.now(), await sha256(token)).run());
  return { authenticated: true, user: {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name), avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    onboardingStatus: row.onboarding_status as AuthUser['onboardingStatus'], role, permissions, status,
    storageUsageBytes: Number(row.storage_usage_bytes) || 0, storageQuotaBytes: Number(row.storage_quota_bytes) || DEFAULT_QUOTA,
  } };
}

export async function logout(context: AppContext): Promise<Response> {
  const token = getCookie(context, SESSION_COOKIE);
  const db = database(context.env);
  if (token && db) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  deleteCookie(context, SESSION_COOKIE, { path: '/' });
  return context.json({ ok: true });
}

export function validMutationOrigin(context: AppContext): boolean {
  const origin = context.req.header('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(context.env.PUBLIC_ORIGIN ?? context.req.url).origin; } catch { return false; }
}

async function profileKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptAnswers(env: WorkerEnv, userId: string, version: number, answers: OnboardingAnswers): Promise<{ ciphertext: string; iv: string }> {
  if (!env.PROFILE_ENCRYPTION_KEY) throw new Error('个性化加密密钥尚未配置');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${userId}:${version}`) }, await profileKey(env.PROFILE_ENCRYPTION_KEY), encoder.encode(JSON.stringify(answers)));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}
export async function decryptAnswers(env: WorkerEnv, userId: string, version: number, ciphertext: string, iv: string): Promise<OnboardingAnswers> {
  if (!env.PROFILE_ENCRYPTION_KEY) throw new Error('个性化加密密钥尚未配置');
  const ivBytes = base64UrlToBytes(iv);
  const cipherBytes = base64UrlToBytes(ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes.buffer.slice(ivBytes.byteOffset, ivBytes.byteOffset + ivBytes.byteLength) as ArrayBuffer, additionalData: encoder.encode(`${userId}:${version}`) }, await profileKey(env.PROFILE_ENCRYPTION_KEY), cipherBytes.buffer.slice(cipherBytes.byteOffset, cipherBytes.byteOffset + cipherBytes.byteLength) as ArrayBuffer);
  return onboardingAnswersSchema.parse(JSON.parse(decoder.decode(plaintext)));
}

export function safePersonalization(answers: OnboardingAnswers): PersonalizationProfile {
  return {
    systemPromptPrefix: `根据用户偏好，以${answers.tone === 'formal' ? '正式' : answers.tone === 'friendly' ? '友好' : '中性'}语气提供${answers.answerLength === 'brief' ? '精简' : answers.answerLength === 'detailed' ? '详尽' : '适中'}回答。`,
    answerLength: answers.answerLength, tone: answers.tone, structure: answers.structure, proactivity: answers.proactivity,
    temperature: answers.creativity === 'creative' ? 0.9 : answers.creativity === 'deterministic' ? 0.2 : 0.6,
    topP: answers.creativity === 'creative' ? 0.95 : 0.85,
    reasoningEffort: answers.reasoningDepth === 'deep' ? 'high' : answers.reasoningDepth === 'minimal' ? 'minimal' : 'medium',
    webSearch: answers.evidencePreference !== 'none', citations: answers.evidencePreference === 'always', autoSkills: answers.proactivity !== 'low',
    optimizationPreset: answers.priority === 'quality' ? 'quality' : answers.priority === 'cost' ? 'efficient' : 'balanced',
  };
}

function parseJson<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
export async function getPreferences(env: WorkerEnv, user: AuthUser): Promise<UserPreferencesEnvelope> {
  const db = database(env)!;
  const row = await db.prepare('SELECT * FROM user_preferences WHERE user_id=?').bind(user.id).first<Record<string, unknown>>();
  if (!row) return { version: 0, settings: DEFAULT_SETTINGS, favoriteModels: [], onboardingStatus: user.onboardingStatus, updatedAt: Date.now() };
  return {
    version: Number(row.version), settings: { ...DEFAULT_SETTINGS, ...parseJson(row.settings_json, {}) }, favoriteModels: parseJson(row.favorite_models_json, []),
    personalization: parseJson(row.personalization_json, undefined), onboardingStatus: String(row.onboarding_status) as AuthUser['onboardingStatus'],
    onboardingAnswers: row.onboarding_ciphertext && row.onboarding_iv ? await decryptAnswers(env, user.id, Number(row.version), String(row.onboarding_ciphertext), String(row.onboarding_iv)).catch(() => undefined) : undefined,
    updatedAt: Number(row.updated_at_ms) || Date.now(),
  };
}

export async function putPreferences(env: WorkerEnv, user: AuthUser, envelope: UserPreferencesEnvelope): Promise<{ conflict?: UserPreferencesEnvelope; value?: UserPreferencesEnvelope }> {
  const db = database(env)!;
  const current = await getPreferences(env, user);
  if (envelope.version !== current.version) return { conflict: current };
  const nextVersion = current.version + 1;
  let cipher = { ciphertext: '', iv: '' };
  const answers = envelope.onboardingAnswers ?? current.onboardingAnswers;
  if (answers) cipher = await encryptAnswers(env, user.id, nextVersion, answers);
  await db.prepare(`INSERT INTO user_preferences (user_id,version,settings_json,favorite_models_json,personalization_json,onboarding_ciphertext,onboarding_iv,onboarding_status,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,settings_json=excluded.settings_json,favorite_models_json=excluded.favorite_models_json,personalization_json=excluded.personalization_json,onboarding_ciphertext=excluded.onboarding_ciphertext,onboarding_iv=excluded.onboarding_iv,onboarding_status=excluded.onboarding_status,updated_at_ms=excluded.updated_at_ms`)
    .bind(user.id, nextVersion, JSON.stringify({ ...DEFAULT_SETTINGS, ...envelope.settings }), JSON.stringify(envelope.favoriteModels ?? []), JSON.stringify(envelope.personalization ?? null), cipher.ciphertext || null, cipher.iv || null, envelope.onboardingStatus, Date.now()).run();
  await db.prepare('UPDATE users SET onboarding_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(envelope.onboardingStatus, user.id).run();
  return { value: await getPreferences(env, { ...user, onboardingStatus: envelope.onboardingStatus }) };
}

export function anonymousSettings() { return structuredClone(ANONYMOUS_SETTINGS); }
