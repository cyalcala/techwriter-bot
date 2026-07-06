import { classifyQuery, formatConversationalResponse } from './relevance';
import { enforceBudget } from './token-counter';

export interface SearchResult {
  contextParts: string[];
  sources: { title: string; url: string; provider?: string }[];
  searchTier: 'none' | 'basic' | 'enhanced';
  searchAttempted: boolean;
  searchUnavailable?: boolean;
  enhancedRemaining?: number;
}

export interface PromptContext {
  path: 'fast' | 'balanced' | 'heavy';
  graphContext?: string;
  documentContext?: string;
  searchResult?: SearchResult;
  needsArtifact: boolean;
  needsDeck?: boolean;
  needsDoc?: boolean;
  clientSystemPrompt?: string;
}

const ARTIFACT_COMPACT = [
  'CRITICAL ARTIFACT RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. When a diagram or visual would help the user, output it IMMEDIATELY inside <artifact type="X" title="Title">...</artifact> tags. The artifact tag MUST be the FIRST thing in your response. Do NOT explain what you will do before outputting the artifact. Do NOT ask which format to use.',
  '2. Choose the best format yourself. Do NOT ask the user to pick. Do NOT offer alternatives. Do NOT say "I will create a..." — just create it. Generate ONE detailed, substantive diagram.',
  '3. Use Mermaid (type="mermaid") as the default for all diagram requests unless another format is specifically requested. Choose the simplest format that best represents the concept.',
  '4. The artifact content must be raw diagram code only — no markdown fences, no ``` wrappers, no commentary inside the tags. Output ONLY the artifact tag as your entire response.',
  '5. Make diagrams SUBSTANTIVE: use descriptive labels, include all key steps/components, add notes on edges where helpful.',
  '6. NEVER generate text-based diagrams, ASCII art, or plain text bullet points when a visual diagram is requested. YOU MUST use a formal diagramming language inside an <artifact> tag.',
  '',
  'Mermaid flowcharts EXACT syntax:',
  'graph LR',
  '  A[Step One] -->|does this| B[Step Two]',
  '  B -->|leads to| C[Step Three]',
  '  C -->|results in| D[Final Step]',
  'Rules: Square brackets for nodes: A[Description]. Pipes for edge labels: -->|action| B. NEVER write -->|action|> B. Curly braces for decisions: A{Choice}. Use subgraph for grouping. If a styled subgraph title has spaces, write subgraph BPO_Process [BPO Process] and style BPO_Process. NO semicolons. NO "note" statements. NO "participant" keyword in flowcharts. Only graph/flowchart syntax.',
  '',
  'Mermaid sequence diagrams: Use "sequenceDiagram" keyword. participant A, A->>B: message, Note right of A: text.',
  'Graphviz: digraph Name { rankdir=LR; node[shape=box]; A -> B[label="desc"]; }',
  'D2: 2-space indent. A -> B: "label". A.shape: rectangle.',
  '',
  'Infographic: output <artifact type="html"> with self-contained HTML+CSS. Rounded cards, emoji icons, grid layout. Pure HTML — no JS, no external resources.',
  'Code request: If user explicitly asks for code, output ONLY code inside <artifact type="code"> — no diagram.',
].join('\n');

// Deck contract mirrors src/lib/deck-schema.ts — keep layouts/fields in sync.
const DECK_COMPACT = [
  'CRITICAL PRESENTATION RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Output ONE <artifact type="deck" title="Deck Title">...</artifact> tag as your ENTIRE response. The artifact tag MUST be FIRST. No commentary before, after, or inside the tag.',
  '2. The tag content is ONE valid JSON object. No markdown fences, no comments, no trailing commas.',
  '3. Shape: {"title":"Deck Title","subtitle":"optional","slides":[{"layout":"<name>","data":{...}}]}',
  '4. EXACTLY 7 or 8 slides total. NEVER more than 8. First slide layout "title", last slide layout "closing".',
  '5. Layouts and their exact data fields:',
  'title: {"heading","subheading","kicker"} — kicker is a short 2-4 word eyebrow label.',
  'agenda: {"heading","items":["..."]} — 3-6 items.',
  'bullets: {"heading","bullets":["..."],"icon"} — 3-5 bullets, each 12 words max; icon is ONE emoji.',
  'two-column: {"heading","leftTitle","leftItems":["..."],"rightTitle","rightItems":["..."]} — 2-4 items per side.',
  'stat: {"heading","value","label","context"} — value is the big number/figure, e.g. "99.9%".',
  'quote: {"text","attribution"}',
  'code: {"heading","language","code"} — 12 short lines max.',
  'closing: {"heading","subheading","items"} — items optional, 2-3 takeaways.',
  '6. Icons: ONE emoji in "icon" fields only. NO image URLs, NO HTML, NO markdown inside strings.',
  '7. Write specific, concrete, presentation-grade content drawn from the user\'s topic — never filler headings like "Slide 2" or "Introduction" alone.',
  '8. BREVITY IS MANDATORY: keep every text value to a short phrase (not sentences) so the ENTIRE JSON object is complete and closed. A finished 7-slide deck is far better than a detailed one that gets cut off. Close every bracket and brace.',
].join('\n');

// Document contract mirrors src/lib/doc-schema.ts — keep block types in sync.
const DOC_COMPACT = [
  'CRITICAL DOCUMENT RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Output ONE <artifact type="document" title="Document Title">...</artifact> tag as your ENTIRE response. The tag MUST be FIRST. No commentary before, after, or inside the tag.',
  '2. The tag content is ONE valid JSON object. No markdown fences, no trailing commas.',
  '3. Shape: {"title":"Title","subtitle":"optional","blocks":[{"type":"<name>",...}]}',
  '4. Block types and their exact fields:',
  'heading: {"type":"heading","level":1|2|3,"text":"..."}',
  'paragraph: {"type":"paragraph","text":"..."}',
  'bullets: {"type":"bullets","items":["...","..."]}',
  'numbered: {"type":"numbered","items":["...","..."]}',
  'code: {"type":"code","language":"js","code":"..."}',
  'quote: {"type":"quote","text":"...","attribution":"optional"}',
  'table: {"type":"table","headers":["A","B"],"rows":[["1","2"],["3","4"]]}',
  '5. Structure the document with headings; write substantive, specific, well-organized prose grounded in the user\'s topic. Aim for 6-24 blocks.',
  '6. Plain text only inside string values — no markdown, no HTML, no images.',
  '7. The ENTIRE JSON object must be complete and closed — every bracket and brace. If space is tight, use fewer blocks rather than letting the JSON get cut off mid-object.',
].join('\n');

const CORE_PERSONA_FAST = `You are a helpful, concise technical writing assistant. Respond naturally and briefly.`;

const CORE_PERSONA_BALANCED = `You are an expert technical writing assistant. You write clear, accurate technical content. Be thorough but concise. Use the provided knowledge graph context to ground your answers in the actual codebase.`;

const CORE_PERSONA_HEAVY = `You are an expert technical writing and research assistant. You have access to live search results and codebase knowledge. Answer thoroughly with citations. Prioritize recent, accurate information from provided sources. Never mention training data or knowledge cutoffs.`;

function normalizeClientSystemPrompt(prompt?: string): string {
  return (prompt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

const DEFAULT_SUGGESTED_PROMPTS = [
  'Draft release notes for a recent change',
  'Review this documentation for clarity',
  'Create a diagram for a technical workflow',
];

const SUGGESTION_RULES: { terms: string[]; prompt: string }[] = [
  {
    terms: ['api', 'endpoint', 'reference'],
    prompt: 'Turn API details into a clear reference page',
  },
  {
    terms: ['onboarding', 'quickstart', 'setup'],
    prompt: 'Create a quickstart from these notes',
  },
  {
    terms: ['release', 'changelog', 'version'],
    prompt: 'Draft release notes in this voice',
  },
  {
    terms: ['diagram', 'architecture', 'workflow'],
    prompt: 'Create a diagram for this workflow',
  },
  {
    terms: ['troubleshoot', 'support', 'faq'],
    prompt: 'Write troubleshooting steps for users',
  },
  {
    terms: ['style', 'voice', 'tone', 'second person', 'hype'],
    prompt: 'Rewrite this draft in the client voice',
  },
  {
    terms: ['security', 'privacy', 'compliance'],
    prompt: 'Review this doc for security-safe wording',
  },
];

export function deriveSuggestedPrompts(systemPrompt?: string): string[] {
  const normalized = normalizeClientSystemPrompt(systemPrompt).toLowerCase();
  const suggestions: string[] = [];

  for (const rule of SUGGESTION_RULES) {
    if (rule.terms.some((term) => normalized.includes(term)) && !suggestions.includes(rule.prompt)) {
      suggestions.push(rule.prompt);
    }
  }

  for (const prompt of DEFAULT_SUGGESTED_PROMPTS) {
    if (!suggestions.includes(prompt)) suggestions.push(prompt);
  }

  return suggestions.slice(0, 3);
}

export function buildSystemPrompt(query: string, ctx: PromptContext): string {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const year = now.getFullYear();
  const dateLayer = `Today is ${dayName}, ${dateStr}. Current year is ${year}.`;

  const layers: { priority: number; content: string }[] = [];

  switch (ctx.path) {
    case 'fast':
      layers.push({ priority: 0, content: dateLayer });
      layers.push({ priority: 0, content: CORE_PERSONA_FAST });
      break;
    case 'balanced':
      layers.push({ priority: 0, content: dateLayer });
      layers.push({ priority: 0, content: CORE_PERSONA_BALANCED });
      break;
    case 'heavy':
      layers.push({ priority: 0, content: dateLayer });
      layers.push({ priority: 0, content: CORE_PERSONA_HEAVY });
      break;
  }

  const clientSystemPrompt = normalizeClientSystemPrompt(ctx.clientSystemPrompt);
  if (clientSystemPrompt) {
    layers.push({ priority: 0, content: `CLIENT SYSTEM PROMPT:\n${clientSystemPrompt}` });
  }

  if (ctx.graphContext) {
    layers.push({ priority: 1, content: ctx.graphContext });
  }

  if (ctx.documentContext) {
    layers.push({ priority: 2, content: ctx.documentContext });
  }

  if (ctx.path === 'heavy' && ctx.searchResult) {
    const searchResult = ctx.searchResult;

    if (searchResult.searchTier === 'none' && !ctx.graphContext) {
      layers.push({
        priority: 1,
        content: 'Search returned no results for this query. Be honest: say you don\'t have current info yet. Only offer what you confidently know.',
      });
    } else if (searchResult.searchUnavailable) {
      layers.push({
        priority: 1,
        content: 'Live search is temporarily unavailable. Continue without live results, be explicit that current external sources could not be checked, and answer only from reliable non-search context.',
      });
    } else if (searchResult.contextParts.length === 0 && searchResult.searchAttempted) {
      layers.push({
        priority: 1,
        content: 'IMPORTANT: Search returned no results. Be honest about what you can and cannot answer.',
      });
    } else if (searchResult.contextParts.length > 0) {
      const isEnhanced = searchResult.searchTier === 'enhanced';
      const searchLayer = isEnhanced
        ? `ENHANCED LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nAnswer using these live sources. Cite every fact with [1]-[${searchResult.sources.length}]. NEVER mention training data.`
        : `BASIC LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nAnswer using these live sources. Cite every fact with [1]-[${searchResult.sources.length}]. NEVER mention training data.`;
      layers.push({ priority: 3, content: searchLayer });
    }
  }

  if (ctx.needsArtifact) {
    // Each artifact family gets ONLY its own contract — token-lean all ways
    const contract = ctx.needsDeck ? DECK_COMPACT : ctx.needsDoc ? DOC_COMPACT : ARTIFACT_COMPACT;
    layers.push({ priority: 4, content: contract });
  }

  return enforceBudget(layers, 2048);
}
