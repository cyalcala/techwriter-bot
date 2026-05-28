const LEGACY_CONVERSATION_KEY = 'tw_conv';

export function clearConversation(): void {
  try {
    localStorage.removeItem(LEGACY_CONVERSATION_KEY);
  } catch {}
}
