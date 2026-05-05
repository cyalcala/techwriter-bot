const DEFAULT_ORIGINS = [
  'https://tw-bot.pages.dev',
  'https://techwriter-bot.pages.dev',
  'http://localhost:4321',
  'http://localhost:3000',
];

export function checkCSRF(request: Request, allowed?: string[]): boolean {
  const origins = allowed || DEFAULT_ORIGINS;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) return true;
  const ok = (url: string) => {
    try { const p = new URL(url); return origins.some(a => `${p.protocol}//${p.host}`.startsWith(a) || a.startsWith(`${p.protocol}//${p.host}`)); }
    catch { return false; }
  };
  if (origin && !ok(origin)) return false;
  if (referer && !ok(referer)) return false;
  return true;
}
