import { describe, expect, it } from 'vitest';
import { matchesCidr } from '../worker/admin';
import { hasPermission, rolePermissions } from '../worker/auth';
import type { AuthUser } from '../src/types';

describe('admin security helpers', () => {
  it('matches exact addresses and IPv4 CIDR ranges', () => {
    expect(matchesCidr('203.0.113.42', '203.0.113.0/24')).toBe(true);
    expect(matchesCidr('203.0.114.42', '203.0.113.0/24')).toBe(false);
    expect(matchesCidr('2001:db8::1', '2001:db8::1')).toBe(true);
  });

  it('grants chat audit and owner actions only to the owner role', () => {
    const owner = { role: 'owner', status: 'active', permissions: rolePermissions('owner') } as AuthUser;
    const admin = { role: 'admin', status: 'active', permissions: rolePermissions('admin') } as AuthUser;
    expect(hasPermission(owner, 'admin_chat_read')).toBe(true);
    expect(hasPermission(owner, 'admin_owner_actions')).toBe(true);
    expect(hasPermission(admin, 'admin_chat_read')).toBe(false);
    expect(hasPermission({ ...owner, status: 'suspended' }, 'admin_chat_read')).toBe(false);
  });
});
