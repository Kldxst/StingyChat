import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../worker/index';
import { decryptAnswers, encryptAnswers, onboardingAnswersSchema, personalizationSchema, safePersonalization } from '../worker/auth';
import type { OnboardingAnswers } from '../src/types';
import { ONBOARDING_QUESTIONS } from '../src/components/OnboardingWizard';

const answers: OnboardingAnswers = {
  useCase: '软件工程与研究', expertise: 'advanced', answerLength: 'balanced', reasoningDepth: 'deep', tone: 'formal',
  structure: 'steps', proactivity: 'medium', evidencePreference: 'always', creativity: 'deterministic', priority: 'quality',
};
afterEach(() => vi.unstubAllGlobals());

class AuthD1 {
  user?: { id: string; username: string; displayName: string; avatarUrl: string; status: string };
  session?: { hash: string; userId: string; expiresAt: number };
  prepare(sql: string) {
    const values: unknown[] = [];
    const statement = {
      bind: (...items: unknown[]) => { values.push(...items); return statement; },
      run: async () => {
        if (sql.includes('INSERT INTO users')) this.user = { id: String(values[0]), username: String(values[2]), displayName: String(values[3]), avatarUrl: String(values[4]), status: 'required' };
        if (sql.includes('INSERT INTO auth_sessions')) this.session = { hash: String(values[0]), userId: String(values[1]), expiresAt: Number(values[2]) };
        return { success: true };
      },
      first: async () => {
        if (sql.includes('SELECT onboarding_status')) return { onboarding_status: this.user?.status ?? 'required' };
        if (sql.includes('FROM auth_sessions s JOIN users')) return this.session && this.user ? { id: this.user.id, username: this.user.username, display_name: this.user.displayName, avatar_url: this.user.avatarUrl, onboarding_status: this.user.status, expires_at: this.session.expiresAt } : null;
        return null;
      },
    };
    return statement;
  }
}

describe('CP OAuth and personalization security', () => {
  it('creates an authorization request with PKCE and a signed HttpOnly cookie', async () => {
    const response = await app.request('/api/auth/login?returnTo=%2Fsettings', {}, {
      CP_OAUTH_BASE_URL: 'https://www.cpoauth.com', CP_OAUTH_CLIENT_ID: 'client', CP_OAUTH_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'session-secret-with-enough-entropy', PUBLIC_ORIGIN: 'https://chat.kldxst.me', GLM_BASE_URL: '', GLM_MODEL: '', ASSETS: { fetch: async () => new Response() } as never,
    });
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('scope')).toBe('openid profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly.*Secure.*SameSite=Lax/iu);
  });

  it('encrypts onboarding answers with version-bound AES-GCM AAD', async () => {
    const env = { PROFILE_ENCRYPTION_KEY: 'profile-secret-key' } as never;
    const encrypted = await encryptAnswers(env, 'user-1', 2, answers);
    expect(encrypted.ciphertext).not.toContain(answers.useCase);
    await expect(decryptAnswers(env, 'user-1', 2, encrypted.ciphertext, encrypted.iv)).resolves.toEqual(answers);
    await expect(decryptAnswers(env, 'user-1', 3, encrypted.ciphertext, encrypted.iv)).rejects.toThrow();
  });

  it('exchanges the authorization code without persisting CP tokens and creates a hashed local session', async () => {
    const db = new AuthD1();
    const env = { CP_OAUTH_BASE_URL: 'https://www.cpoauth.com', CP_OAUTH_CLIENT_ID: 'client', CP_OAUTH_CLIENT_SECRET: 'secret', SESSION_SECRET: 'session-secret-with-enough-entropy', PUBLIC_ORIGIN: 'https://chat.kldxst.me', PROFILE_ENCRYPTION_KEY: 'profile-key', APP_DB: db, GLM_BASE_URL: '', GLM_MODEL: '', ASSETS: { fetch: async () => new Response() } } as never;
    const login = await app.request('/api/auth/login', {}, env);
    const authorize = new URL(login.headers.get('location')!);
    const oauthCookie = login.headers.get('set-cookie')!.split(';')[0];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'temporary-cp-token', refresh_token: 'never-store' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'cp-user-1', preferred_username: 'tester', name: '测试用户' }), { status: 200 })));
    const callback = await app.request(`/api/auth/callback?code=code-1&state=${encodeURIComponent(authorize.searchParams.get('state')!)}`, { headers: { cookie: oauthCookie } }, env);
    expect(callback.status).toBe(302);
    expect(db.session?.hash).toBeTruthy();
    expect(db.session?.hash).not.toContain('temporary-cp-token');
    expect(JSON.stringify(db)).not.toContain('never-store');
    expect(callback.headers.get('set-cookie')).toContain('stingy_session=');
  });

  it('requires all ten answers and clamps generated personalization', () => {
    expect(ONBOARDING_QUESTIONS).toHaveLength(10);
    expect(new Set(ONBOARDING_QUESTIONS.map((question) => question.key)).size).toBe(10);
    expect(onboardingAnswersSchema.safeParse(answers).success).toBe(true);
    expect(onboardingAnswersSchema.safeParse({ ...answers, priority: undefined }).success).toBe(false);
    expect(personalizationSchema.parse({ ...safePersonalization(answers), temperature: 9 }).temperature).toBe(2);
  });
});
