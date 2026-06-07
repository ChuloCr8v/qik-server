import { UserRole } from '@prisma/client';

export type PlatformAdminAccess = 'none' | 'platform_admin' | 'platform_superadmin';

export const FIRST_PLATFORM_ADMIN_EMAIL = 'chulocr8v@gmail.com';

export function platformAdminEmails() {
  const configured = process.env.PLATFORM_ADMIN_EMAILS || process.env.ADMIN_EMAILS || FIRST_PLATFORM_ADMIN_EMAIL;
  return configured
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getPlatformAdminAccess(user: { email?: string | null; role?: UserRole | string | null }): PlatformAdminAccess {
  const email = user.email?.toLowerCase();
  if (user.role === UserRole.SUPERADMIN || user.role === 'SUPERADMIN') {
    return 'platform_superadmin';
  }

  if (email && platformAdminEmails().includes(email) && (user.role === UserRole.ADMIN || user.role === 'ADMIN')) {
    return 'platform_admin';
  }

  return 'none';
}

export function isPlatformAdmin(user: { email?: string | null; role?: UserRole | string | null }) {
  return getPlatformAdminAccess(user) !== 'none';
}

export function isPlatformSuperAdmin(user: { email?: string | null; role?: UserRole | string | null }) {
  return getPlatformAdminAccess(user) === 'platform_superadmin';
}
