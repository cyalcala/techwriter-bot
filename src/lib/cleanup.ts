import { clearSessionVectors, purgeStaleData } from './rag-db';

export function setupCleanupCallbacks(sessionId: string) {
  const cleanup = () => {
    sessionStorage.clear();
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
  await purgeStaleData(2);
}

export function clearAllData(currentSessionId: string): void {
  sessionStorage.clear();
  clearSessionVectors(currentSessionId).catch(() => {});
  localStorage.removeItem('tw_session_id');
}

export function persistSessionId(id: string): void {
  try { localStorage.setItem('tw_session_id', id); } catch {}
}

export function getStoredSessionId(): string | null {
  try { return localStorage.getItem('tw_session_id'); } catch { return null; }
}