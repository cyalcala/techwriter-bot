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

const ARTIFACT_COMPACT = 'For diagram/code requests: FIRST list 2-3 best format options with a one-line reason each ("Mermaid — best for flowcharts", "D2 — best for cloud architecture", "Graphviz — best for org charts"). Wait for the user to choose, THEN generate using <artifact type="X">...</artifact>. Types: code|html|svg|mermaid|react|katex|markmap|d2|vega|graphviz|plantuml|flowchart|webcontainer. Always choose the format that produces the clearest, most professional result for that specific request.';

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
