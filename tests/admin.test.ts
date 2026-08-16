import { describe, expect, it } from 'vitest';
import { createAdminToken, matchesCidr, verifyAdminPassword, verifyAdminToken } from '../worker/admin';

describe('admin security helpers', () => {
  it('matches exact addresses and IPv4 CIDR ranges', () => {
    expect(matchesCidr('203.0.113.42', '203.0.113.0/24')).toBe(true);
    expect(matchesCidr('203.0.114.42', '203.0.113.0/24')).toBe(false);
    expect(matchesCidr('2001:db8::1', '2001:db8::1')).toBe(true);
  });

  it('verifies passwords and expiring signed sessions', async () => {
    expect(await verifyAdminPassword('correct', 'correct')).toBe(true);
    expect(await verifyAdminPassword('wrong', 'correct')).toBe(false);
    const token = await createAdminToken('secret');
    expect(await verifyAdminToken(token, 'secret')).toBe(true);
    expect(await verifyAdminToken(token, 'different')).toBe(false);
  });
});
