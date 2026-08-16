import { describe, expect, it } from 'vitest';
import { requiresUserApiKey } from '../src/lib/providerAuth';

describe('Provider authorization policy', () => {
  it('never requires a browser API key for the built-in StingyChat model', () => {
    expect(requiresUserApiKey({ kind: 'stingy' })).toBe(false);
  });

  it('requires browser API keys for user-configured providers', () => {
    expect(requiresUserApiKey({ kind: 'openai' })).toBe(true);
    expect(requiresUserApiKey({ kind: 'custom' })).toBe(true);
  });
});
