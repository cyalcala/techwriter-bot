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

const GEN_ARTIFACT_TRIGGER = /(generate|create|make|build|draw|write|design|craft|show|visualize|render|display|give me|i need|i want)\b.*?\b(diagram|chart|graph|drawing|visualization|plot|flowchart|mind\s?map|org\s?chart|architecture|uml|equation|formula|component|app|wireframe|code|mermaid|graphviz|d2|plantuml|katex|vega|markmap|webcontainer|sequence|class\s?diagram|er\s?diagram|pie\s?chart|bar\s?chart|gantt|svg|html|css|website|page|infographic|visual\s?summary)/i;
const QUICK_ARTIFACT_HINT = /^(diagram|chart|graph|uml|mermaid|graphviz|d2|plantuml|flowchart|mindmap|markmap|sequence|gantt|pie|bar|org|infographic)\b/i;
const FORMAT_CHOICE = /^[123]$|^(mermaid|graphviz|d2|plantuml|flowchart|markmap|vega|katex|code|react|webcontainer)$/i;
const LAST_AI_SUGGESTED = /\b(Mermaid|Graphviz|D2|PlantUML|Flowchart|Markmap|Vega|KaTeX)\b.*\bbest for\b/i;
const CODE_EXPLICIT_REQUEST = /\b(write|show|give me|need|want|create|generate|build)\s+(a|the|some|me\s+)?\s*(python|javascript|typescript|js|ts|code|script|function|class|program|app|component)\b/i;

export function isArtifactGenerationRequest(query: string, messages?: any[]): boolean {
  if (CODE_EXPLICIT_REQUEST.test(query)) return false;
  if (GEN_ARTIFACT_TRIGGER.test(query)) return true;

  const trimmed = query.trim();
  if (FORMAT_CHOICE.test(trimmed) && messages) {
    const lastAI = [...messages].reverse().find((m: any) => m.role === 'assistant');
    if (lastAI && LAST_AI_SUGGESTED.test(lastAI.content || '')) return true;
  }

  if (trimmed.length < 60 && QUICK_ARTIFACT_HINT.test(trimmed)) return true;
  if (/\b(draw|visualize|graph)\b/i.test(trimmed) && trimmed.length < 100) return true;
  return false;
}
