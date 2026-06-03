export type DocumentFindingRule =
  | 'heading-level-skip'
  | 'unclosed-code-fence'
  | 'empty-link'
  | 'duplicate-heading'
  | 'terminology';

export interface TerminologyRule {
  avoid: string;
  prefer: string;
}

export interface ParsedTerminologyRules {
  rules: TerminologyRule[];
  ignoredLines: number;
}

export interface DocumentFinding {
  rule: DocumentFindingRule;
  severity: 'warning' | 'error';
  line: number;
  message: string;
}

export const MAX_TERMINOLOGY_RULES = 25;
const TERMINOLOGY_DELIMITERS = ['->', '=>', '|'];
const MAX_TERMINOLOGY_TERM_LENGTH = 80;

interface OpenFence {
  character: '`' | '~';
  length: number;
  line: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHeading(value: string): string {
  return value.replace(/\s+#+\s*$/, '').trim().toLocaleLowerCase();
}

function startsFence(line: string): { character: '`' | '~'; length: number } | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;

  return {
    character: match[1][0] as '`' | '~',
    length: match[1].length,
  };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const character = escapeRegExp(fence.character);
  return new RegExp(`^\\s{0,3}${character}{${fence.length},}\\s*$`).test(line);
}

function containsTerm(line: string, term: string): boolean {
  if (!term.trim()) return false;

  const escaped = escapeRegExp(term.trim());
  return new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, 'i').test(line);
}

function cleanTerminologyTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TERMINOLOGY_TERM_LENGTH);
}

export function parseTerminologyRules(input: string): ParsedTerminologyRules {
  const rules: TerminologyRule[] = [];
  const seenAvoidTerms = new Set<string>();
  let ignoredLines = 0;
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (rules.length >= MAX_TERMINOLOGY_RULES) {
      ignoredLines++;
      continue;
    }

    const delimiter = TERMINOLOGY_DELIMITERS.find((candidate) => trimmed.includes(candidate));
    if (!delimiter) {
      ignoredLines++;
      continue;
    }

    const [avoidRaw, ...preferParts] = trimmed.split(delimiter);
    const avoid = cleanTerminologyTerm(avoidRaw);
    const prefer = cleanTerminologyTerm(preferParts.join(delimiter));
    const avoidKey = avoid.toLocaleLowerCase();

    if (!avoid || !prefer || avoidKey === prefer.toLocaleLowerCase()) {
      ignoredLines++;
      continue;
    }
    if (seenAvoidTerms.has(avoidKey)) continue;

    seenAvoidTerms.add(avoidKey);
    rules.push({ avoid, prefer });
  }

  return { rules, ignoredLines };
}

export function reviewDocument(
  content: string,
  terminology: TerminologyRule[] = [],
): DocumentFinding[] {
  const findings: DocumentFinding[] = [];
  const seenHeadings = new Map<string, number>();
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let previousHeadingLevel = 0;
  let openFence: OpenFence | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fenceStart = startsFence(line);

    if (openFence) {
      if (closesFence(line, openFence)) openFence = null;
      return;
    }

    if (fenceStart) {
      openFence = { ...fenceStart, line: lineNumber };
      return;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (level > previousHeadingLevel + 1) {
        findings.push({
          rule: 'heading-level-skip',
          severity: 'warning',
          line: lineNumber,
          message: `Heading jumps from level ${previousHeadingLevel} to level ${level}.`,
        });
      }

      const normalizedHeading = normalizeHeading(heading[2]);
      if (normalizedHeading && seenHeadings.has(normalizedHeading)) {
        findings.push({
          rule: 'duplicate-heading',
          severity: 'warning',
          line: lineNumber,
          message: `Heading duplicates the heading on line ${seenHeadings.get(normalizedHeading)}.`,
        });
      } else if (normalizedHeading) {
        seenHeadings.set(normalizedHeading, lineNumber);
      }

      previousHeadingLevel = level;
    }

    if (/!?\[[^\]]*\]\(\s*(?:(?:"[^"]*"|'[^']*')\s*)?\)/.test(line)) {
      findings.push({
        rule: 'empty-link',
        severity: 'warning',
        line: lineNumber,
        message: 'Markdown link has no destination.',
      });
    }

    terminology.forEach(({ avoid, prefer }) => {
      if (!containsTerm(line, avoid)) return;

      findings.push({
        rule: 'terminology',
        severity: 'warning',
        line: lineNumber,
        message: `Prefer "${prefer}" instead of "${avoid}".`,
      });
    });
  });

  if (openFence) {
    findings.push({
      rule: 'unclosed-code-fence',
      severity: 'error',
      line: openFence.line,
      message: 'Fenced code block is not closed.',
    });
  }

  return findings;
}
