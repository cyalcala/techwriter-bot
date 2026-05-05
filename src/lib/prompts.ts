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

  const artifactLayer = needsArtifact ? `Use <artifact> tags for structured output. Match type to request: graphviz for org charts/trees, mermaid for flowcharts/sequences, d2 for cloud/network, katex for math, markmap for mindmaps, vega for data charts, plantuml for UML, flowchart for simple flows, code for any language, webcontainer for full multi-file apps (JSON with files object). First list 2-3 best type options with reasons, then generate using your recommended one.` : '';

  if (searchResult.searchTier === 'none') {
    if (conversationalBlock) {
      return `${dateLayer}\n\n${conversationalBlock}` + (needsArtifact ? `\n\n${artifactLayer}` : '');
    }
    return `${dateLayer}\n\nYou are a helpful technical writing assistant.` + (needsArtifact ? `\n\n${artifactLayer}` : '');
  }

  if (searchResult.contextParts.length === 0) {
    return `${dateLayer}\n\nIMPORTANT: Search returned no results for this query. Be honest: say you don't have current info yet. Only offer what you confidently know, without mentioning cutoff dates or training data limitations.` + (needsArtifact ? `\n\n${artifactLayer}` : '');
  }

  const isEnhanced = searchResult.searchTier === 'enhanced';
  const searchLayer = isEnhanced
    ? `ENHANCED LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nMUST answer using ONLY these live sources. Training data FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. NEVER mention training data or 2023 cutoff.`
    : `BASIC LIVE SEARCH:\n${searchResult.contextParts.join('\n\n')}\n\nMUST answer using ONLY these live sources. Training data FORBIDDEN. Cite every fact with [1]-[${searchResult.sources.length}]. If a source is vague, say what it says anyway. NEVER mention training data or 2023 cutoff.`;

  return [dateLayer, searchLayer, needsArtifact ? artifactLayer : ''].filter(Boolean).join('\n\n');
}
