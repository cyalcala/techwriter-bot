import { describe, expect, it } from 'vitest';

describe('provider fault injection harness', () => {
  it('is disabled unless a matching secret token is configured and supplied', async () => {
    const { parseProviderFaultInjection } = await import('../lib/provider-fault-injection');

    expect(parseProviderFaultInjection({}, new Headers({
      'x-provider-fault-token': 'test',
      'x-provider-fault': 'all:503',
    }))).toBeNull();

    expect(parseProviderFaultInjection({ PROVIDER_FAULT_INJECTION_TOKEN: 'expected' }, new Headers({
      'x-provider-fault-token': 'wrong',
      'x-provider-fault': 'all:503',
    }))).toBeNull();
  });

  it('parses bounded provider and all-provider failure specs only', async () => {
    const { getInjectedProviderStatus, parseProviderFaultInjection, parseProviderFaultSpec } = await import('../lib/provider-fault-injection');

    const policy = parseProviderFaultInjection({ PROVIDER_FAULT_INJECTION_TOKEN: 'expected' }, new Headers({
      'x-provider-fault-token': 'expected',
      'x-provider-fault': 'groq-fast:503,cerebras-llama:429',
    }));

    expect(policy).toEqual({ providerStatuses: { 'groq-fast': 503, 'cerebras-llama': 429 } });
    expect(getInjectedProviderStatus(policy, 'groq-fast')).toBe(503);
    expect(getInjectedProviderStatus(policy, 'gemini-flash')).toBeNull();

    expect(getInjectedProviderStatus(parseProviderFaultSpec('all:504'), 'gemini-flash')).toBe(504);
    expect(parseProviderFaultSpec('all:200')).toBeNull();
    expect(parseProviderFaultSpec('../../secret:503')).toBeNull();
    expect(parseProviderFaultSpec('groq-fast:503:extra')).toBeNull();
  });
});
