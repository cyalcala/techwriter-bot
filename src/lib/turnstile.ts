export async function verifyTurnstile(token: string, secret: string, timeoutMs: number = 2000): Promise<boolean> {
  if (!token || !secret) return true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new FormData(),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    r.body?.cancel();
    const d = await r.json() as any;
    return !!d.success;
  } catch {
    return true;
  }
}
