import { classifyQuery, formatConversationalResponse } from './relevance';

export interface SearchResult {
  contextParts: string[];
  sources: { title: string; url: string; provider?: string }[];
  searchTier: 'none' | 'basic' | 'enhanced';
  searchAttempted: boolean;
  enhancedRemaining?: number;
}

export function buildSystemPrompt(query: string, searchResult: SearchResult): string {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const year = now.getFullYear();

  const dateLayer = `Today is ${dayName}, ${dateStr}. Current year is ${year}. Always assume the user wants current, accurate information unless they specifically ask about something historical.`;

  const classification = classifyQuery(query);
  const conversationalBlock = formatConversationalResponse(classification);

  const needsArtifact = /(diagram|chart|graph|draw|visualize|plot|flowchart|mind.?map|org.?chart|architecture|uml|code|equation|math|latex|mermaid|graphviz|d2|plantuml|katex|vega|markmap|flowchart|webcontainer|react|component|app|wireframe)/i.test(query);

  const artifactLayer = needsArtifact ? `CRITICAL — Use <artifact> tags for structured output. Match type to request: graphviz for org charts/trees, mermaid for flowcharts/sequences, d2 for cloud/network, katex for math, markmap for mindmaps, vega for data charts, plantuml for UML, flowchart for simple flows, code for any language, webcontainer for full multi-file apps (JSON with files object). First list 2-3 best type options with reasons, then generate using your recommended one.` : '';

  if (searchResult.searchTier === 'none') {
    const artifactLine = needsArtifact ? `When generating structured content, wrap it in <artifact type="..." placement="inline" title="...">...</artifact> tags. Available: code, mermaid, d2, katex, markmap, vega, graphviz, plantuml, flowchart, svg, html, react, webcontainer. For Mermaid: no HTML tags in labels.` : '';
    if (conversationalBlock) {
      return [dateLayer, conversationalBlock, artifactLine].filter(Boolean).join('\n\n');
    }
    return [dateLayer, 'You are a helpful technical writing assistant. Be conversational when appropriate.', artifactLine].filter(Boolean).join('\n\n');
  }

  if (searchResult.contextParts.length === 0) {
    return [dateLayer, "IMPORTANT: You attempted to search for current information but found no results for this query. Be honest: say you don't have current info yet. Only offer what you confidently know, without mentioning cutoff dates or training data limitations. Suggest the user try a more specific query.", artifactLayer].filter(Boolean).join('\n\n');
  }

  const isEnhanced = searchResult.searchTier === 'enhanced';

  let searchLayer: string;
  if (isEnhanced) {
    searchLayer = `ENHANCED LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nYou MUST answer using ONLY these live sources. Your training data is IRRELEVANT and FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. NEVER mention your training data or 2023 cutoff.`;
  } else {
    searchLayer = `BASIC LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nYou MUST answer using ONLY these live sources. Your training data is IRRELEVANT and FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. If a source is vague, say what it says anyway. NEVER mention your training data or 2023 cutoff.`;
  }

  return [dateLayer, searchLayer, artifactLayer].filter(Boolean).join('\n\n');
}
    return `${dateLayer}\n\nYou are a helpful technical writing assistant. Be conversational when appropriate. If the user's query is ambiguous, you may offer to help with writing, coding, or research.\n\n${artifactLine}`;
  }

  if (searchResult.contextParts.length === 0) {
    return `${dateLayer}\n\nIMPORTANT: You attempted to search for current information but found no results for the user's specific query. Do NOT fabricate or claim knowledge of recent events. Be honest: say you don't have current info on this topic yet. Only offer what you confidently know, without mentioning cutoff dates or training data limitations. Keep it brief and helpful. Suggest the user try a more specific query or check authoritative sources directly.\n\n${artifactLayer}`;
  }

  const isEnhanced = searchResult.searchTier === 'enhanced';

  let searchLayer: string;
  if (isEnhanced) {
    searchLayer = `ENHANCED LIVE SEARCH (DDG + Wikipedia + Reddit + Tavily + Exa):\n${searchResult.contextParts.join('\n\n')}\n\nYou MUST answer using ONLY these live sources. Your training data is IRRELEVANT and FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. NEVER mention your training data or 2023 cutoff.`;
  } else {
    searchLayer = `BASIC LIVE SEARCH (DDG + Wikipedia + Reddit):\n${searchResult.contextParts.join('\n\n')}\n\nYou MUST answer using ONLY these live sources. Your training data is IRRELEVANT and FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. If a source is vague, say what it says anyway — vague current info is better than precise old info. NEVER say you couldn't find results when sources are provided above. NEVER mention your training data or 2023 cutoff.`;
  }

  return `${dateLayer}\n\n${searchLayer}\n\n${artifactLayer}`;
}
