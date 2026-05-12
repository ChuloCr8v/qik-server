export type EmailThemeName = 'default' | 'emerald' | 'midnight';

export type EmailTheme = {
  name: EmailThemeName;
  brand: string;
  background: string;
  surface: string;
  border: string;
  primary: string;
  primaryText: string;
  text: string;
  muted: string;
  accent: string;
};

export const emailThemes: Record<EmailThemeName, EmailTheme> = {
  default: {
    name: 'default',
    brand: 'QikAgenda',
    background: '#f8fafc',
    surface: '#ffffff',
    border: '#e2e8f0',
    primary: '#2563eb',
    primaryText: '#ffffff',
    text: '#0f172a',
    muted: '#64748b',
    accent: '#dbeafe',
  },
  emerald: {
    name: 'emerald',
    brand: 'QikAgenda',
    background: '#f0fdfa',
    surface: '#ffffff',
    border: '#ccfbf1',
    primary: '#0f766e',
    primaryText: '#ffffff',
    text: '#134e4a',
    muted: '#5c7f7a',
    accent: '#ccfbf1',
  },
  midnight: {
    name: 'midnight',
    brand: 'QikAgenda',
    background: '#0f172a',
    surface: '#ffffff',
    border: '#dbe4ef',
    primary: '#4f46e5',
    primaryText: '#ffffff',
    text: '#111827',
    muted: '#64748b',
    accent: '#eef2ff',
  },
};

export function getEmailTheme(themeName?: string) {
  if (themeName && themeName in emailThemes) {
    return emailThemes[themeName as EmailThemeName];
  }

  return emailThemes.default;
}
