import { kvKey } from './kv-prefix';

export interface AppVersionRecovery {
  message: string;
  steps: string[];
}

export interface AppVersionStatus {
  available: boolean;
  expected: string;
  stored: string | null;
  mismatch: boolean;
  key: string;
  recovery?: AppVersionRecovery;
  error?: string;
}

function configuredVersion(env: Record<string, unknown>): string {
  const version = String(env.APP_VERSION ?? '').trim();
  return version || '0.0.1';
}

function recoveryGuidance(expected: string, stored: string | null): AppVersionRecovery {
  return {
    message: stored
      ? `Stored APP_VERSION ${stored} does not match running APP_VERSION ${expected}.`
      : `No stored APP_VERSION was found for running APP_VERSION ${expected}.`,
    steps: [
      'remove legacy content records such as retained session, RAG, response-cache, search-result, and rendered-artifact entries for this PROJECT_NAME prefix.',
      'preserve or migrate only required non-content operational entries, such as rate-limit, provider-health, aggregate-usage, and version state.',
      'rerun deploy.sh to write the current APP_VERSION after the privacy-safe migration is complete.',
    ],
  };
}

export async function checkAppVersion(kv: any, env: Record<string, unknown>): Promise<AppVersionStatus> {
  const expected = configuredVersion(env);
  const key = kvKey(env, 'app:version');

  if (!kv) {
    return { available: false, expected, stored: null, mismatch: false, key };
  }

  try {
    const stored = await kv.get(key);
    const normalizedStored = typeof stored === 'string' && stored.trim() ? stored.trim() : null;
    const mismatch = normalizedStored !== expected;

    return {
      available: true,
      expected,
      stored: normalizedStored,
      mismatch,
      key,
      ...(mismatch ? { recovery: recoveryGuidance(expected, normalizedStored) } : {}),
    };
  } catch {
    return {
      available: false,
      expected,
      stored: null,
      mismatch: false,
      key,
      error: 'version_check_failed',
    };
  }
}
