import type { ProviderProfile } from '../types';

export function requiresUserApiKey(profile: Pick<ProviderProfile, 'kind'>): boolean {
  return profile.kind !== 'stingy';
}
