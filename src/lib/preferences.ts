import type { FavoriteModel, PersonalAssistantConfig, ProviderProfile } from '../types';

const FAVORITES_KEY = 'stingy-favorite-models-v1';
const PERSONAL_ASSISTANT_KEY = 'stingy-personal-assistant-v1';

export const DEFAULT_PERSONAL_ASSISTANT: PersonalAssistantConfig = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'GLM-4.7-Flash',
};

const DEFAULT_FAVORITE_PROFILE_IDS = [
  'stingy-free',
  'openai-default',
  'anthropic-default',
  'gemini-default',
];

export function favoriteModelId(profileId: string, model: string): string {
  return `${profileId}:${model}`;
}

export function defaultFavoriteModels(profiles: ProviderProfile[]): FavoriteModel[] {
  return DEFAULT_FAVORITE_PROFILE_IDS.flatMap((profileId) => {
    const profile = profiles.find((item) => item.id === profileId);
    return profile ? [{
      id: favoriteModelId(profile.id, profile.model),
      profileId: profile.id,
      model: profile.model,
      label: profile.kind === 'stingy' ? 'StingyChat' : profile.model,
    }] : [];
  });
}

export function loadFavoriteModels(profiles: ProviderProfile[]): FavoriteModel[] {
  if (typeof localStorage === 'undefined') return defaultFavoriteModels(profiles);
  const stored = localStorage.getItem(FAVORITES_KEY);
  if (!stored) return defaultFavoriteModels(profiles);
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return defaultFavoriteModels(profiles);
    const available = new Set(profiles.map((profile) => profile.id));
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<FavoriteModel>;
      if (!candidate.profileId || !candidate.model || !available.has(candidate.profileId)) return [];
      return [{
        id: favoriteModelId(candidate.profileId, candidate.model),
        profileId: candidate.profileId,
        model: candidate.model.slice(0, 160),
        label: (candidate.label || candidate.model).slice(0, 160),
      }];
    }).slice(0, 24);
  } catch {
    return defaultFavoriteModels(profiles);
  }
}

export function saveFavoriteModels(favorites: FavoriteModel[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.slice(0, 24)));
}

export function loadPersonalAssistantConfig(): PersonalAssistantConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_PERSONAL_ASSISTANT;
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSONAL_ASSISTANT_KEY) ?? '{}') as Partial<PersonalAssistantConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : DEFAULT_PERSONAL_ASSISTANT.baseUrl,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_PERSONAL_ASSISTANT.model,
    };
  } catch {
    return DEFAULT_PERSONAL_ASSISTANT;
  }
}

export function savePersonalAssistantConfig(config: PersonalAssistantConfig): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(PERSONAL_ASSISTANT_KEY, JSON.stringify(config));
}

export function removePersonalAssistantConfig(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(PERSONAL_ASSISTANT_KEY);
}
