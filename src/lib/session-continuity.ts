export interface LiveOutageState {
  hasPriorResponse: boolean;
  retryAfterSeconds: number;
}

export interface SessionOutputMarker {
  liveResponse?: boolean;
  content?: string;
  empty?: boolean;
  hasArtifact?: boolean;
}

const DEFAULT_RETRY_AFTER_SECONDS = 10;
const MAX_RETRY_AFTER_SECONDS = 60;

export function createLiveOutageState(
  payload: unknown,
  hasPriorResponse: boolean,
): LiveOutageState | null {
  if (!payload || typeof payload !== 'object') return null;

  const response = payload as Record<string, unknown>;
  if (response.code !== 'AI_PROVIDERS_UNAVAILABLE') return null;

  const parsedRetryAfter = Number(response.retryAfter);
  const retryAfterSeconds = Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
    ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.round(parsedRetryAfter))
    : DEFAULT_RETRY_AFTER_SECONDS;

  return { hasPriorResponse, retryAfterSeconds };
}

export function hasVisibleLiveResponse(outputs: SessionOutputMarker[]): boolean {
  return outputs.some((output) => (
    output.liveResponse === true
    && output.empty !== true
    && (Boolean(output.content?.trim()) || output.hasArtifact === true)
  ));
}
