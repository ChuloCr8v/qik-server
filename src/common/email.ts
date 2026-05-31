export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || '';
}

export function isValidEmail(email?: string | null) {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
