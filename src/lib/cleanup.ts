import { clearSessionVectors, purgeStaleData } from './rag-db';

function clearLegacyBrowserState(): void {
  try { sessionStorage.clear(); } catch {}
  try { localStorage.removeItem('tw_conv'); } catch {}
  try { localStorage.removeItem('tw_session_id'); } catch {}
}

export function setupCleanupCallbacks(sessionId: string) {
  const cleanup = () => {
    clearSessionVectors(sessionId).catch(() => {});
  };

  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);

  return () => {
    window.removeEventListener('beforeunload', cleanup);
    window.removeEventListener('pagehide', cleanup);
  };
}

export async function runStaleCheck(): Promise<void> {
  clearLegacyBrowserState();
  await purgeStaleData(2);
}

export function clearAllData(currentSessionId: string): void {
  clearLegacyBrowserState();
  clearSessionVectors(currentSessionId).catch(() => {});
}
