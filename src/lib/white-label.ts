export interface WhiteLabelConfig {
  appTitle: string;
  logoUrl: string;
  primaryColor: string;
  footerText: string;
}

export const DEFAULT_APP_TITLE = 'Technical Writer';
export const DEFAULT_PRIMARY_COLOR = '#16a34a';
export const DEFAULT_FOOTER_TEXT = 'AI can make mistakes. Verify important info.';

interface WhiteLabelOptions {
  personaName?: string;
}

function cleanDisplayText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLength).trim() || fallback;
}

function cleanLogoUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url || url.length > 500) return '';
  if (url.startsWith('/') && !url.startsWith('//')) return url;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function cleanPrimaryColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PRIMARY_COLOR;
  const color = value.trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color) ? color : DEFAULT_PRIMARY_COLOR;
}

export function readWhiteLabelConfig(
  env: Record<string, unknown>,
  options: WhiteLabelOptions = {},
): WhiteLabelConfig {
  const personaFallback = cleanDisplayText(options.personaName, DEFAULT_APP_TITLE, 80);
  return {
    appTitle: cleanDisplayText(env.APP_TITLE, personaFallback, 80),
    logoUrl: cleanLogoUrl(env.APP_LOGO_URL),
    primaryColor: cleanPrimaryColor(env.PRIMARY_COLOR),
    footerText: cleanDisplayText(env.FOOTER_TEXT, DEFAULT_FOOTER_TEXT, 160),
  };
}
