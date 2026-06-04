export type DocumentFindingRule =
  | 'heading-level-skip'
  | 'unclosed-code-fence'
  | 'empty-link'
  | 'duplicate-heading'
  | 'terminology'
  | 'api-endpoint-duplicate'
  | 'api-path-parameter-name-mismatch'
  | 'release-notes-placeholder'
  | 'release-notes-missing-version-or-date'
  | 'release-notes-breaking-without-migration-note';

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

interface ApiEndpointReference {
  method: string;
  path: string;
  normalizedPath: string;
  params: string[];
}

interface ApiEndpointRecord extends ApiEndpointReference {
  line: number;
}

interface ReleaseNoteLine {
  line: number;
}

const RELEASE_NOTE_SECTION_HEADINGS = new Set([
  'added',
  'changed',
  'deprecated',
  'fixed',
  'removed',
  'security',
]);
const RELEASE_NOTE_TITLE_PATTERN = /\b(?:release notes?|changelog)\b/i;
const RELEASE_IDENTITY_PATTERN = /(?:\bv?\d+\.\d+(?:\.\d+)?\b|\b\d{4}-\d{2}-\d{2}\b|\[[^\]]+\])/i;
const RELEASE_PLACEHOLDER_PATTERN = /\b(?:TODO|TBD|FIXME|coming soon|placeholder)\b|\[[^\]]*\b(?:todo|tbd|insert|placeholder)\b[^\]]*\]/i;
const RELEASE_BREAKING_PATTERN = /\b(?:breaking|removed|deprecated|not backward compatible|incompatible)\b/i;
const RELEASE_MIGRATION_PATTERN = /\b(?:migration|migrate|upgrade|action required|manual step|rollback|compatibility|workaround)\b/i;

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

function extractApiEndpoint(line: string): ApiEndpointReference | null {
  const match = line.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9._~:/{}-]+)/);
  if (!match) return null;

  const path = match[2].replace(/[),.;:]+$/, '');
  const params = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)].map((param) => param[1]);
  return {
    method: match[1],
    path,
    normalizedPath: path.replace(/\{[A-Za-z][A-Za-z0-9_-]*\}/g, '{}'),
    params,
  };
}

function sameParams(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((param, index) => param === second[index]);
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
  const seenApiEndpoints = new Map<string, ApiEndpointRecord>();
  const seenApiEndpointShapes = new Map<string, ApiEndpointRecord>();
  const releaseNotePlaceholders: ReleaseNoteLine[] = [];
  const breakingReleaseLines: ReleaseNoteLine[] = [];
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let previousHeadingLevel = 0;
  let openFence: OpenFence | null = null;
  let releaseNoteSignals = 0;
  let hasReleaseIdentity = false;
  let hasMigrationGuidance = false;

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
      if (RELEASE_NOTE_TITLE_PATTERN.test(heading[2])) releaseNoteSignals += 2;
      if (RELEASE_NOTE_SECTION_HEADINGS.has(normalizedHeading)) releaseNoteSignals++;
      if (RELEASE_IDENTITY_PATTERN.test(heading[2])) hasReleaseIdentity = true;

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

    if (RELEASE_IDENTITY_PATTERN.test(line)) hasReleaseIdentity = true;
    if (RELEASE_MIGRATION_PATTERN.test(line)) hasMigrationGuidance = true;
    if (RELEASE_PLACEHOLDER_PATTERN.test(line)) {
      releaseNotePlaceholders.push({ line: lineNumber });
    }
    if (!heading && RELEASE_BREAKING_PATTERN.test(line)) {
      breakingReleaseLines.push({ line: lineNumber });
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

    const endpoint = extractApiEndpoint(line);
    if (endpoint) {
      const endpointKey = `${endpoint.method} ${endpoint.path}`;
      const endpointShapeKey = `${endpoint.method} ${endpoint.normalizedPath}`;
      const firstEndpoint = seenApiEndpoints.get(endpointKey);
      const firstShape = seenApiEndpointShapes.get(endpointShapeKey);

      if (firstEndpoint) {
        findings.push({
          rule: 'api-endpoint-duplicate',
          severity: 'warning',
          line: lineNumber,
          message: `${endpoint.method} ${endpoint.path} duplicates the endpoint on line ${firstEndpoint.line}.`,
        });
      } else {
        seenApiEndpoints.set(endpointKey, { ...endpoint, line: lineNumber });
      }

      if (firstShape && !sameParams(firstShape.params, endpoint.params)) {
        findings.push({
          rule: 'api-path-parameter-name-mismatch',
          severity: 'warning',
          line: lineNumber,
          message: `${endpoint.method} ${endpoint.path} uses path parameter names that differ from line ${firstShape.line}.`,
        });
      } else if (!firstShape) {
        seenApiEndpointShapes.set(endpointShapeKey, { ...endpoint, line: lineNumber });
      }
    }
  });

  if (releaseNoteSignals >= 2) {
    if (!hasReleaseIdentity) {
      findings.push({
        rule: 'release-notes-missing-version-or-date',
        severity: 'warning',
        line: 1,
        message: 'Release notes should identify the release version or date.',
      });
    }

    releaseNotePlaceholders.forEach((placeholder) => {
      findings.push({
        rule: 'release-notes-placeholder',
        severity: 'warning',
        line: placeholder.line,
        message: 'Release notes still contain placeholder draft text.',
      });
    });

    if (!hasMigrationGuidance) {
      breakingReleaseLines.forEach((breakingLine) => {
        findings.push({
          rule: 'release-notes-breaking-without-migration-note',
          severity: 'warning',
          line: breakingLine.line,
          message: 'Breaking, removed, or deprecated release notes should include migration or action-required guidance.',
        });
      });
    }
  }

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
