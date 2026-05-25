import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { checkAppVersion } from '../../lib/app-version';
import { readEnvKeys, checkEnvKeys } from '../../lib/env-reader';
import { checkProvidersHealth } from '../../lib/provider-health';
import { ZEN_REGISTRY } from '../../lib/providers';

function loadEnv(locals: App.Locals): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try {
    const runtimeEnv = (locals as any)?.runtime?.env;
    if (runtimeEnv) {
      for (const [key, value] of Object.entries(runtimeEnv)) {
        if (value != null && !env[key]) env[key] = value;
      }
    }
  } catch {}
  readEnvKeys(env);
  return env;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const GET: APIRoute = async ({ locals }) => {
  const requestId = createRequestId();
  const env = loadEnv(locals);

  try {
    const timeoutMs = positiveInt(env.HEALTH_PING_TIMEOUT_MS, 5000);
    const providers = await checkProvidersHealth(ZEN_REGISTRY, env, { timeoutMs });
    const configuredProviders = providers.filter(provider => provider.configured).length;
    const activeProviders = providers.filter(provider => provider.ok).length;
    const version = await checkAppVersion((env as any).SESSION, env);
    const status = activeProviders > 0 && !version.mismatch ? 'ok' : 'unavailable';

    return jsonResponse({
      status,
      generatedAt: new Date().toISOString(),
      providerCount: providers.length,
      configuredProviders,
      activeProviders,
      keys: checkEnvKeys(env),
      version,
      providers,
    }, { requestId, status: activeProviders > 0 && !version.mismatch ? 200 : 503 });
  } catch (error: any) {
    return apiError({
      requestId,
      status: 500,
      code: 'HEALTH_CHECK_FAILED',
      message: error?.message ? String(error.message).slice(0, 200) : 'Health check failed.',
      retryable: true,
    });
  }
};
