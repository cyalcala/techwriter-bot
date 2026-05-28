const ALLOWED_FAULT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const PROVIDER_ID_PATTERN = /^[a-z0-9-]{2,64}$/;

export interface ProviderFaultPolicy {
  allStatus?: number;
  providerStatuses: Record<string, number>;
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function readEnvString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function parseProviderFaultSpec(spec: string): ProviderFaultPolicy | null {
  const providerStatuses: Record<string, number> = {};
  let allStatus: number | undefined;
  const entries = spec.split(',').map(entry => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > 12) return null;

  for (const entry of entries) {
    const [targetRaw, statusRaw, extra] = entry.split(':');
    if (!targetRaw || !statusRaw || extra != null) return null;

    const target = targetRaw.trim().toLowerCase();
    const status = Number(statusRaw.trim());
    if (!Number.isInteger(status) || !ALLOWED_FAULT_STATUSES.has(status)) return null;

    if (target === 'all') {
      allStatus = status;
      continue;
    }

    if (!PROVIDER_ID_PATTERN.test(target)) return null;
    providerStatuses[target] = status;
  }

  return { allStatus, providerStatuses };
}

export function parseProviderFaultInjection(
  env: Record<string, unknown>,
  headers: Headers,
): ProviderFaultPolicy | null {
  const expectedToken = readEnvString(env, 'PROVIDER_FAULT_INJECTION_TOKEN');
  if (!expectedToken) return null;

  const providedToken = headers.get('x-provider-fault-token')?.trim() || '';
  if (!providedToken || !safeEquals(providedToken, expectedToken)) return null;

  const spec = headers.get('x-provider-fault')?.trim() || '';
  return parseProviderFaultSpec(spec);
}

export function getInjectedProviderStatus(
  policy: ProviderFaultPolicy | null | undefined,
  providerId: string,
): number | null {
  if (!policy) return null;
  return policy.providerStatuses[providerId] ?? policy.allStatus ?? null;
}
