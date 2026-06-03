import { kvKey } from './kv-prefix';
import { createTelemetryShedNotice, type TelemetryOperatorNotice } from './telemetry-degradation';

interface ProviderTelemetryBucket {
  requests?: number;
  successes?: number;
  failures?: number;
  totalLatencyMs?: number;
  inputTokens?: number;
  requestedOutputTokens?: number;
}

export interface ProviderOperationalStats {
  provider: string;
  requests: number;
  successes: number;
  failures: number;
  averageLatencyMs: number;
  tokensUsed: number;
}

export interface OperationalStats {
  generatedAt: string;
  windowHours: number;
  telemetryAvailable: boolean;
  operatorNotice?: TelemetryOperatorNotice;
  requestsLast24h: number;
  successes: number;
  failures: number;
  averageLatencyMs: number;
  tokensUsed: number;
  topProvider: string | null;
  providers: ProviderOperationalStats[];
}

interface CollectStatsOptions {
  now?: Date;
  hours?: number;
}

interface ProviderAccumulator {
  provider: string;
  requests: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  tokensUsed: number;
}

function emptyStats(now: Date, hours: number, operatorNotice?: TelemetryOperatorNotice): OperationalStats {
  return {
    generatedAt: now.toISOString(),
    windowHours: hours,
    telemetryAvailable: !operatorNotice,
    ...(operatorNotice ? { operatorNotice } : {}),
    requestsLast24h: 0,
    successes: 0,
    failures: 0,
    averageLatencyMs: 0,
    tokensUsed: 0,
    topProvider: null,
    providers: [],
  };
}

function asCount(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function hourPrefix(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function shiftHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

function parseTelemetryKey(name: string, prefix: string): { provider: string } | null {
  const suffix = name.slice(prefix.length);
  const separator = suffix.lastIndexOf(':');
  if (separator <= 0) return null;

  const provider = suffix.slice(0, separator);
  const chatPath = suffix.slice(separator + 1);
  if (!provider || !['fast', 'balanced', 'heavy'].includes(chatPath)) return null;

  return { provider };
}

async function listKeys(kv: any, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of page?.keys || []) {
      if (typeof key?.name === 'string') keys.push(key.name);
    }
    cursor = page?.list_complete === false ? page?.cursor : undefined;
  } while (cursor);

  return keys;
}

function finalizeStats(now: Date, hours: number, providers: Map<string, ProviderAccumulator>): OperationalStats {
  const totals = [...providers.values()].reduce((sum, provider) => ({
    requests: sum.requests + provider.requests,
    successes: sum.successes + provider.successes,
    failures: sum.failures + provider.failures,
    tokensUsed: sum.tokensUsed + provider.tokensUsed,
    totalLatencyMs: sum.totalLatencyMs + provider.totalLatencyMs,
  }), { requests: 0, successes: 0, failures: 0, tokensUsed: 0, totalLatencyMs: 0 });

  const providerStats = [...providers.values()]
    .map((provider) => ({
      provider: provider.provider,
      requests: provider.requests,
      successes: provider.successes,
      failures: provider.failures,
      averageLatencyMs: provider.requests > 0 ? Math.round(provider.totalLatencyMs / provider.requests) : 0,
      tokensUsed: provider.tokensUsed,
    }))
    .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider));

  return {
    generatedAt: now.toISOString(),
    windowHours: hours,
    telemetryAvailable: true,
    requestsLast24h: totals.requests,
    successes: totals.successes,
    failures: totals.failures,
    averageLatencyMs: totals.requests > 0 ? Math.round(totals.totalLatencyMs / totals.requests) : 0,
    tokensUsed: totals.tokensUsed,
    topProvider: providerStats[0]?.provider ?? null,
    providers: providerStats,
  };
}

export async function collectOperationalStats(
  kv: any,
  env: Record<string, unknown> = {},
  options: CollectStatsOptions = {},
): Promise<OperationalStats> {
  const now = options.now || new Date();
  const hours = Math.max(1, Math.min(168, asCount(options.hours || 24)));
  if (!kv) return emptyStats(now, hours, createTelemetryShedNotice());

  const providers = new Map<string, ProviderAccumulator>();

  try {
    for (let offset = 0; offset < hours; offset++) {
      const prefix = kvKey(env, `telemetry:provider:${hourPrefix(shiftHours(now, offset))}:`);
      const keys = await listKeys(kv, prefix);

      for (const key of keys) {
        const parsed = parseTelemetryKey(key, prefix);
        if (!parsed) continue;

        const bucket = await kv.get(key, 'json').catch(() => null) as ProviderTelemetryBucket | null;
        if (!bucket) continue;

        const requests = asCount(bucket.requests);
        if (requests === 0) continue;

        const current = providers.get(parsed.provider) || {
          provider: parsed.provider,
          requests: 0,
          successes: 0,
          failures: 0,
          totalLatencyMs: 0,
          tokensUsed: 0,
        };

        current.requests += requests;
        current.successes += asCount(bucket.successes);
        current.failures += asCount(bucket.failures);
        current.totalLatencyMs += asCount(bucket.totalLatencyMs);
        current.tokensUsed += asCount(bucket.inputTokens) + asCount(bucket.requestedOutputTokens);
        providers.set(parsed.provider, current);
      }
    }
  } catch {
    return emptyStats(now, hours, createTelemetryShedNotice());
  }

  return finalizeStats(now, hours, providers);
}

function readEnvString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function isStatsAuthorized(headers: Headers, env: Record<string, unknown>): boolean {
  const expected = readEnvString(env, 'STATS_PASSWORD');
  if (!expected) return false;

  const authorization = headers.get('Authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const explicit = headers.get('x-stats-password')?.trim() || '';
  const provided = bearer || explicit;

  return provided ? safeEquals(provided, expected) : false;
}
