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

  const artifactLayer = `When generating structured content, wrap it in <artifact type="..." placement="inline" title="...">...</artifact> tags. Available types:
- type="code" with language="python|javascript|typescript|html|css|bash|json|..." for syntax-highlighted code
- type="mermaid" for flowcharts, sequence diagrams, class/ER/Gantt/pie/git graphs, mindmaps, timelines, state diagrams, C4 architecture. Use plain text in labels — NO HTML tags inside nodes.
- type="d2" for system architecture, cloud infrastructure, and network topology diagrams (cleaner than Mermaid for deployment/network diagrams)
- type="katex" for mathematical equations and LaTeX formulas
- type="markmap" for interactive mind maps (write as markdown headings: "# Root\n## Branch\n### Leaf")
- type="vega" for interactive data charts (provide Vega-Lite JSON spec)
- type="graphviz" for dependency graphs, org charts, and node-edge diagrams (DOT language)
- type="plantuml" for UML diagrams, use case diagrams, deployment diagrams, and wireframes
- type="flowchart" for simple flowchart diagrams (flowchart.js DSL)
- type="svg" for raw SVG markup
- type="html" for embedded HTML pages
- type="react" for React components with JSX`;

  if (searchResult.searchTier === 'none') {
    const artifactLine = `When generating structured content, wrap it in <artifact type="..." placement="inline" title="...">...</artifact> tags. Available types: code (with language attr), mermaid, d2, katex, markmap, vega, graphviz, plantuml, flowchart, svg, html, react. For Mermaid: no HTML tags in labels.`;
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
