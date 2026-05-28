import { kvKey } from './kv-prefix';

export type TelemetryChatPath = 'fast' | 'balanced' | 'heavy';
export type ProviderOutcome = 'success' | 'http_error' | 'provider_error' | 'missing_api_key';

export interface ProviderTelemetryEvent {
  provider: string;
  chatPath: TelemetryChatPath;
  outcome: ProviderOutcome;
  latencyMs: number;
  status?: number;
  inputTokens?: number;
  requestedOutputTokens?: number;
  freeTier?: boolean;
}

interface ProviderTelemetryBucket {
  requests: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  inputTokens: number;
  requestedOutputTokens: number;
  freeTierRequests: number;
  statuses: Record<string, number>;
  outcomes: Partial<Record<ProviderOutcome, number>>;
  updatedAt: string;
}

function safeDimension(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'unknown';
}

function asCount(value: number | undefined): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function emptyBucket(now: Date): ProviderTelemetryBucket {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    inputTokens: 0,
    requestedOutputTokens: 0,
    freeTierRequests: 0,
    statuses: {},
    outcomes: {},
    updatedAt: now.toISOString(),
  };
}

export async function recordProviderTelemetry(
  kv: any,
  env: Record<string, unknown>,
  event: ProviderTelemetryEvent,
  now: Date = new Date(),
): Promise<void> {
  if (!kv) return;

  const hour = now.toISOString().slice(0, 13);
  const key = kvKey(env, `telemetry:provider:${hour}:${safeDimension(event.provider)}:${event.chatPath}`);
  try {
    const existing = await kv.get(key, 'json').catch(() => null) as ProviderTelemetryBucket | null;
    const bucket = existing || emptyBucket(now);
    const latency = asCount(event.latencyMs);

    bucket.requests++;
    if (event.outcome === 'success') bucket.successes++;
    else bucket.failures++;
    bucket.totalLatencyMs += latency;
    bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, latency);
    bucket.inputTokens += asCount(event.inputTokens);
    bucket.requestedOutputTokens += asCount(event.requestedOutputTokens);
    if (event.freeTier) bucket.freeTierRequests++;
    bucket.outcomes[event.outcome] = (bucket.outcomes[event.outcome] || 0) + 1;
    if (event.status != null) {
      const status = String(event.status);
      bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
    }
    bucket.updatedAt = now.toISOString();

    await kv.put(key, JSON.stringify(bucket), { expirationTtl: 86400 * 30 });
  } catch {}
}
