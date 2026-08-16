import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('last model memory', () => {
  const source = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');

  it('reuses the last selected provider for new conversations', () => {
    expect(source).toContain("localStorage.getItem('stingy-last-profile')");
    expect(source).toContain("localStorage.setItem('stingy-last-profile', patch.providerProfileId)");
    expect(source).toContain('state.lastProfileId');
    expect(source).toContain('model: stored.model');
  });

  it('persists the pre-extreme snapshot so disabling restores settings after reload', () => {
    expect(source).toContain('beforeExtreme: settingsRecord?.beforeExtreme');
    expect(source).toContain("db.settings.put({ id: 'global', value, beforeExtreme })");
  });
});
