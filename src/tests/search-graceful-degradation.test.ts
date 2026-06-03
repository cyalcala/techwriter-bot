import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchRouter } from '../lib/search';
import { getDefaultState } from '../lib/reputation';

describe('search graceful degradation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('marks live search unavailable without returning source content when every search API fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('search offline');
    }) as unknown as typeof fetch;

    const result = await searchRouter(
      'latest api release notes 2026',
      true,
      { SESSION: null },
      '198.51.100.10',
      getDefaultState(),
    );

    expect(result.searchAttempted).toBe(true);
    expect(result.searchUnavailable).toBe(true);
    expect(result.searchTier).toBe('basic');
    expect(result.contextParts).toEqual([]);
    expect(result.sources).toEqual([]);
  });
});
