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
    layers.push({ priority: 4, content: ARTIFACT_COMPACT });
  }

  return enforceBudget(layers, 2048);
}
