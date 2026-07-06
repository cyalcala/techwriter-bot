const DEFAULT_ORIGINS = [
  'https://tw-bot.pages.dev',
  'https://techwriter-bot.pages.dev',
  'https://codex-privacy-first-disclosu.tw-bot.pages.dev',
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

  // The origin actually serving this request. In production the page and the
  // /api/* route are the same host, so a request whose Origin matches this is
  // the site itself — not a cross-site attacker (browsers set Origin, it can't
  // be forged). This lets the app work on ANY host it is legitimately served
  // from: the canonical domain, per-deploy *.pages.dev URLs, and custom
  // domains — without hard-coding each one, while still blocking cross-origin
  // POSTs (a different Origin never equals our served host).
  let selfOrigin: string | null = null;
  try { selfOrigin = new URL(request.url).origin; } catch {}

  const ok = (url: string) => {
    try {
      const o = new URL(url).origin;
      if (selfOrigin && o === selfOrigin) return true;
      return origins.includes(o);
    } catch { return false; }
  };
  if (origin && !ok(origin)) return false;
  if (referer && !ok(referer)) return false;
  return true;
}
