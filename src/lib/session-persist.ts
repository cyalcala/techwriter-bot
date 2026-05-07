export function saveConversation(sessionId: string, messages: { role: string; content: string }[]): void {
  try {
    const existing = loadRaw();
    const data = JSON.stringify({ ...existing, sid: sessionId, msgs: messages.slice(-50) });
    localStorage.setItem('tw_conv', data);
  } catch {}
}

export function loadConversation(sessionId: string): { role: string; content: string }[] | null {
  try {
    const raw = localStorage.getItem('tw_conv');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.sid !== sessionId) return null;
    return data.msgs?.length ? data.msgs : null;
  } catch { return null; }
}

export function saveArtifactQueue(sessionId: string, queue: any[]): void {
  try {
    const existing = loadRaw();
    const data = JSON.stringify({ ...existing, sid: sessionId, artifacts: queue.slice(-30) });
    localStorage.setItem('tw_conv', data);
  } catch {}
}

export function loadArtifactQueue(sessionId: string): any[] | null {
  try {
    const raw = localStorage.getItem('tw_conv');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.sid !== sessionId) return null;
    return data.artifacts?.length ? data.artifacts : null;
  } catch { return null; }
}

export function clearConversation(): void {
  try { localStorage.removeItem('tw_conv'); } catch {}
}

function loadRaw(): any {
  try {
    const raw = localStorage.getItem('tw_conv');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
