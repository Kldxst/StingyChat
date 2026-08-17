import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ChatRequest, ConversationMemory, FeaturePermission, OnboardingAnswers, UserPreferencesEnvelope, UserRole } from '../src/types';
import { getBatchResults, getBatchStatus, submitBatch } from './batch';
import { callGlm, callGlmTask, parseJsonObject, type PersonalAssistantCredentials, type WorkerEnv } from './glm';
export { GlmScheduler } from './glmScheduler';
import { streamProvider } from './providers';
import { extractAssistantText, getRestriction, requestIp } from './admin';
import {
  assistTextSchema,
  batchOperationSchema,
  batchSubmitSchema,
  cacheMatchSchema,
  chatRequestSchema,
  compressionSchema,
  routeSchema,
} from './schemas';
import { securityHeaders, validateCustomBaseUrl } from './security';
import {
  fallbackCacheKey,
  fallbackCacheMatch,
  fallbackMemory,
  fallbackOptimizePrompt,
  fallbackRoute,
  fallbackSystemPrompt,
} from './assistFallbacks';
import {
  anonymousSettings,
  beginOAuth,
  finishOAuth,
  getPreferences,
  hasPermission,
  logout,
  onboardingAnswersSchema,
  personalizationSchema,
  putPreferences,
  resolveSession,
  safePersonalization,
  validMutationOrigin,
} from './auth';
import { conversationSyncSchema, deleteCloudConversation, exportCloudData, getCloudConversation, listCloudConversations, syncCloudConversation } from './history';

type AppEnvironment = { Bindings: WorkerEnv; Variables: { auth?: Awaited<ReturnType<typeof resolveSession>> } };
const app = new Hono<AppEnvironment>();
const MAX_BODY_BYTES = 8 * 1024 * 1024;
function appDatabase(env: WorkerEnv): D1Database | undefined { return env.APP_DB ?? env.ADMIN_DB; }

function requirePermission(permission: FeaturePermission) {
  return async (context: Context<AppEnvironment>, next: () => Promise<void>) => {
    const auth = await resolveSession(context);
    if (!auth.authenticated || !auth.user) return context.json({ error: '请先登录后使用此功能' }, 401);
    if (!hasPermission(auth.user, permission)) return context.json({ error: auth.user.status === 'suspended' ? '账号当前已停用' : '当前账号没有此功能权限' }, 403);
    if (context.req.method !== 'GET' && !validMutationOrigin(context)) return context.json({ error: '请求来源无效' }, 403);
    context.set('auth', auth);
    await next();
  };
}

async function writeAdminAudit(context: Context<AppEnvironment>, action: string, targetUserId?: string, details: object = {}) {
  const db = appDatabase(context.env); const actor = context.get('auth')?.user;
  if (!db || !actor) return;
  await db.prepare('INSERT INTO admin_audit_events (actor_user_id,target_user_id,action,details_json,ip,created_at_ms) VALUES (?,?,?,?,?,?)')
    .bind(actor.id, targetUserId ?? null, action, JSON.stringify(details), requestIp(context), Date.now()).run();
}

function networkRuntimePrompt(context: Context<AppEnvironment>): string {
  const cf = context.req.raw.cf as {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
    latitude?: string;
    longitude?: string;
  } | undefined;
  if (!cf) return '';
  const location = [cf.city, cf.region, cf.country].filter(Boolean).join('，');
  return [
    'Cloudflare 请求上下文（仅为 IP 推断的粗略位置，不是精确地址）：',
    location ? `- 大致位置：${location}` : '',
    cf.timezone ? `- Cloudflare 推断时区：${cf.timezone}` : '',
    cf.latitude && cf.longitude ? `- 大致坐标：${cf.latitude}, ${cf.longitude}` : '',
    '- 涉及本地法规、天气或附近地点时，应说明位置是粗略推断，并在必要时向用户确认。',
  ].filter(Boolean).join('\n');
}

export function enrichChatRequestWithNetworkContext(
  context: Context<AppEnvironment>,
  request: ChatRequest,
): ChatRequest {
  const network = networkRuntimePrompt(context);
  return network ? { ...request, systemPrompt: `${request.systemPrompt}\n\n${network}` } : request;
}

export function auditMessages(messages: ChatRequest['messages']) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    attachments: message.attachments?.map(({ id, name, mimeType, size, kind }) => ({ id, name, mimeType, size, kind })),
  }));
}

function decodeAssistantHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { return decodeURIComponent(value).trim(); } catch { return undefined; }
}

function internalGlmOptions(context: { req: { header(name: string): string | undefined } }, operation: string) {
  const apiKey = context.req.header('x-user-assistant-api-key')?.trim()
    || context.req.header('x-user-glm-api-key')?.trim();
  const baseUrl = decodeAssistantHeader(context.req.header('x-user-assistant-base-url'));
  const model = decodeAssistantHeader(context.req.header('x-user-assistant-model'));
  const personalAssistant: PersonalAssistantCredentials | string | undefined = apiKey
    ? (baseUrl && model ? { apiKey, baseUrl, model } : apiKey)
    : undefined;
  return {
    personalAssistant,
    requestId: context.req.header('x-glm-request-id') ?? crypto.randomUUID(),
    operation,
  };
}

app.use('*', async (context, next) => {
  if (context.req.path.startsWith('/api/')) {
    const length = Number(context.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return context.json({ error: '请求体超过 8 MB 限制' }, 413);
    const personalKey = context.req.header('x-user-assistant-api-key');
    if (personalKey) {
      const baseUrl = decodeAssistantHeader(context.req.header('x-user-assistant-base-url'));
      const model = decodeAssistantHeader(context.req.header('x-user-assistant-model'));
      if (!baseUrl || !model || personalKey.length > 500 || baseUrl.length > 500 || model.length > 160) {
        return context.json({ error: '私人智能助手配置不完整或超出长度限制' }, 400);
      }
      try { validateCustomBaseUrl(baseUrl); } catch (error) {
        return context.json({ error: error instanceof Error ? error.message : '私人智能助手端点无效' }, 400);
      }
    }
  }
  await next();
  for (const [name, value] of Object.entries(securityHeaders())) context.res.headers.set(name, value);
});

app.get('/api/health', (context) =>
  context.json({
    ok: true,
    glmConfigured: Boolean(context.env.GLM_API_KEY),
    freeModelConfigured: Boolean(context.env.FREE_GLM_API_KEY),
    adminConfigured: Boolean(context.env.OWNER_CP_SUB && appDatabase(context.env)),
  }),
);

app.get('/api/auth/login', (context) => beginOAuth(context));
app.get('/api/auth/callback', (context) => finishOAuth(context));
app.get('/api/auth/session', async (context) => context.json(await resolveSession(context)));
app.post('/api/auth/logout', async (context) => validMutationOrigin(context) ? logout(context) : context.json({ error: '请求来源无效' }, 403));

app.use('/api/user/*', async (context, next) => {
  const auth = await resolveSession(context);
  if (!auth.authenticated || !auth.user) return context.json({ error: '请先登录后使用此功能' }, 401);
  if (auth.user.status !== 'active') return context.json({ error: '账号当前已停用' }, 403);
  if (context.req.method !== 'GET' && !validMutationOrigin(context)) return context.json({ error: '请求来源无效' }, 403);
  context.set('auth', auth);
  await next();
});

app.get('/api/user/preferences', async (context) => context.json(await getPreferences(context.env, context.get('auth')!.user!)));
app.put('/api/user/preferences', async (context) => {
  const body = await context.req.json<UserPreferencesEnvelope>().catch(() => undefined);
  if (!body || !Number.isInteger(body.version) || !body.settings || !Array.isArray(body.favoriteModels)) return context.json({ error: '设置请求格式无效' }, 400);
  const result = await putPreferences(context.env, context.get('auth')!.user!, body);
  return result.conflict ? context.json({ error: '设置已在其他页面更新', latest: result.conflict }, 409) : context.json(result.value!);
});

async function proposePersonalization(context: Context<AppEnvironment>, answers: OnboardingAnswers) {
  const fallback = safePersonalization(answers);
  try {
    const options = internalGlmOptions(context, 'personalization');
    const content = await callGlm(
      context.env,
      '根据十项用户偏好生成聊天助手配置。不得推断敏感属性。只输出严格 JSON，字段为 systemPromptPrefix,answerLength,tone,structure,proactivity,temperature,topP,reasoningEffort,webSearch,citations,autoSkills,optimizationPreset。temperature 范围 0-2，topP 范围 0.1-1。',
      JSON.stringify(answers), 0.2, options.personalAssistant, options.requestId, options.operation,
    );
    return { profile: personalizationSchema.parse(parseJsonObject(content)), pending: false };
  } catch {
    return { profile: fallback, pending: true };
  }
}

app.post('/api/user/onboarding/complete', async (context) => {
  const parsed = onboardingAnswersSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '请完成全部十项引导问题' }, 400);
  const user = context.get('auth')!.user!;
  const current = await getPreferences(context.env, user);
  const saved = await putPreferences(context.env, user, { ...current, onboardingAnswers: parsed.data, onboardingStatus: 'pending' });
  if (saved.conflict) return context.json({ error: '设置版本冲突', latest: saved.conflict }, 409);
  const proposal = await proposePersonalization(context, parsed.data);
  return context.json({ ...proposal, preferences: saved.value });
});

app.post('/api/user/personalization/regenerate', async (context) => {
  const body = await context.req.json().catch(() => undefined);
  const auth = context.get('auth')!;
  const existing = await getPreferences(context.env, auth.user!);
  const parsed = onboardingAnswersSchema.safeParse(body ?? existing.onboardingAnswers);
  if (!parsed.success) return context.json({ error: '尚无完整的个性引导答案' }, 400);
  return context.json(await proposePersonalization(context, parsed.data));
});

app.use('/api/conversations/*', requirePermission('history_sync'));
app.get('/api/conversations', async (context) => context.json(await listCloudConversations(
  context.env, context.get('auth')!.user!, Number(context.req.query('cursor')) || 0, Number(context.req.query('limit')) || 50,
)));
app.get('/api/conversations/export', async (context) => context.json(await exportCloudData(
  context.env, context.get('auth')!.user!, await getPreferences(context.env, context.get('auth')!.user!),
)));
app.get('/api/conversations/:id', async (context) => {
  const conversation = await getCloudConversation(context.env, context.get('auth')!.user!, context.req.param('id'));
  return conversation ? context.json(conversation) : context.json({ error: '对话不存在' }, 404);
});
app.put('/api/conversations/:id', async (context) => {
  const parsed = conversationSyncSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success || parsed.data.conversation.id !== context.req.param('id')) return context.json({ error: '会话同步数据无效' }, 400);
  const result = await syncCloudConversation(context.env, context.get('auth')!.user!, parsed.data);
  if ('conflict' in result) return context.json({ error: '会话已在其他设备更新', latest: result.conflict }, 409);
  if ('quotaExceeded' in result) return context.json({ error: '云端历史空间已满', quota: result.quota, projected: result.projected }, 413);
  if ('deleted' in result) return context.json({ error: '该对话已在其他设备删除' }, 410);
  return context.json(result);
});
app.delete('/api/conversations/:id', async (context) => {
  await deleteCloudConversation(context.env, context.get('auth')!.user!, context.req.param('id'));
  return context.json({ ok: true });
});

app.get('/favicon.ico', (context) => context.body(null, 204));

app.get('/api/assist/queue/:requestId', async (context) => {
  const requestId = context.req.param('requestId');
  if (!context.env.GLM_SCHEDULER) return context.json({ requestId, state: 'personal', operation: 'assist', position: 0, queuedAt: Date.now(), estimatedWaitMs: 0 });
  const stub = context.env.GLM_SCHEDULER.get(context.env.GLM_SCHEDULER.idFromName('global'));
  return stub.fetch(`https://glm-scheduler/status/${encodeURIComponent(requestId)}`);
});

app.post('/api/chat/stream', async (context) => {
  const parsed = chatRequestSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({
    code: 'CHAT_REQUEST_INVALID',
    error: '聊天请求包含不兼容字段，已保留输入，可直接重试',
    issues: parsed.error.issues.slice(0, 6).map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
  }, 400);
  const request = parsed.data as ChatRequest;
  const auth = await resolveSession(context);
  if (!auth.authenticated || !auth.user) request.settings = anonymousSettings();
  else {
    if (auth.user.status !== 'active') return context.json({ error: '账号当前已停用' }, 403);
    request.settings = {
      ...request.settings,
      reasoningEnabled: hasPermission(auth.user, 'reasoning') && request.settings.reasoningEnabled,
      webSearch: hasPermission(auth.user, 'web_search') && request.settings.webSearch,
      modelRouting: hasPermission(auth.user, 'model_routing') && request.settings.modelRouting,
      autoSkills: hasPermission(auth.user, 'skills') && request.settings.autoSkills,
    };
  }
  const ip = requestIp(context);
  const restriction = await getRestriction(context.env, ip);
  if (restriction?.block_chat) return context.json({ error: '当前网络段已被管理员限制聊天功能' }, 403);
  if (restriction?.block_web_search) request.settings = { ...request.settings, webSearch: false };
  if (request.profile.kind === 'stingy') {
    request.profile = { ...request.profile, model: context.env.FREE_GLM_MODEL ?? 'GLM-4.5-Flash' };
  }
  const providerRequest = enrichChatRequestWithNetworkContext(context, request);
  let response: Response;
  if (request.profile.kind === 'stingy') {
    const options = internalGlmOptions(context, 'stingy-chat');
    if (options.personalAssistant) {
      const personal = typeof options.personalAssistant === 'string'
        ? { apiKey: options.personalAssistant, baseUrl: context.env.FREE_GLM_BASE_URL ?? context.env.GLM_BASE_URL, model: request.profile.model }
        : options.personalAssistant;
      const personalRequest = { ...providerRequest, profile: { ...providerRequest.profile, model: personal.model } };
      response = await streamProvider(personalRequest, personal.apiKey, personal.baseUrl);
    } else if (context.env.GLM_SCHEDULER) {
      const stub = context.env.GLM_SCHEDULER.get(context.env.GLM_SCHEDULER.idFromName('global'));
      response = await stub.fetch('https://glm-scheduler/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: options.requestId, operation: options.operation, request: providerRequest }),
      });
    } else {
      if (!context.env.FREE_GLM_API_KEY) return context.json({ error: '免费模型暂时不可用' }, 503);
      response = await streamProvider(providerRequest, context.env.FREE_GLM_API_KEY, context.env.FREE_GLM_BASE_URL);
    }
  } else {
    const apiKey = context.req.header('x-provider-api-key') ?? '';
    response = await streamProvider(providerRequest, apiKey);
  }
  if (!context.env.ADMIN_DB || !response.body) return response;
  const [clientBody, auditBody] = response.body.tee();
  context.executionCtx.waitUntil((async () => {
    const sse = await new Response(auditBody).text();
    await context.env.ADMIN_DB!.prepare(
      'INSERT INTO chat_logs (conversation_id, ip, provider, model, request_json, response_text, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      request.conversationId,
      ip,
      request.profile.kind,
      request.profile.model,
      JSON.stringify({ messages: auditMessages(request.messages), systemPrompt: request.systemPrompt, settings: request.settings }),
      extractAssistantText(sse),
      auth.user?.id ?? null,
    ).run();
    if (auth.user) await appDatabase(context.env)?.prepare(`INSERT INTO user_usage_daily (user_id,usage_date,chat_requests) VALUES (?,date('now'),1)
      ON CONFLICT(user_id,usage_date) DO UPDATE SET chat_requests=chat_requests+1`).bind(auth.user.id).run();
  })());
  return new Response(clientBody, response);
});

app.use('/api/assist/*', async (context, next) => {
  const auth = await resolveSession(context);
  if (!auth.authenticated || !auth.user) return context.json({ error: '请先登录后使用智能辅助功能' }, 401);
  if (!hasPermission(auth.user, 'smart_assist')) return context.json({ error: '当前账号没有智能辅助权限' }, 403);
  if (context.req.path.endsWith('/web-search') && !hasPermission(auth.user, 'web_search')) return context.json({ error: '当前账号没有联网权限' }, 403);
  if (context.req.path.endsWith('/reason') && !hasPermission(auth.user, 'reasoning')) return context.json({ error: '当前账号没有思考权限' }, 403);
  const restriction = await getRestriction(context.env, requestIp(context));
  if (restriction?.block_assist) return context.json({ error: '当前网络段已被管理员限制智能辅助功能' }, 403);
  await next();
});

app.use('/api/conversation/*', async (context, next) => {
  const auth = await resolveSession(context);
  if (!auth.authenticated) return context.json({ error: '请先登录后使用上下文优化功能' }, 401);
  await next();
});

app.use('/api/batch/*', requirePermission('batch'));

app.use('/api/admin/*', async (context, next) => {
  const auth = await resolveSession(context);
  if (!auth.authenticated || !auth.user) return context.json({ error: '请先登录' }, 401);
  if (!hasPermission(auth.user, 'admin_users_read')) return context.json({ error: '没有管理后台权限' }, 403);
  if (context.req.method !== 'GET' && !validMutationOrigin(context)) return context.json({ error: '请求来源无效' }, 403);
  if (!appDatabase(context.env)) return context.json({ error: '管理数据库尚未配置' }, 503);
  context.set('auth', auth);
  await next();
});

app.get('/api/admin/overview', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_usage_read')) return context.json({ error: '没有用量统计权限' }, 403);
  const db = appDatabase(context.env)!;
  const [users, conversations, requests, suspended] = await Promise.all([
    db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) count FROM cloud_conversations').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) count FROM chat_logs WHERE created_at >= datetime(\'now\', \'-1 day\')').first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) count FROM users WHERE status='suspended'").first<{ count: number }>(),
  ]);
  return context.json({ users: Number(users?.count ?? 0), conversations: Number(conversations?.count ?? 0), requests24h: Number(requests?.count ?? 0), suspended: Number(suspended?.count ?? 0) });
});

app.get('/api/admin/users', async (context) => {
  const page = Math.max(1, Number(context.req.query('page')) || 1); const limit = Math.min(100, Math.max(10, Number(context.req.query('limit')) || 25));
  const query = (context.req.query('q') ?? '').trim(); const role = context.req.query('role'); const status = context.req.query('status');
  const clauses: string[] = []; const values: unknown[] = [];
  if (query) { clauses.push('(username LIKE ? OR display_name LIKE ? OR id LIKE ?)'); values.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (role && ['owner', 'admin', 'support', 'member'].includes(role)) { clauses.push('role=?'); values.push(role); }
  if (status && ['active', 'suspended'].includes(status)) { clauses.push('status=?'); values.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const db = appDatabase(context.env)!;
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT id,username,display_name,avatar_url,onboarding_status,role,status,storage_quota_bytes,storage_usage_bytes,created_at,updated_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...values, limit, (page - 1) * limit).all(),
    db.prepare(`SELECT COUNT(*) count FROM users ${where}`).bind(...values).first<{ count: number }>(),
  ]);
  return context.json({ items: rows.results ?? [], total: Number(count?.count ?? 0), page, limit });
});

async function targetUser(context: Context<AppEnvironment>, id: string) {
  return appDatabase(context.env)!.prepare('SELECT id,cp_sub,role,status FROM users WHERE id=?').bind(id).first<{ id: string; cp_sub: string; role: UserRole; status: string }>();
}

app.patch('/api/admin/users/:id/role', async (context) => {
  const actor = context.get('auth')!.user!; if (!hasPermission(actor, 'admin_users_write')) return context.json({ error: '没有用户管理权限' }, 403);
  const body = await context.req.json<{ role?: UserRole }>().catch((): { role?: UserRole } => ({})); const target = await targetUser(context, context.req.param('id'));
  if (!target || !body.role || !['owner', 'admin', 'support', 'member'].includes(body.role)) return context.json({ error: '用户或角色无效' }, 400);
  if (target.cp_sub === context.env.OWNER_CP_SUB || target.role === 'owner') return context.json({ error: '永久 Owner 不能被降级' }, 403);
  if (actor.role !== 'owner' && (body.role === 'owner' || body.role === 'admin' || target.role === 'admin')) return context.json({ error: '仅 Owner 可管理高权限角色' }, 403);
  await appDatabase(context.env)!.prepare('UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.role, target.id).run();
  await writeAdminAudit(context, 'user.role', target.id, { from: target.role, to: body.role }); return context.json({ ok: true });
});

app.put('/api/admin/users/:id/permissions', async (context) => {
  const actor = context.get('auth')!.user!; if (!hasPermission(actor, 'admin_users_write')) return context.json({ error: '没有权限管理权限' }, 403);
  const body = await context.req.json<{ permissions?: Array<{ permission: FeaturePermission; allowed: boolean }> }>().catch((): { permissions?: Array<{ permission: FeaturePermission; allowed: boolean }> } => ({})); const target = await targetUser(context, context.req.param('id'));
  if (!target || !Array.isArray(body.permissions) || target.role === 'owner') return context.json({ error: '权限变更请求无效' }, 400);
  const allowedPermissions = new Set<FeaturePermission>(['skills','smart_assist','reasoning','web_search','model_routing','batch','history_sync','admin_users_read','admin_restrictions_read','admin_usage_read']);
  const statements = body.permissions.filter((item) => allowedPermissions.has(item.permission)).map((item) => appDatabase(context.env)!.prepare(`INSERT INTO user_permission_overrides (user_id,permission,allowed,updated_by,updated_at_ms) VALUES (?,?,?,?,?) ON CONFLICT(user_id,permission) DO UPDATE SET allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at_ms=excluded.updated_at_ms`).bind(target.id, item.permission, item.allowed ? 1 : 0, actor.id, Date.now()));
  if (statements.length) await appDatabase(context.env)!.batch(statements); await writeAdminAudit(context, 'user.permissions', target.id, { count: statements.length }); return context.json({ ok: true });
});

app.patch('/api/admin/users/:id/quota', async (context) => {
  const actor = context.get('auth')!.user!; if (!hasPermission(actor, 'admin_users_write')) return context.json({ error: '没有配额管理权限' }, 403);
  const body = await context.req.json<{ bytes?: number }>().catch((): { bytes?: number } => ({})); const bytes = Number(body.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 * 1024 || bytes > 10 * 1024 * 1024 * 1024) return context.json({ error: '配额范围无效' }, 400);
  await appDatabase(context.env)!.prepare('UPDATE users SET storage_quota_bytes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(bytes, context.req.param('id')).run();
  await writeAdminAudit(context, 'user.quota', context.req.param('id'), { bytes }); return context.json({ ok: true });
});

app.patch('/api/admin/users/:id/status', async (context) => {
  const actor = context.get('auth')!.user!; if (!hasPermission(actor, 'admin_users_write')) return context.json({ error: '没有账号管理权限' }, 403);
  const body = await context.req.json<{ status?: 'active' | 'suspended'; reason?: string }>().catch((): { status?: 'active' | 'suspended'; reason?: string } => ({})); const target = await targetUser(context, context.req.param('id'));
  if (!target || !body.status || target.cp_sub === context.env.OWNER_CP_SUB || target.role === 'owner') return context.json({ error: '永久 Owner 不能被停用' }, 403);
  await appDatabase(context.env)!.prepare('UPDATE users SET status=?,suspended_at_ms=?,suspended_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.status, body.status === 'suspended' ? Date.now() : null, body.status === 'suspended' ? String(body.reason ?? '').slice(0, 300) : null, target.id).run();
  if (body.status === 'suspended') await appDatabase(context.env)!.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(target.id).run();
  await writeAdminAudit(context, `user.${body.status}`, target.id, { reason: body.reason }); return context.json({ ok: true });
});

app.post('/api/admin/users/:id/revoke-sessions', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_users_write')) return context.json({ error: '没有会话管理权限' }, 403);
  await appDatabase(context.env)!.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(context.req.param('id')).run();
  await writeAdminAudit(context, 'user.sessions.revoke', context.req.param('id')); return context.json({ ok: true });
});

app.delete('/api/admin/users/:id', async (context) => {
  const actor = context.get('auth')!.user!; if (!hasPermission(actor, 'admin_owner_actions')) return context.json({ error: '仅 Owner 可永久删除用户' }, 403);
  const body = await context.req.json<{ confirmation?: string }>().catch((): { confirmation?: string } => ({})); const target = await targetUser(context, context.req.param('id'));
  if (!target || target.role === 'owner' || target.cp_sub === context.env.OWNER_CP_SUB || body.confirmation !== target.id) return context.json({ error: '确认标识不匹配，或目标不可删除' }, 400);
  await writeAdminAudit(context, 'user.delete', target.id, { confirmed: true });
  await appDatabase(context.env)!.prepare('DELETE FROM users WHERE id=?').bind(target.id).run(); return context.json({ ok: true });
});

app.get('/api/admin/audit', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_audit_read')) return context.json({ error: '没有操作日志权限' }, 403);
  const rows = await appDatabase(context.env)!.prepare('SELECT * FROM admin_audit_events ORDER BY id DESC LIMIT 500').all(); return context.json({ items: rows.results ?? [] });
});

app.get('/api/admin/chats', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_chat_read')) return context.json({ error: '仅 Owner 可查看聊天正文' }, 403);
  const rows = await appDatabase(context.env)!.prepare('SELECT * FROM chat_logs ORDER BY id DESC LIMIT 500').all();
  return context.json({ items: rows.results });
});

app.get('/api/admin/restrictions', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_restrictions_read')) return context.json({ error: '没有网络限制读取权限' }, 403);
  const rows = await appDatabase(context.env)!.prepare('SELECT * FROM ip_restrictions ORDER BY id DESC').all();
  return context.json({ items: rows.results });
});

app.post('/api/admin/restrictions', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_restrictions_write')) return context.json({ error: '没有网络限制管理权限' }, 403);
  const body = await context.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const cidr = typeof body.cidr === 'string' ? body.cidr.trim() : '';
  if (!cidr || cidr.length > 80) return context.json({ error: 'IP 或 CIDR 格式无效' }, 400);
  await appDatabase(context.env)!.prepare(
    'INSERT INTO ip_restrictions (cidr, block_chat, block_assist, block_web_search, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cidr) DO UPDATE SET block_chat=excluded.block_chat, block_assist=excluded.block_assist, block_web_search=excluded.block_web_search, reason=excluded.reason',
  ).bind(cidr, body.blockChat ? 1 : 0, body.blockAssist ? 1 : 0, body.blockWebSearch ? 1 : 0, typeof body.reason === 'string' ? body.reason.slice(0, 300) : '').run();
  await writeAdminAudit(context, 'restriction.upsert', undefined, { cidr });
  return context.json({ ok: true });
});

app.delete('/api/admin/restrictions/:id', async (context) => {
  if (!hasPermission(context.get('auth')!.user!, 'admin_restrictions_write')) return context.json({ error: '没有网络限制管理权限' }, 403);
  const id = Number(context.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return context.json({ error: '限制记录无效' }, 400);
  await appDatabase(context.env)!.prepare('DELETE FROM ip_restrictions WHERE id = ?').bind(id).run();
  await writeAdminAudit(context, 'restriction.delete', undefined, { id });
  return context.json({ ok: true });
});

app.post('/api/assist/optimize-prompt', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '请输入待优化内容' }, 400);
  const options = internalGlmOptions(context, 'optimize-prompt');
  const text = await callGlm(
    context.env,
    '你是无损提示词编译器。按以下优先级处理：1. 原样保留事实、专有名词、变量、代码、数值、否定条件、权限边界和输出契约；2. 合并重复或同义指令，消解指代；3. 删除寒暄、情绪铺垫、元话语和无信息修饰；4. 将任务整理为目标、输入、约束、输出四个紧凑字段，仅在确有必要时使用字段。不得补充假设，不得回答任务。只输出可直接发送的优化提示词。',
    parsed.data.text,
    0.1, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => fallbackOptimizePrompt(parsed.data.text));
  return context.json({ text });
});

app.post('/api/assist/generate-system-prompt', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '请输入角色描述' }, 400);
  const options = internalGlmOptions(context, 'generate-system-prompt');
  const text = await callGlm(
    context.env,
    '你是 System Prompt 架构师。根据描述生成可直接部署的提示词，依次明确：角色与目标、信息优先级、执行流程、硬约束、失败与不确定性处理、输出格式。只写能改变模型行为的规则；避免口号、重复、泛化的“认真思考”；不得扩大权限或虚构工具。规则应可测试、无冲突、语言紧凑。只输出提示词正文。',
    parsed.data.text,
    0.2, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => fallbackSystemPrompt(parsed.data.text));
  return context.json({ text });
});

app.post('/api/assist/generate-title', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '标题生成请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'generate-conversation-title');
  const fallback = parsed.data.text.replace(/\s+/gu, ' ').trim().slice(0, 18) || '新对话';
  const text = await callGlm(
    context.env,
    '为一轮对话生成便于扫描的中文标题。概括具体任务或主题，不使用引号、句号、冒号、泛化词“咨询”或“问题”。长度 6 到 18 个汉字，只输出标题。',
    parsed.data.text.slice(0, 12_000),
    0.2, options.personalAssistant, options.requestId, options.operation,
  ).then((value) => value.replace(/[\r\n"“”。，：:]/gu, '').trim().slice(0, 24) || fallback).catch(() => fallback);
  return context.json({ text });
});

const memorySchema = z.object({
  summary: z.string(),
  facts: z.array(z.string()),
  preferences: z.array(z.string()),
  openTasks: z.array(z.string()),
  constraints: z.array(z.string()),
  citations: z.array(z.string()),
});

app.post('/api/conversation/compress', async (context) => {
  const parsed = compressionSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '压缩请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'compress-conversation');
  const content = await callGlm(
    context.env,
    '将对话编译为可续接的长期状态。仅保留后续回答会用到的信息；事实必须带主体，偏好不得误写为硬约束，已完成事项不得留在 openTasks，冲突信息保留最新结论并在 summary 标明。不得丢失数值、文件名、引用、否定条件和未完成动作。只输出严格 JSON：{"summary":"","facts":[],"preferences":[],"openTasks":[],"constraints":[],"citations":[]}。',
    `${parsed.data.currentMemory ? `已有记忆：${parsed.data.currentMemory}\n` : ''}对话：\n${parsed.data.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n')}`,
    0.1, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => JSON.stringify(fallbackMemory(parsed.data.messages)));
  const memory = memorySchema.parse(parseJsonObject<Omit<ConversationMemory, 'updatedAt'>>(content));
  return context.json({ ...memory, updatedAt: Date.now() });
});

app.post('/api/assist/route', async (context) => {
  const parsed = routeSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '路由请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'route-model');
  const content = await callGlm(
    context.env,
    '判断任务复杂度。复杂推理、多步骤规划、专业分析或高风险准确性要求为 complex；其余为 simple。只输出 JSON：{"route":"simple|complex","reason":"不超过20字"}。',
    JSON.stringify(parsed.data),
    0, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => JSON.stringify(fallbackRoute(parsed.data.prompt, parsed.data.needsWebSearch, parsed.data.needsReasoning)));
  const result = z
    .object({ route: z.enum(['simple', 'complex']), reason: z.string().max(100) })
    .parse(parseJsonObject(content));
  return context.json(result);
});

app.post('/api/assist/cache-match', async (context) => {
  const parsed = cacheMatchSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '缓存匹配请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'cache-match');
  const content = await callGlm(
    context.env,
    '判断两个提问在给定上下文指纹下能否安全复用逐字相同的最终答案。只有目标、实体、时间范围、数值、约束、输出格式和所需新鲜度全部等价时才为 true；实时信息、不同版本、不同文件、代词指向不明或任一条件变化都必须为 false。宁可漏报，不可误命中。只输出 JSON：{"equivalent":true|false,"reason":"不超过20字"}。',
    JSON.stringify(parsed.data),
    0, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => JSON.stringify(fallbackCacheMatch(parsed.data.prompt, parsed.data.candidatePrompt)));
  const result = z
    .object({ equivalent: z.boolean(), reason: z.string().max(100) })
    .parse(parseJsonObject(content));
  return context.json(result);
});

app.post('/api/assist/cache-normalize', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '语义增强请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'cache-normalize');
  const text = await callGlm(
    context.env,
    '将当前提问规范化为稳定的缓存检索键。结合上下文消解代词、省略和相对时间；显式写出任务动作、目标实体、版本或时间范围、关键数值、硬约束、输出格式与新鲜度要求。删除语气、同义措辞和无关历史，但不得泛化不同实体或条件，不得改变精度。不得回答问题。只输出一行规范化提问。',
    `${parsed.data.context ? `对话上下文：\n${parsed.data.context}\n\n` : ''}当前提问：\n${parsed.data.text}`,
    0, options.personalAssistant, options.requestId, options.operation,
  ).catch(() => fallbackCacheKey(parsed.data.text));
  return context.json({ text });
});

app.post('/api/assist/reason', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '辅助推演请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'reason');
  const text = await callGlm(
    context.env,
    '你是可公开展示的任务规划器。根据上下文给出简短、可验证的分析提纲和执行注意点，不声称这是其他模型的私有思维链，不直接替用户完成最终回答。',
    `${parsed.data.context ? `上下文：\n${parsed.data.context}\n\n` : ''}任务：\n${parsed.data.text}`,
    0.1, options.personalAssistant, options.requestId, options.operation,
  );
  return context.json({ text, source: 'glm' });
});

app.post('/api/assist/web-search', async (context) => {
  const parsed = assistTextSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '联网搜索请求格式无效' }, 400);
  const options = internalGlmOptions(context, 'web-search');
  const result = await callGlmTask(context.env, {
    requestId: options.requestId,
    operation: options.operation,
    system: '使用联网搜索获取当前、可验证的信息。输出简洁事实摘要，并在句末引用来源编号。不得声称没有联网环境。',
    user: parsed.data.text,
    temperature: 0.1,
    webSearch: true,
  }, options.personalAssistant);
  const citations = (result.sources ?? []).map((source, index) => ({
    chunkId: `web:${options.requestId}:${index}`,
    documentName: source.title,
    title: source.title,
    url: source.url,
    excerpt: source.excerpt,
    score: 1 - index * 0.05,
    sourceType: 'web' as const,
  }));
  return context.json({ text: result.content, citations });
});

app.post('/api/assist/understand-image', async (context) => {
  const parsed = z.object({ text: z.string().max(20_000), dataUrl: z.string().min(20).max(6_000_000) })
    .safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success || !/^data:image\/(?:png|jpeg|webp|gif);base64,/u.test(parsed.data.dataUrl)) {
    return context.json({ error: '图片理解请求格式无效' }, 400);
  }
  const options = internalGlmOptions(context, 'understand-image');
  const result = await callGlmTask(context.env, {
    requestId: options.requestId,
    operation: options.operation,
    system: '准确描述图片中与用户任务相关的内容，并提取可见文字。不要猜测不可见信息，输出适合交给另一个模型继续处理的紧凑说明。',
    user: parsed.data.text || '描述图片并提取可见文字。',
    imageDataUrl: parsed.data.dataUrl,
    model: context.env.GLM_VISION_MODEL ?? 'GLM-4.6V-Flash',
    temperature: 0.1,
  }, options.personalAssistant);
  return context.json({ text: result.content });
});

app.post('/api/batch/submit', async (context) => {
  const parsed = batchSubmitSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '批处理请求格式无效' }, 400);
  const apiKey = context.req.header('x-provider-api-key') ?? '';
  if (!apiKey) return context.json({ error: '请先配置 Provider API Key' }, 401);
  return context.json(await submitBatch(parsed.data.profile, apiKey, parsed.data.items));
});

app.post('/api/batch/status', async (context) => {
  const parsed = batchOperationSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '批处理状态请求格式无效' }, 400);
  const apiKey = context.req.header('x-provider-api-key') ?? '';
  if (!apiKey) return context.json({ error: '请先配置 Provider API Key' }, 401);
  return context.json(await getBatchStatus(parsed.data.profile, apiKey, parsed.data.batchId));
});

app.post('/api/batch/results', async (context) => {
  const parsed = batchOperationSchema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) return context.json({ error: '批处理结果请求格式无效' }, 400);
  const apiKey = context.req.header('x-provider-api-key') ?? '';
  if (!apiKey) return context.json({ error: '请先配置 Provider API Key' }, 401);
  return getBatchResults(parsed.data.profile, apiKey, parsed.data.batchId);
});

app.onError((error, context) => {
  const message = error instanceof Error ? error.message : '服务暂时不可用';
  const safeMessage = message.replace(/(?:sk-|AIza|key[-_:]?)[A-Za-z0-9._-]{8,}/giu, '[REDACTED]');
  const status = /暂时繁忙|连接超时|尚未配置/u.test(safeMessage) ? 503 : 500;
  return context.json({ error: safeMessage }, status);
});

app.notFound((context) => {
  if (context.req.path.startsWith('/api/')) return context.json({ error: '接口不存在' }, 404);
  return context.env.ASSETS.fetch(context.req.raw);
});

export default app;
