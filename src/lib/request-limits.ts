export interface RequestLimits {
  chatMaxChars: number;
  maxRequestBodyBytes: number;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
}

const DEFAULT_LIMITS: RequestLimits = {
  chatMaxChars: 4000,
  maxRequestBodyBytes: 5 * 1024 * 1024,
  rateLimitPerMinute: 30,
  rateLimitPerDay: 500,
};

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRequestLimits(env: Record<string, unknown>): RequestLimits {
  return {
    chatMaxChars: positiveInt(env.CHAT_MAX_CHARS, DEFAULT_LIMITS.chatMaxChars),
    maxRequestBodyBytes: positiveInt(env.MAX_REQUEST_BODY_BYTES, DEFAULT_LIMITS.maxRequestBodyBytes),
    rateLimitPerMinute: positiveInt(env.RATE_LIMIT_PER_MINUTE, DEFAULT_LIMITS.rateLimitPerMinute),
    rateLimitPerDay: positiveInt(env.RATE_LIMIT_PER_DAY, DEFAULT_LIMITS.rateLimitPerDay),
  };
}

export function sanitizeChatInput(input: string, maxChars: number): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxChars);
}
