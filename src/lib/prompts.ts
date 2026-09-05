import { classifyQuery, formatConversationalResponse } from './relevance';
import { enforceBudget } from './token-counter';
import { toDiagramChoicePayload, type DiagramPlan } from './path-router';

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
  youtubeContext?: string;
  searchResult?: SearchResult;
  needsArtifact: boolean;
  needsDeck?: boolean;
  needsDoc?: boolean;
  needsChart?: boolean;
  needsArchify?: boolean;
  /**
   * Visual explanation is separate from `needsArtifact`: an automatically
   * selected diagram should not force a research question onto the fast path.
   */
  needsVisualExplanation?: boolean;
  diagramPlan?: DiagramPlan;
  clientSystemPrompt?: string;
}

const ARTIFACT_COMPACT = [
  'CRITICAL ARTIFACT RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. When a diagram or visual would help, return a concise, readable explanation AND exactly ONE artifact inside <artifact type="X" title="Title">...</artifact> tags. The artifact may follow the explanation; do not force artifact-only output.',
  '2. Keep the explanation outside the artifact: use a short heading and paragraphs or bullets, not a dense Markdown table unless the user explicitly asks for a table. Do not put commentary, Markdown fences, or prose inside the artifact tags.',
  '3. Use Mermaid (type="mermaid") as the default for diagrams unless another format is specifically requested. Choose the simplest format that best represents the concept and follow any SERVER DIAGRAM PLAN supplied below.',
  '4. Generate ONE detailed, substantive diagram. Do not ask the user to choose a format when the request is clear; when a SERVER DIAGRAM PLAN says choices, emit the requested <diagram-options> block instead and wait for the selection.',
  '5. Make diagrams SUBSTANTIVE: use descriptive labels, include all key steps/components, add notes on edges where helpful, and keep labels short enough to render cleanly on mobile.',
  '6. NEVER generate text-based diagrams or ASCII art when a visual diagram is requested. Use a formal diagramming language inside an <artifact> tag.',
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

const DIAGRAM_AUTO_COMPACT = [
  'CRITICAL VISUAL EXPLANATION RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Answer the user normally first: use a clear heading plus concise paragraphs or bullets. Then include exactly ONE diagram artifact. Never return artifact-only output for this visual explanation path.',
  '2. The SERVER DIAGRAM PLAN names the best initial view. Use it unless the user explicitly requests another view. Keep the diagram self-contained, substantive, and readable on mobile.',
  '3. Default artifact format is <artifact type="mermaid" title="..."> with raw Mermaid only inside the tag. No Markdown fences, no commentary, and no external URLs inside the tag.',
  '4. View syntax: architecture/workflow/dataflow use graph LR or flowchart TD; sequence uses sequenceDiagram; lifecycle uses stateDiagram-v2. Do not mix syntaxes.',
  '5. Ground the explanation and diagram in the user question and supplied context. Do not invent specific facts, people, dates, or metrics when the topic is uncertain; label conceptual relationships as examples.',
  '6. Do not use dense Markdown tables for the explanation unless the user requests one. Prefer stable headings, short paragraphs, and bullets so the response remains presentable when rendered.',
].join('\n');

const DIAGRAM_CHOICES_COMPACT = [
  'CRITICAL VISUAL CHOICE RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Answer the user normally with a concise explanation, then emit exactly ONE <diagram-options>JSON</diagram-options> block. Do not emit a diagram artifact until the user chooses a view.',
  '2. The JSON must be valid, compact, and match the SERVER DIAGRAM OPTIONS payload exactly. Do not wrap it in Markdown fences and do not add fields. Preserve the recommended view as the first option.',
  '3. The five available views are architecture (parts/boundaries), workflow (steps/decisions), sequence (interactions over time), dataflow (information movement), and lifecycle (states/recovery).',
  '4. Keep the explanation readable: use a short heading and paragraphs or bullets, not a dense Markdown table. Explain why the recommended view is the best starting angle.',
  '5. After the user selects a view, return the normal explanation plus exactly one diagram artifact using that selected view.',
].join('\n');

const ARCHIFY_COMPACT = [
  'CRITICAL STATIC ARCHIFY RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Answer the user with a concise explanation, then output exactly ONE <artifact type="archify" title="Title">...</artifact>. Do not return artifact-only output when an explanation is useful.',
  '2. This request may use only a checked-in Techwriter Bot static diagram. The tag body must be a compact JSON object with no markdown fence, no URL, no path, no HTML, and no extra fields.',
  '3. Exact shape: {"schemaVersion":1,"diagramId":"<id>","diagramType":"<type>"}. An optional title is allowed.',
  '4. Choose only one matching pair: techwriter-architecture/architecture, artifact-workflow/workflow, chat-request-sequence/sequence, context-dataflow/dataflow, provider-circuit-lifecycle/lifecycle.',
  '5. Never invent a diagram ID and never use Archify for an unrelated request. These pages are static build output, not a runtime renderer.',
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

const CHART_COMPACT = [
  'CRITICAL CHART RULES — YOU MUST FOLLOW THESE EXACTLY:',
  '1. Output ONE <artifact type="vega" title="Chart Title">...</artifact> tag as your ENTIRE response. The tag MUST be FIRST. No commentary before, after, or inside the tag.',
  '2. The tag content is ONE valid Vega-Lite JSON spec. No markdown fences, no comments, no trailing commas.',
  '3. ALWAYS use Vega-Lite format (NOT full Vega). Include "$schema": "https://vega.github.io/schema/vega-lite/v5.json".',
  '4. Use "width": "container" for responsive sizing. Set "height": 300 unless the data needs more vertical space.',
  '5. Chart types to use:',
  'Bar chart: {"mark":"bar","encoding":{"x":{"field":"...","type":"nominal"},"y":{"field":"...","type":"quantitative"}}}',
  'Line chart: {"mark":"line","encoding":{"x":{"field":"...","type":"temporal"},"y":{"field":"...","type":"quantitative"}}}',
  'Pie/donut: {"mark":{"type":"arc","innerRadius":50},"encoding":{"theta":{"field":"...","type":"quantitative"},"color":{"field":"...","type":"nominal"}}}',
  'Scatter plot: {"mark":"point","encoding":{"x":{"field":"...","type":"quantitative"},"y":{"field":"...","type":"quantitative"}}}',
  'Area chart: {"mark":"area","encoding":{"x":{"field":"...","type":"temporal"},"y":{"field":"...","type":"quantitative"}}}',
  'Histogram: {"mark":"bar","encoding":{"x":{"bin":true,"field":"...","type":"quantitative"},"y":{"aggregate":"count","type":"quantitative"}}}',
  'Heatmap: {"mark":"rect","encoding":{"x":{"field":"...","type":"ordinal"},"y":{"field":"...","type":"ordinal"},"color":{"field":"...","type":"quantitative"}}}',
  '6. Embed data inline using "data":{"values":[...]}. Use realistic, specific data that matches the user\'s topic — never placeholder/random data.',
  '7. Add a title with "title":"Chart Title". Use descriptive axis labels via "axis":{"title":"Label"}.',
  '8. For multiple series, use "color":{"field":"series","type":"nominal"} encoding.',
  '9. Keep the spec simple and valid. The ENTIRE JSON must be complete and closed.',
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

  if (ctx.youtubeContext) {
    layers.push({ priority: 2, content: `YOUTUBE VIDEO TRANSCRIPT — the user shared a YouTube link. Use this transcript to answer their question. Cite specific timestamps when relevant.\n\n${ctx.youtubeContext}` });
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

  if (ctx.needsArtifact || ctx.needsVisualExplanation || (ctx.diagramPlan && ctx.diagramPlan.mode !== 'none')) {
    const contract = ctx.needsArchify
      ? ARCHIFY_COMPACT
      : ctx.needsChart
        ? CHART_COMPACT
        : ctx.needsDeck
          ? DECK_COMPACT
          : ctx.needsDoc
            ? DOC_COMPACT
            : ctx.diagramPlan?.mode === 'choices'
              ? DIAGRAM_CHOICES_COMPACT
              : ctx.diagramPlan?.mode === 'automatic' || ctx.needsVisualExplanation
                ? DIAGRAM_AUTO_COMPACT
                : ARTIFACT_COMPACT;
    layers.push({ priority: 4, content: contract });

    if (ctx.diagramPlan?.mode === 'automatic' && ctx.diagramPlan.recommended) {
      layers.push({
        priority: 4,
        content: `SERVER DIAGRAM PLAN:\n${JSON.stringify({
          mode: 'automatic',
          recommended: ctx.diagramPlan.recommended,
          confidence: ctx.diagramPlan.confidence,
          rationale: ctx.diagramPlan.rationale,
        })}`,
      });
    } else if (ctx.diagramPlan?.mode === 'choices') {
      const payload = toDiagramChoicePayload(ctx.diagramPlan);
      if (payload) layers.push({ priority: 4, content: `SERVER DIAGRAM OPTIONS:\n${JSON.stringify(payload)}` });
    }
  }

  return enforceBudget(layers, 2048);
}
