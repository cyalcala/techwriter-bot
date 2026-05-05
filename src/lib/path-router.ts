import { shouldSkipSearch } from './relevance';

export type ChatPath = 'fast' | 'balanced' | 'heavy';

const RECENCY_KEYWORDS = /\b(latest|current|today|now|news|price of|stock|weather|score|recent|just happened|announced|who won|what happened|this year|this month)\b/i;
const YEAR_REFERENCE = /\b20(?:25|26)\b/;
const URL_PATTERN = /https?:\/\//i;

export function hasRecencyKeyword(query: string): boolean {
  return RECENCY_KEYWORDS.test(query) || YEAR_REFERENCE.test(query) || URL_PATTERN.test(query);
}

export interface PathContext {
  path: ChatPath;
  skipSearch: boolean;
  includeGraph: boolean;
  includeRAG: boolean;
  reason: string;
}

const sessionPaths = new Map<string, ChatPath>();

export function determineChatPath(
  query: string,
  msgLen: number,
  intent: string,
  sessionId: string,
): PathContext {
  const lastPath = sessionPaths.get(sessionId);

  if (hasRecencyKeyword(query)) {
    sessionPaths.set(sessionId, 'heavy');
    return { path: 'heavy', skipSearch: false, includeGraph: true, includeRAG: true, reason: 'recency_keyword' };
  }

  if (msgLen > 1500 || intent === 'research' || intent === 'deep-reason') {
    sessionPaths.set(sessionId, 'heavy');
    return { path: 'heavy', skipSearch: false, includeGraph: true, includeRAG: true, reason: 'long_or_research' };
  }

  if (shouldSkipSearch(query)) {
    sessionPaths.set(sessionId, 'fast');
    return { path: 'fast', skipSearch: true, includeGraph: false, includeRAG: true, reason: 'greeting_or_conversational' };
  }

  if (lastPath === 'heavy') {
    sessionPaths.set(sessionId, 'heavy');
    return { path: 'heavy', skipSearch: false, includeGraph: true, includeRAG: true, reason: 'session_affinity_heavy' };
  }

  sessionPaths.set(sessionId, 'balanced');
  return { path: 'balanced', skipSearch: true, includeGraph: true, includeRAG: true, reason: 'default_balanced' };
}

const GEN_ARTIFACT_TRIGGER = /(generate|create|make|build|draw|write|design|craft)\s+(a|an|the|me)\s+(diagram|chart|graph|drawing|visualization|plot|flowchart|mind\s?map|org\s?chart|architecture|uml|equation|formula|component|app|wireframe|code)/i;

export function isArtifactGenerationRequest(query: string): boolean {
  return GEN_ARTIFACT_TRIGGER.test(query);
}
