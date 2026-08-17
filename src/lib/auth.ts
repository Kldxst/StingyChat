import type { AuthSessionState, OnboardingAnswers, PersonalizationProfile, UserPreferencesEnvelope } from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const payload = await response.json().catch(() => undefined) as ({ error?: string; latest?: UserPreferencesEnvelope } & T) | undefined;
  if (!response.ok) {
    const error = new Error(payload?.error ?? `请求失败 (${response.status})`) as Error & { status?: number; latest?: UserPreferencesEnvelope };
    error.status = response.status; error.latest = payload?.latest; throw error;
  }
  return payload as T;
}

export function getAuthSession(): Promise<AuthSessionState> { return requestJson('/api/auth/session'); }
export function getUserPreferences(): Promise<UserPreferencesEnvelope> { return requestJson('/api/user/preferences'); }
export function updateUserPreferences(value: UserPreferencesEnvelope): Promise<UserPreferencesEnvelope> {
  return requestJson('/api/user/preferences', { method: 'PUT', body: JSON.stringify(value) });
}
export function completeOnboarding(answers: OnboardingAnswers): Promise<{ profile: PersonalizationProfile; pending: boolean; preferences: UserPreferencesEnvelope }> {
  return requestJson('/api/user/onboarding/complete', { method: 'POST', body: JSON.stringify(answers) });
}
export function regeneratePersonalization(answers?: OnboardingAnswers): Promise<{ profile: PersonalizationProfile; pending: boolean }> {
  return requestJson('/api/user/personalization/regenerate', { method: 'POST', body: JSON.stringify(answers) });
}
export async function logoutUser(): Promise<void> { await requestJson('/api/auth/logout', { method: 'POST', body: '{}' }); }
export function loginUrl(returnTo = '/'): string { return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`; }
