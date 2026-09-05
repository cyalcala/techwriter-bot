import { shouldSkipSearch } from './relevance';

export type ChatPath = 'fast' | 'balanced' | 'heavy' | 'agent';

const RECENCY_KEYWORDS = /\b(latest|current|today|now|news|price of|stock|weather|score|recent|just happened|announced|who won|what happened|this year|this month)\b/i;
const YEAR_REFERENCE = /\b20(?:25|26)\b/;
const URL_PATTERN = /https?:\/\//i;
const MULTISTEP_PATTERN = /\b(then|after that|search for|find out).*?\b(and|then|make|create|draw|tell me)\b/i;

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

/**
 * The five explanatory views we can produce for a conceptual question.
 *
 * These names are deliberately format-neutral. The model may render the view
 * as Mermaid (the default) or the caller may map the selected view to one of
 * the checked-in Archify pages when the request is in that repository's scope.
 */
export type DiagramType = 'architecture' | 'workflow' | 'sequence' | 'dataflow' | 'lifecycle';

export interface DiagramOption {
  type: DiagramType;
  label: string;
  description: string;
}

export const DIAGRAM_OPTIONS: DiagramOption[] = [
  {
    type: 'architecture',
    label: 'Architecture',
    description: 'Parts, boundaries, layers, and relationships',
  },
  {
    type: 'workflow',
    label: 'Workflow',
    description: 'Steps, decisions, and the path from start to finish',
  },
  {
    type: 'sequence',
    label: 'Sequence',
    description: 'Interactions and messages in time order',
  },
  {
    type: 'dataflow',
    label: 'Dataflow',
    description: 'Where information comes from and how it moves',
  },
  {
    type: 'lifecycle',
    label: 'Lifecycle',
    description: 'States, transitions, retries, and recovery',
  },
];

export type DiagramPlanMode = 'none' | 'automatic' | 'choices';

/**
 * Server-side intent result shared by routing, prompt construction, and UI.
 * `recommended` is always first in `options`; choices can still show every
 * view so the user can choose a richer angle without knowing diagram jargon.
 */
export interface DiagramPlan {
  mode: DiagramPlanMode;
  recommended?: DiagramType;
  confidence: number;
  options: DiagramOption[];
  rationale: string;
  explicit: boolean;
  archifyEligible: boolean;
}

/** Stable payload shape for an optional diagram picker in the chat UI. */
export interface DiagramChoicePayload {
  schemaVersion: 1;
  kind: 'diagram-options';
  recommended: DiagramType;
  confidence: number;
  options: DiagramOption[];
  prompt: string;
}

const sessionPaths = new Map<string, ChatPath>();

export function determineChatPath(
  query: string,
  msgLen: number,
  intent: string,
  sessionId: string,
): PathContext {
  const lastPath = sessionPaths.get(sessionId);

  if (intent === 'agent' || MULTISTEP_PATTERN.test(query)) {
    sessionPaths.set(sessionId, 'agent');
    return { path: 'agent', skipSearch: true, includeGraph: true, includeRAG: true, reason: 'multi_step_agent' };
  }

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
  
  if (lastPath === 'agent') {
    sessionPaths.set(sessionId, 'agent');
    return { path: 'agent', skipSearch: true, includeGraph: true, includeRAG: true, reason: 'session_affinity_agent' };
  }

  sessionPaths.set(sessionId, 'balanced');
  return { path: 'balanced', skipSearch: true, includeGraph: true, includeRAG: true, reason: 'default_balanced' };
}

const GEN_ARTIFACT_TRIGGER = /(do|draft|outline|map|plot|can you|could you|please|generate|create|make|build|draw|write|design|craft|show|visualize|render|display|give me|i need|i want)\b.*?\b(diagram|chart|graph|drawing|visualization|plot|flowchart|mind\s?map|org\s?chart|architecture|uml|equation|formula|component|app|wireframe|code|mermaid|graphviz|d2|plantuml|katex|vega|markmap|sequence|class\s?diagram|er\s?diagram|pie\s?chart|bar\s?chart|gantt|svg|html|css|website|page|infographic|visual\s?summary|presentation|slide\s?deck|pitch\s?deck|slides|deck|document|report|one[-\s]?pager|memo|brief|white\s?paper|whitepaper|ishikawa|fishbone|dbml|structurizr|actdiag|blockdiag|bpmn|bytefield|c4plantuml|ditaa|erd|excalidraw|nomnoml|nwdiag|packetdiag|rackdiag|seqdiag|svgbob|symbolator|tikztosvg|umlet|vegalite|wavedrom|wireviz)/i;
const QUICK_ARTIFACT_HINT = /^(do|draw|create|make|show|diagram|chart|graph|uml|mermaid|graphviz|d2|plantuml|flowchart|mindmap|markmap|sequence|gantt|pie|bar|org|infographic|presentation|slides|deck|document|report|memo|ishikawa|fishbone|dbml|structurizr|actdiag|blockdiag|bpmn|bytefield|c4plantuml|ditaa|erd|excalidraw|nomnoml|nwdiag|packetdiag|rackdiag|seqdiag|svgbob|symbolator|tikztosvg|umlet|vegalite|wavedrom|wireviz)\b/i;
const DECK_REQUEST_RE = /\b(presentation|slide\s?deck|pitch\s?deck|slides|deck)\b/i;
const DOC_REQUEST_RE = /\b(document|report|one[-\s]?pager|memo|brief|white\s?paper|whitepaper|write[-\s]?up)\b/i;

// Deck/doc requests get a higher output-token budget than diagram requests
// (their JSON is larger); only meaningful when the artifact trigger fired.
export function isDeckGenerationRequest(query: string): boolean {
  return DECK_REQUEST_RE.test(query);
}

// Document requests, excluding deck requests (deck takes precedence).
export function isDocGenerationRequest(query: string): boolean {
  return DOC_REQUEST_RE.test(query) && !DECK_REQUEST_RE.test(query);
}

const CHART_REQUEST_RE = /\b(chart|pie\s?chart|bar\s?chart|line\s?chart|scatter\s?plot|histogram|heatmap|area\s?chart|time\s?series|data\s?viz|data\s?visualization|vega|vega-?lite|plot\s+(?:the|my|this|a)|graph\s+(?:the|my|this|a)\s+data|visualize\s+(?:the|my|this|a)\s+data)\b/i;

export function isChartGenerationRequest(query: string): boolean {
  return CHART_REQUEST_RE.test(query) && !DECK_REQUEST_RE.test(query);
}

// Archify is intentionally not a general runtime diagram engine. It is only
// useful when the request is explicitly about this checked-in application map.
// Other named diagram engines keep their established routing behavior.
const ARCHIFY_TARGET_SCOPE_RE = /\b(?:techwriter[-\s]?bot|this\s+(?:app|codebase|repository))\b/i;
const ARCHIFY_TOPIC_RE = /\b(?:archify|architecture|artifact\s+workflow|chat\s+(?:request|sequence)|context\s+(?:flow|dataflow)|provider\s+(?:circuit|lifecycle)|lifecycle)\b/i;
const EXPLICIT_OTHER_DIAGRAM_ENGINE_RE = /\b(?:mermaid|graphviz|dot|d2|plantuml|puml|bpmn|archimate|vega(?:-lite)?|flowchart|katex|markmap)\b/i;

const EXPLICIT_VISUAL_RE = /\b(?:diagram|flowchart|visual(?:ization|ise|ize)?|graph|map|draw|plot|illustrate|render|architecture|workflow|sequence|dataflow|data\s+flow|lifecycle|relationship\s+map|concept\s+map)\b/i;
const CONCEPTUAL_EXPLANATION_RE = /\b(?:discuss|explain|overview|summari[sz]e|break\s+down|how\s+(?:does|do|is|are)|why\s+(?:does|do|is|are)|compare|contrast|relationship|causes?|effects?|timeline|structure|framework|model|analy[sz]e)\b/i;
const CHOICE_REQUEST_RE = /\b(?:options?|choices?|which\s+(?:kind|type|view|format)|pick|choose|perspective|angle|ways?\s+to\s+(?:show|view|map)|architecture\s+or\s+workflow|workflow\s+or\s+sequence)\b/i;
const NON_DIAGRAM_ARTIFACT_RE = /\b(?:code|script|function|class|program|component|website|web\s+page|presentation|slide\s+deck|slides?|deck|document|report|memo|brief|white\s+paper|chart|table|spreadsheet|image|photo)\b/i;
const MULTI_VIEW_RE = /\b(?:and|or|versus|vs\.?|rather\s+than|instead\s+of)\b/i;

type DiagramSignal = { type: DiagramType; pattern: RegExp; weight: number };

// Keep these patterns explicit and explainable. A model can still make the
// final diagram rich; the router only decides which visual lens is most useful.
const DIAGRAM_SIGNALS: DiagramSignal[] = [
  { type: 'architecture', pattern: /\b(?:architecture|architectural|system\s+design|component|module|service|boundary|boundaries|layer|stack|deployment|topology|hierarch(?:y|ies)|organizational|dynast(?:y|ies)|family\s+tree|structure)\b/i, weight: 3 },
  { type: 'workflow', pattern: /\b(?:workflow|work\s+flow|process|steps?|pipeline|procedure|stages?|onboarding|journey|decision|how\s+.+\s+works?)\b/i, weight: 3 },
  { type: 'sequence', pattern: /\b(?:sequence|request[-\s]?response|call\s+flow|interaction|messages?\s+between|conversation|actor|time\s+order|chronolog(?:y|ical))\b/i, weight: 3 },
  { type: 'dataflow', pattern: /\b(?:data\s*flow|dataflow|context|lineage|provenance|source(?:s)?|inputs?\s+and\s+outputs?|moves?\s+from|flows?\s+from|retrieval|rag|dependencies?|causes?|effects?|influences?)\b/i, weight: 3 },
  { type: 'lifecycle', pattern: /\b(?:lifecycle|life\s+cycle|state(?:s)?|transition|retry|retries|recovery|circuit|rollout|phase(?:s)?|status|created|updated|deleted|open|closed|half[-\s]?open)\b/i, weight: 3 },
];

function copyDiagramOptions(recommended?: DiagramType, rankedTypes: DiagramType[] = []): DiagramOption[] {
  const order = [
    ...(recommended ? [recommended] : []),
    ...rankedTypes,
    ...DIAGRAM_OPTIONS.map((option) => option.type),
  ];
  const seen = new Set<DiagramType>();
  return order
    .filter((type): type is DiagramType => DIAGRAM_OPTIONS.some((option) => option.type === type))
    .filter((type) => {
      if (seen.has(type)) return false;
      seen.add(type);
      return true;
    })
    .map((type) => {
      const option = DIAGRAM_OPTIONS.find((candidate) => candidate.type === type)!;
      return { ...option };
    });
}

function diagramScores(query: string): Map<DiagramType, number> {
  const scores = new Map<DiagramType, number>(DIAGRAM_OPTIONS.map(({ type }) => [type, 0]));
  for (const signal of DIAGRAM_SIGNALS) {
    if (signal.pattern.test(query)) scores.set(signal.type, (scores.get(signal.type) || 0) + signal.weight);
  }

  // A question that describes an app/codebase without naming a view is most
  // naturally answered with its structure. This also makes “discuss this
  // repository” useful without requiring Archify terminology.
  if (/\b(?:app|codebase|repository|system|platform|product|organization|family)\b/i.test(query)) {
    scores.set('architecture', (scores.get('architecture') || 0) + 2);
  }
  if (/\b(?:before|after|then|finally|first|next)\b/i.test(query)) {
    scores.set('workflow', (scores.get('workflow') || 0) + 1);
    scores.set('sequence', (scores.get('sequence') || 0) + 1);
  }
  return scores;
}

function rankedDiagramTypes(scores: Map<DiagramType, number>): DiagramType[] {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0)
    .map(([type]) => type);
}

function hasConflictingViews(query: string, rankedTypes: DiagramType[]): boolean {
  if (rankedTypes.length < 2) return false;
  const scores = diagramScores(query);
  const top = scores.get(rankedTypes[0]) || 0;
  const second = scores.get(rankedTypes[1]) || 0;
  return (CHOICE_REQUEST_RE.test(query) || (EXPLICIT_VISUAL_RE.test(query) && MULTI_VIEW_RE.test(query)))
    && top > 0
    && second > 0
    && top - second <= 3;
}

function isDiagramType(value: unknown): value is DiagramType {
  return typeof value === 'string' && DIAGRAM_OPTIONS.some((option) => option.type === value);
}

function readLastDiagramChoicePayload(messages?: any[]): DiagramChoicePayload | null {
  if (!Array.isArray(messages)) return null;
  const lastAssistant = [...messages]
    .reverse()
    .find((message: any) => message?.role === 'assistant' && typeof message.content === 'string');
  if (!lastAssistant) return null;

  const match = lastAssistant.content.match(/<diagram-options\s*>\s*([\s\S]*?)\s*<\/diagram-options\s*>/i);
  if (!match) return null;

  try {
    const payload = JSON.parse(match[1]) as Partial<DiagramChoicePayload>;
    if (payload.schemaVersion !== 1 || payload.kind !== 'diagram-options' || !isDiagramType(payload.recommended)) return null;
    if (!Array.isArray(payload.options) || payload.options.length === 0) return null;
    const options = payload.options.filter((option: any) => isDiagramType(option?.type)
      && typeof option?.label === 'string'
      && typeof option?.description === 'string') as DiagramOption[];
    if (options.length !== payload.options.length) return null;
    return {
      schemaVersion: 1,
      kind: 'diagram-options',
      recommended: payload.recommended,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0,
      options: options.map((option) => ({ ...option })),
      prompt: typeof payload.prompt === 'string' ? payload.prompt : 'Choose a visual angle, or use the recommended view.',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a follow-up choice only when the preceding assistant message
 * contains our validated option payload. This prevents a bare “1” in a
 * normal conversation from becoming an artifact request.
 */
export function resolveDiagramChoice(query: string, messages?: any[]): DiagramType | null {
  const value = query.trim().toLowerCase().replace(/[.!?]+$/, '');
  const payload = readLastDiagramChoicePayload(messages);
  if (!payload) return null;

  if (isDiagramType(value)) return value;
  if (!/^[1-5]$/.test(value)) return null;

  const option = payload.options[Number(value) - 1];
  return option?.type || null;
}

/**
 * Infer the least-surprising diagram experience for a user request.
 *
 * - `automatic`: a clear view is selected and the answer should include one
 *   diagram plus readable explanation.
 * - `choices`: the request would benefit from a visual but the angle is
 *   underspecified; show a recommended view first and let the user choose.
 * - `none`: retain ordinary prose or the existing explicit artifact route.
 */
export function inferDiagramPlan(query: string, messages?: any[]): DiagramPlan {
  const normalized = query.trim();
  const emptyPlan: DiagramPlan = {
    mode: 'none',
    confidence: 0,
    options: [],
    rationale: 'No diagram intent detected.',
    explicit: false,
    archifyEligible: false,
  };
  if (!normalized) return emptyPlan;

  const selected = resolveDiagramChoice(normalized, messages);
  if (selected) {
    return {
      mode: 'automatic',
      recommended: selected,
      confidence: 0.99,
      options: copyDiagramOptions(selected),
      rationale: `The user selected the ${selected} view.`,
      explicit: true,
      archifyEligible: false,
    };
  }

  // A request for a different artifact should not accidentally become a
  // diagram. “Chart” and “table” are deliberately left to their own routes.
  if (NON_DIAGRAM_ARTIFACT_RE.test(normalized) && !EXPLICIT_VISUAL_RE.test(normalized)) return emptyPlan;

  const explicit = EXPLICIT_VISUAL_RE.test(normalized);
  const conceptual = CONCEPTUAL_EXPLANATION_RE.test(normalized);
  const scores = diagramScores(normalized);
  const ranked = rankedDiagramTypes(scores);
  const recommended = ranked[0] || (explicit ? 'architecture' : undefined);
  const topScore = recommended ? (scores.get(recommended) || 0) : 0;
  const secondScore = ranked[1] ? (scores.get(ranked[1]) || 0) : 0;
  const conflicting = hasConflictingViews(normalized, ranked);
  const archifyEligible = isArchifyGenerationRequest(normalized);

  if (!explicit && !conceptual) return emptyPlan;

  // A broad conceptual question with a strong structural cue is worth
  // visualizing automatically. This is the path that makes e.g. “discuss
  // political dynasties” receive a polished explanation plus relationship map.
  if (recommended && topScore >= 3 && !conflicting) {
    const confidence = Math.min(0.99, 0.72 + topScore * 0.045 + Math.max(0, topScore - secondScore) * 0.025);
    return {
      mode: 'automatic',
      recommended,
      confidence: Number(confidence.toFixed(2)),
      options: copyDiagramOptions(recommended, ranked),
      rationale: `The request strongly matches the ${recommended} view.`,
      explicit,
      archifyEligible,
    };
  }

  // Explicitly asking for a diagram without saying which angle should expose
  // optionality instead of making the user learn five trigger phrases.
  if (explicit || conceptual) {
    const fallback = recommended || 'architecture';
    return {
      mode: 'choices',
      recommended: fallback,
      confidence: Number(Math.min(0.7, 0.45 + topScore * 0.04).toFixed(2)),
      options: copyDiagramOptions(fallback, ranked),
      rationale: topScore > 0
        ? `Several views could fit; ${fallback} is the recommended starting angle.`
        : 'A visual could help, but the best angle is not yet clear.',
      explicit,
      archifyEligible,
    };
  }

  return emptyPlan;
}

export function isAutomaticDiagramGenerationRequest(query: string, messages?: any[]): boolean {
  return inferDiagramPlan(query, messages).mode === 'automatic';
}

export function shouldOfferDiagramChoices(query: string, messages?: any[]): boolean {
  return inferDiagramPlan(query, messages).mode === 'choices';
}

export function isDiagramGenerationRequest(query: string, messages?: any[]): boolean {
  const mode = inferDiagramPlan(query, messages).mode;
  return mode === 'automatic' || mode === 'choices';
}

export function toDiagramChoicePayload(plan: DiagramPlan): DiagramChoicePayload | null {
  if (!plan.recommended || plan.mode === 'none') return null;
  return {
    schemaVersion: 1,
    kind: 'diagram-options',
    recommended: plan.recommended,
    confidence: plan.confidence,
    options: plan.options.map((option) => ({ ...option })),
    prompt: 'Choose a visual angle, or use the recommended view.',
  };
}

export function isArchifyGenerationRequest(query: string): boolean {
  return ARCHIFY_TARGET_SCOPE_RE.test(query)
    && ARCHIFY_TOPIC_RE.test(query)
    && !EXPLICIT_OTHER_DIAGRAM_ENGINE_RE.test(query);
}
const FORMAT_CHOICE = /^[123]$|^(mermaid|graphviz|d2|plantuml|flowchart|markmap|vega|katex|code|react)$/i;
const LAST_AI_SUGGESTED = /\b(Mermaid|Graphviz|D2|PlantUML|Flowchart|Markmap|Vega|KaTeX)\b.*\bbest for\b/i;
const CODE_EXPLICIT_REQUEST = /\b(write|show|give me|need|want|create|generate|build)\s+(a|the|some|me\s+)?\s*(python|javascript|typescript|js|ts|code|script|function|class|program|app|component)\b/i;

export function isArtifactGenerationRequest(query: string, messages?: any[]): boolean {
  if (CODE_EXPLICIT_REQUEST.test(query)) return false;
  if (GEN_ARTIFACT_TRIGGER.test(query)) return true;

  const trimmed = query.trim();
  if (resolveDiagramChoice(trimmed, messages)) return true;
  if (FORMAT_CHOICE.test(trimmed) && messages) {
    const lastAI = [...messages].reverse().find((m: any) => m.role === 'assistant');
    if (lastAI && LAST_AI_SUGGESTED.test(lastAI.content || '')) return true;
  }

  if (trimmed.length < 60 && QUICK_ARTIFACT_HINT.test(trimmed)) return true;
  if (/\b(draw|visualize|graph)\b/i.test(trimmed) && trimmed.length < 100) return true;
  return false;
}
