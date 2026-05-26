import { describe, expect, it } from 'vitest';

describe('open-session outage continuity', () => {
  it('recognizes all-provider outage without retaining response content', async () => {
    const { createLiveOutageState } = await import('../lib/session-continuity');

    const state = createLiveOutageState({
      code: 'AI_PROVIDERS_UNAVAILABLE',
      retryable: true,
      retryAfter: 14,
    }, true);

    expect(state).toEqual({ hasPriorResponse: true, retryAfterSeconds: 14 });
    expect(JSON.stringify(state)).not.toContain('content');
  });

  it('does not create continuity state for unrelated API errors', async () => {
    const { createLiveOutageState } = await import('../lib/session-continuity');

    expect(createLiveOutageState({ code: 'INVALID_REQUEST' }, true)).toBeNull();
  });

  it('only identifies a prior response when visible session output exists', async () => {
    const { hasVisibleLiveResponse } = await import('../lib/session-continuity');

    expect(hasVisibleLiveResponse([{ liveResponse: true, content: '' }])).toBe(false);
    expect(hasVisibleLiveResponse([{ liveResponse: true, content: 'Answer in view' }])).toBe(true);
    expect(hasVisibleLiveResponse([{ liveResponse: true, content: '', hasArtifact: true }])).toBe(true);
  });
});
