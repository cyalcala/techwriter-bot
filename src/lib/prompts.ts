import { classifyQuery, formatConversationalResponse } from './relevance';
import { enforceBudget } from './token-counter';

export interface SearchResult {
  contextParts: string[];
  sources: { title: string; url: string; provider?: string }[];
  searchTier: 'none' | 'basic' | 'enhanced';
  searchAttempted: boolean;
  enhancedRemaining?: number;
}

export interface PromptContext {
  path: 'fast' | 'balanced' | 'heavy';
  graphContext?: string;
  documentContext?: string;
  searchResult?: SearchResult;
  needsArtifact: boolean;
}

const ARTIFACT_COMPACT = [
  'When a diagram would help the user, generate it immediately inside <artifact type="X" title="Title">...</artifact>.',
  'Choose the best format yourself. Do NOT ask the user to pick first. Do NOT offer alternatives unless the user asks.',
  'Output ONLY the artifact — no markdown fences, no ```mermaid wrappers inside the tags. Just the raw diagram code.',
  '',
  'Mermaid syntax rules:',
  '- Start with graph LR/TD, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, pie, flowchart, or gitgraph',
  '- Arrow labels: use clean text like -->|Label| or -->|"Label with spaces"|',
  '- NEVER use /> or /> or /&gt; in labels — these break the parser',
  '- Use quotes around labels that contain special characters: A["My Label"]',
  '- Spaces around arrows: A -->|text| B (NOT A-->|text|B)',
  '- Keep node IDs short: A, B, C (not longDescriptiveNames)',
  '- Escape & as &amp; in all text',
  '',
  'Graphviz syntax rules:',
  '- Start with digraph Name { or graph Name {',
  '- Use node[shape=box,style=rounded] for styling',
  '- Use rankdir=TB for vertical, rankdir=LR for horizontal',
  '- Keep labels short and inside quotes: A[label="Request"]',
  '- Use -> for directed edges, -- for undirected',
  '',
  'D2 syntax rules:',
  '- Use 2-space indentation for nesting',
  '- Labels: A: "My Label"',
  '- Connections: A -> B or A -> B: "edge label"',
  '- Shapes: A.shape: rectangle, B.shape: diamond',
  '',
  'Infographics and visual summaries:',
  '- When asked for an infographic, visual summary, or "show me visually", output <artifact type="html"> containing a self-contained, responsive HTML document.',
  '- Use CSS Grid or Flexbox for layout. Rounded cards (border-radius:12px) with soft backgrounds (#f0fdf4, #eff6ff, #fef3c7, #fdf2f8).',
  '- Use emoji icons for visual appeal (📥 📊 ✅ ⚙️ 📈 🎯). Dark text (#1e293b) on light card backgrounds. Clear headings (h2/h3).',
  '- Limit to 4-6 key points per infographic. White space between cards (gap:16px). Padding on cards (20px).',
  '- Make it mobile-responsive — cards stack vertically on narrow screens (max-width:600px container).',
  '- Pure HTML+CSS only. No external fonts, scripts, or images. No JavaScript. Keep the document self-contained.',
  '',
  'If the user explicitly requests code, output ONLY code inside <artifact type="code"> — do NOT add a diagram.',
].join('\n');

const CORE_PERSONA_FAST = `You are a helpful, concise technical writing assistant. Respond naturally and briefly.`;

const CORE_PERSONA_BALANCED = `You are an expert technical writing assistant. You write clear, accurate technical content. Be thorough but concise. Use the provided knowledge graph context to ground your answers in the actual codebase.`;

const CORE_PERSONA_HEAVY = `You are an expert technical writing and research assistant. You have access to live search results and codebase knowledge. Answer thoroughly with citations. Prioritize recent, accurate information from provided sources. Never mention training data or knowledge cutoffs.`;

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
