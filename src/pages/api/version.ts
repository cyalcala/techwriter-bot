import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { createRequestId, jsonResponse } from '../../lib/api-response';
import { checkAppVersion } from '../../lib/app-version';
import { readEnvKeys } from '../../lib/env-reader';

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

export const GET: APIRoute = async ({ locals }) => {
  const requestId = createRequestId();
  const env = loadEnv(locals);
  const version = await checkAppVersion((env as any).SESSION, env);

  return jsonResponse({
    status: version.mismatch ? 'mismatch' : 'ok',
    version,
  }, { requestId, status: version.mismatch ? 409 : 200 });
};
