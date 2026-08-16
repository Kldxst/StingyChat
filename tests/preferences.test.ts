// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES } from '../src/config';
import {
  DEFAULT_PERSONAL_ASSISTANT,
  defaultFavoriteModels,
  favoriteModelId,
  loadFavoriteModels,
  loadPersonalAssistantConfig,
  removePersonalAssistantConfig,
  saveFavoriteModels,
  savePersonalAssistantConfig,
} from '../src/lib/preferences';

describe('local UI preferences', () => {
  beforeEach(() => localStorage.clear());

  it('provides removable defaults and preserves concrete model favorites', () => {
    const defaults = defaultFavoriteModels(DEFAULT_PROFILES);
    expect(defaults).toHaveLength(4);
    const favorite = { id: favoriteModelId('openai-default', 'gpt-test'), profileId: 'openai-default', model: 'gpt-test', label: 'GPT Test' };
    saveFavoriteModels([favorite]);
    expect(loadFavoriteModels(DEFAULT_PROFILES)).toEqual([favorite]);
    saveFavoriteModels([]);
    expect(loadFavoriteModels(DEFAULT_PROFILES)).toEqual([]);
  });

  it('persists and removes a custom private assistant endpoint and model', () => {
    const custom = { baseUrl: 'https://assistant.example/v1', model: 'private-model' };
    savePersonalAssistantConfig(custom);
    expect(loadPersonalAssistantConfig()).toEqual(custom);
    removePersonalAssistantConfig();
    expect(loadPersonalAssistantConfig()).toEqual(DEFAULT_PERSONAL_ASSISTANT);
  });
});
