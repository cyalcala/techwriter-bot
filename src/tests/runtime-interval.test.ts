import { describe, expect, it } from 'vitest';

describe('runtime cleanup intervals', () => {
  it('do not keep Node build and verification processes alive', async () => {
    const { startCleanupInterval } = await import('../lib/runtime-interval');
    const timer = startCleanupInterval(() => {}, 60_000) as unknown as { hasRef?: () => boolean };

    try {
      expect(timer.hasRef?.()).toBe(false);
    } finally {
      clearInterval(timer as unknown as ReturnType<typeof setInterval>);
    }
  });
});
