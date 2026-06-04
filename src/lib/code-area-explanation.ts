export const MAX_CODE_AREA_EXPLANATION_REFERENCES = 4;
const MAX_CODE_AREA_TERM_LENGTH = 80;

export interface CodeAreaReference {
  label: string;
  kind: string;
  file: string;
  line?: string;
}

export interface GraphLookupPayload {
  available: boolean;
  context: string;
  nodeCount: number;
}

export interface CodeAreaExplanationResult {
  available: boolean;
  term: string;
  summary: string;
  references: CodeAreaReference[];
  nodeCount: number;
}

function cleanTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ').slice(0, MAX_CODE_AREA_TERM_LENGTH);
}

function parseReferenceLine(line: string): CodeAreaReference | null {
  const match = line.match(/^(.+?)\s+\(([^,()]+),\s+(.+?)\)$/);
  if (!match) return null;

  const location = match[3].trim();
  const lineMatch = location.match(/^(.*):(\d+(?::\d+)?)$/);
  return {
    label: match[1].trim(),
    kind: match[2].trim(),
    file: (lineMatch?.[1] ?? location).trim(),
    line: lineMatch?.[2],
  };
}

function pluralizeReferences(count: number): string {
  return count === 1 ? 'reference' : 'references';
}

export function createCodeAreaExplanation(
  term: string,
  lookup: GraphLookupPayload,
): CodeAreaExplanationResult {
  const clean = cleanTerm(term) || 'code area';
  const nodeCount = Math.max(0, Math.floor(Number(lookup.nodeCount) || 0));

  if (!lookup.available) {
    return {
      available: false,
      term: clean,
      summary: 'Reference index unavailable.',
      references: [],
      nodeCount: 0,
    };
  }

  const references = lookup.context
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(parseReferenceLine)
    .filter((reference): reference is CodeAreaReference => Boolean(reference))
    .slice(0, MAX_CODE_AREA_EXPLANATION_REFERENCES);

  if (references.length === 0) {
    return {
      available: true,
      term: clean,
      summary: `No code references found for "${clean}".`,
      references: [],
      nodeCount,
    };
  }

  const primary = references[0];
  const primaryLocation = `${primary.file}${primary.line ? `:${primary.line}` : ''}`;
  return {
    available: true,
    term: clean,
    summary: `Start with ${primary.label} in ${primaryLocation}. The graph connects "${clean}" to ${nodeCount} bounded ${pluralizeReferences(nodeCount)}; use the listed files as a source-grounded explanation path.`,
    references,
    nodeCount,
  };
}
