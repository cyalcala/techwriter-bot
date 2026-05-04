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

  const dateLayer = `Today is ${dayName}, ${dateStr}. Current year is ${year}. Your training data ended in 2023. You are NOT current unless the search sources below provide up-to-date information.`;

  const classification = classifyQuery(query);
  const conversationalBlock = formatConversationalResponse(classification);

  const artifactLayer = `When the user asks for diagrams, charts, code, or structured content, ALWAYS use the <artifact> tag. Match the type to the request:
- Org charts, dependency trees, node-edge graphs → type="graphviz" (DOT language)
- Flowcharts, sequence diagrams, Gantt, ER, C4, state machines → type="mermaid"
- Cloud architecture, network topology, deployment diagrams → type="d2"
- Mathematical equations, formulas → type="katex" (LaTeX)
- Brainstorming, outlining, hierarchical ideas → type="markmap" (markdown headings)
- Data charts, bar/pie/line/scatter charts → type="vega" (Vega-Lite JSON)
- UML, use case, deployment, wireframes → type="plantuml"
- Simple linear flowcharts → type="flowchart" (flowchart.js DSL)
- Code in any language → type="code" with language="..."
- Full HTML pages → type="html"
- React components → type="react"

CRITICAL: In your response text BEFORE the artifact tag, briefly state which type you chose and why. Example: "Here's an org chart using Graphviz (best for hierarchical structures):" Then output the <artifact> tag. If the user has uploaded documents to RAG memory, PROACTIVELY offer to visualize their content — suggest a mindmap for structure, flowchart for processes, org chart for hierarchies, or data chart for statistics found in their document. When the user requests a diagram or visualization, FIRST list 2-3 best artifact type options with brief reasons, then generate using your recommended one. Example: "I can show this as: 1) Graphviz for hierarchical org structure, 2) Mermaid for a simpler flowchart, 3) D2 for a modern architecture layout. I'll use Graphviz:" Then output the artifact.`;

  if (searchResult.searchTier === 'none') {
    const artifactLine = `When the user asks for diagrams or structured content, ALWAYS use <artifact> tags. Match type to request: graphviz for org charts/trees, mermaid for flowcharts/sequences, d2 for cloud/network, katex for math, markmap for mindmaps, vega for data charts, plantuml for UML, flowchart for simple flows, code for any language. State which type you chose before the tag. If the user has uploaded a document, PROACTIVELY suggest creating a mindmap (markmap), flowchart (mermaid), org chart (graphviz), or data chart (vega) from their document's content.`;
    if (conversationalBlock) {
      return `${dateLayer}\n\n${conversationalBlock}\n\n${artifactLine}`;
    }
    return `${dateLayer}\n\nYou are a helpful technical writing assistant. Be conversational when appropriate. If the user's query is ambiguous, you may offer to help with writing, coding, or research.\n\n${artifactLine}`;
  }

  if (searchResult.contextParts.length === 0) {
    return `${dateLayer}\n\nIMPORTANT: A live web search was attempted but returned NO results. Your training data ended in 2023. You are NOT current. DO NOT fabricate news, recent events, or claim to have up-to-date information. Be honest: tell the user you couldn't find current results for their query. Offer to help with what your pre-2023 training data covers, always labeling it explicitly as "[Pre-2023 knowledge]."\n\n${artifactLayer}`;
  }

  const isEnhanced = searchResult.searchTier === 'enhanced';

  let searchLayer: string;
  if (isEnhanced) {
    searchLayer = `ENHANCED LIVE SEARCH (DDG + Wikipedia + Reddit + Tavily + Exa):\n${searchResult.contextParts.join('\n\n')}\n\nBase your ENTIRE response on these results, which are comprehensive and current. EVERY factual claim MUST cite sources using [1]-[${searchResult.sources.length}] format. Do NOT use your training data unless ALL sources are silent on the topic.`;
  } else {
    searchLayer = `BASIC LIVE SEARCH (DDG + Wikipedia + Reddit):\n${searchResult.contextParts.join('\n\n')}\n\nBase your answer on these sources. Cite sources using [1]-[${searchResult.sources.length}] format. If sources don't fully answer the question, you may supplement with pre-2023 knowledge but you MUST label pre-2023 knowledge explicitly as "[Pre-2023 knowledge]".`;
  }

  return `${dateLayer}\n\n${searchLayer}\n\n${artifactLayer}`;
}
