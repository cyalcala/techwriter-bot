import type { ArtifactType } from './stream-parser';

const MERMAID_DIRECTIVE_RE = /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantChart|block-beta|requirementDiagram|sankey-beta|xychart-beta|C4Context|C4Container|ishikawa|architecture)\b/i;
const FLOWCHART_DIRECTIVE_RE = /^\s*(graph|flowchart)\b/i;
const EXTRA_LABEL_ARROW_RE = /((?:-->|---|==>|-.->|--x|--o)\s*\|[^|\r\n]+)\|>\s*/g;

export function normalizeArtifactSource(type: ArtifactType | string, rawCode: string): string {
  const stripped = stripOuterFence(rawCode);
  const normalizedType = String(type || '').toLowerCase();

  if (normalizedType === 'mermaid') return normalizeMermaidSource(stripped);
  if (normalizedType === 'flowchart' && looksLikeMermaidFlowchart(stripped)) {
    return normalizeMermaidSource(stripped);
  }

  if (isDiagramType(normalizedType)) return stripped.trim();
  return rawCode;
}

export function normalizeMermaidSource(rawCode: string): string {
  let code = decodeCommonEntities(stripOuterFence(rawCode))
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<\/?div>/gi, '\n')
    .replace(/<\/?b>/gi, '')
    .replace(/<\/?i>/gi, '')
    .replace(/<\/?strong>/gi, '')
    .replace(/<\/?em>/gi, '')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .trim();

  code = trimToMermaidDirective(code);
  code = joinDanglingEdges(code);
  const lines = code.split('\n');
  const flowchartLike = lines.some((line) => FLOWCHART_DIRECTIVE_RE.test(line));
  const subgraphAliases = new Map<string, string>();
  const usedAliases = new Set<string>();

  let normalizedLines = lines.map((line) => {
    let next = line.replace(EXTRA_LABEL_ARROW_RE, '$1| ');

    if (flowchartLike && /^\s*note\s+(?:right\s+of|left\s+of|over)\s+.*$/i.test(next)) {
      return '';
    }

    const subgraph = next.match(/^(\s*)subgraph\s+(.+?)\s*$/i);
    if (subgraph && shouldAliasSubgraphTitle(subgraph[2])) {
      const title = cleanSubgraphTitle(subgraph[2]);
      const id = uniqueAlias(title, usedAliases);
      subgraphAliases.set(title, id);
      next = `${subgraph[1]}subgraph ${id} [${title}]`;
    }

    return next;
  });

  if (subgraphAliases.size > 0) {
    normalizedLines = normalizedLines.map((line) => replaceSubgraphReferences(line, subgraphAliases));
  }

  if (flowchartLike) {
    normalizedLines = keepFirstFlowchartDocument(normalizedLines);
  }

  return normalizedLines
    .filter((line, index, arr) => !(line.trim() === '' && (index === 0 || index === arr.length - 1)))
    .join('\n')
    .trim();
}

export function looksLikeMermaidFlowchart(code: string): boolean {
  return /^\s*(graph|flowchart)\b/im.test(stripOuterFence(code));
}

// A mermaid link operator: solid/dotted/thick arrows and their x/o variants,
// e.g. -->  ---  -.->  ==>  --x  o--o . Used to detect edge statements that a
// free-tier model split across two lines.
const LINK_OP = /(?:<?[-.=]{2,}[->ox]?|--[xo]|[xo]--)/;
// A line that ends with a link operator (with at most a trailing |label|) but no
// target node — i.e. the edge's destination moved to the next line. Requires a
// node token (\w…) before the arrow so bare separators like `---` (frontmatter)
// or a dash-run inside a comment are NOT treated as dangling edges.
const DANGLING_EDGE_END = new RegExp(`\\w[^\\r\\n]*?${LINK_OP.source}\\s*(?:\\|[^|\\r\\n]*\\|)?\\s*$`);
const LEADING_LINK_OP = new RegExp(`^\\s*${LINK_OP.source}\\s*\\S`);
// Lines that are structure/config/comments, never merged with a neighbour.
const NON_EDGE_LINE = /^\s*(?:end|subgraph|graph|flowchart|classDef|class|style|linkStyle|click|direction|%%|-{3,}\s*$)/i;

// Repair the single most common free-tier-model mermaid mistake: an edge
// statement wrapped across two lines, e.g.
//     A -->|label|
//     B[Target]
// Mermaid (and Kroki) require `A -->|label| B[Target]` on one line, so the
// split form throws a parse error ("got NODE_STRING"). Join a line that ends
// with a dangling link operator to the following target line; likewise pull up
// a line that *begins* with a link operator onto its source. Structural lines
// (subgraph/end/style/comments/frontmatter) are never merged.
export function joinDanglingEdges(code: string): string {
  const lines = code.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length) {
      const trimmed = line.replace(/\s+$/, '');
      const next = lines[i + 1];
      const nextTrimmed = next.trim();
      if (!nextTrimmed || NON_EDGE_LINE.test(next)) break;
      const endsDangling = !NON_EDGE_LINE.test(trimmed) && DANGLING_EDGE_END.test(trimmed);
      const nextContinues = LEADING_LINK_OP.test(next);
      if (!endsDangling && !nextContinues) break;
      line = `${trimmed} ${nextTrimmed}`;
      i++;
    }
    out.push(line);
  }

  return out.join('\n');
}

function stripOuterFence(code: string): string {
  const match = String(code || '').match(/^\s*```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```\s*$/);
  return match ? match[2].trim() : String(code || '').trim();
}

function decodeCommonEntities(code: string): string {
  return code
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function trimToMermaidDirective(code: string): string {
  const lines = code.split('\n');
  const directiveIndex = lines.findIndex((line) => MERMAID_DIRECTIVE_RE.test(line));
  if (directiveIndex <= 0) return code;

  const prefix = lines.slice(0, directiveIndex).filter((line) => line.trim());
  const prefixIsOnlyMermaidConfig = prefix.every((line) => /^\s*%%\{[\s\S]*\}%%\s*$/.test(line));
  return prefixIsOnlyMermaidConfig
    ? [...prefix, ...lines.slice(directiveIndex)].join('\n')
    : lines.slice(directiveIndex).join('\n');
}

function keepFirstFlowchartDocument(lines: string[]): string[] {
  const firstDirective = lines.findIndex((line) => FLOWCHART_DIRECTIVE_RE.test(line));
  if (firstDirective < 0) return lines;
  const nextDirective = lines.findIndex((line, index) => index > firstDirective && FLOWCHART_DIRECTIVE_RE.test(line));
  return nextDirective > firstDirective ? lines.slice(0, nextDirective) : lines;
}

function shouldAliasSubgraphTitle(value: string): boolean {
  const title = cleanSubgraphTitle(value);
  if (!title || title.includes('[') || title.includes(']')) return false;
  return /\s/.test(title);
}

function cleanSubgraphTitle(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

function uniqueAlias(title: string, used: Set<string>): string {
  const base = (title.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'subgraph')
    .replace(/^(\d)/, 'S_$1');
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${index++}`;
  }
  used.add(candidate);
  return candidate;
}

function replaceSubgraphReferences(line: string, aliases: Map<string, string>): string {
  let next = line;
  for (const [title, id] of aliases) {
    const escapedTitle = escapeRegExp(title);
    next = next.replace(new RegExp(`^(\\s*(?:style|click)\\s+)${escapedTitle}(\\s+)`, 'i'), `$1${id}$2`);
    next = next.replace(new RegExp(`^(\\s*class\\s+)${escapedTitle}(\\s+)`, 'i'), `$1${id}$2`);
  }
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDiagramType(type: string): boolean {
  return ['mermaid', 'flowchart', 'graphviz', 'd2', 'plantuml', 'vega', 'markmap', 'katex', 'svg'].includes(type);
}
