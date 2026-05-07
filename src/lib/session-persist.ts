export function saveConversation(sessionId: string, messages: { role: string; content: string }[]): void {
  try {
    const data = JSON.stringify({ sid: sessionId, msgs: messages.slice(-50) });
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

export function clearConversation(): void {
  try { localStorage.removeItem('tw_conv'); } catch {}
}
