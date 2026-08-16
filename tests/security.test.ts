import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeFetch, validateCustomBaseUrl } from '../worker/security';

afterEach(() => vi.unstubAllGlobals());

describe('custom provider URL validation', () => {
  it.each([
    'http://api.example.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://192.168.1.5/v1',
    'https://user:password@example.com/v1',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateCustomBaseUrl(url)).toThrow();
  });

  it('normalizes a public HTTPS endpoint', () => {
    expect(validateCustomBaseUrl('https://api.example.com/v1///?secret=1').toString()).toBe('https://api.example.com/v1');
  });

  it('turns network failures into a stable redacted error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS detail')));
    await expect(safeFetch('https://api.example.com/v1', {})).rejects.toThrow('无法连接上游 Provider');
  });
});
