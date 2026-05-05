export function createRateLimiter(perMin: number) {
  const map = new Map<string, { count: number; reset: number }>();
  const window = 60_000;

  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of map) { if (now > v.reset) map.delete(k); }
    }, 30_000);
  }

  return {
    check(ip: string): boolean {
      const now = Date.now();
      const e = map.get(ip);
      if (!e || now > e.reset) { map.set(ip, { count: 1, reset: now + window }); return true; }
      if (e.count >= perMin) return false;
      e.count++; return true;
    },
    getState() { return map; },
  };
}

export function createDailyLimiter(defaultCap: number) {
  const map = new Map<string, number>();
  let reset = Date.now() + 86400000;

  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const now = Date.now();
      if (now > reset) { map.clear(); reset = now + 86400000; }
    }, 300_000);
  }

  return {
    check(ip: string, cap?: number): boolean {
      const c = (map.get(ip) || 0) + 1;
      map.set(ip, c);
      return c <= (cap ?? defaultCap);
    },
    count(ip: string): number { return map.get(ip) || 0; },
    total(): number { let s = 0; map.forEach(v => s += v); return s; },
  };
}
