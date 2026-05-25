const DEFAULT_ORIGINS = [
  'https://tw-bot.pages.dev',
  'https://techwriter-bot.pages.dev',
  'http://localhost:4321',
  'http://localhost:3000',
  'http://127.0.0.1:4321',
  'http://127.0.0.1:3000',
];

export function checkCSRF(request: Request, allowed?: string[]): boolean {
  const origins = allowed || DEFAULT_ORIGINS;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) return true;
  const ok = (url: string) => {
    try { return origins.includes(new URL(url).origin); }
    catch { return false; }
  };
  if (origin && !ok(origin)) return false;
  if (referer && !ok(referer)) return false;
  return true;
}
