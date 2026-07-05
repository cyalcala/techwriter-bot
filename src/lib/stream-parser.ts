import { normalizeArtifactSource } from './diagram-source-normalizer';
import { KROKI_RENDERABLE } from './kroki-renderer';

export type ArtifactType = 'code' | 'html' | 'svg' | 'mermaid' | 'react' | 'katex' | 'markmap' | 'd2' | 'vega' | 'graphviz' | 'plantuml' | 'flowchart' | 'deck' | string;
export type ArtifactPlacement = 'inline' | 'side' | 'modal';

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  placement: ArtifactPlacement;
  code: string;
  language?: string;
}

type ParserState = 'normal' | 'in_artifact_body';

const ARTIFACT_OPEN_RE = /<\w*rtifact\s+type="(\w+)"(?:\s+placement="(\w+)")?(?:\s+title="([^"]*)")?(?:\s+language="([^"]*)")?\s*\/?>/i;
const ARTIFACT_OPEN_START_RE = /<\w*rtifact\b/i;
const ARTIFACT_CLOSE_RE = /<\/\w*rtifact\s*>/i;
const ARTIFACT_BODY_TAG_RE = /<\/\w*rtifact\s*>|<\w*rtifact\b[^>]*>/ig;
const ARTIFACT_TAG_NAME_RE = /^\w*rtifact$/i;
const INERT_LEGACY_TYPES = new Set(['webcontainer', 'webcontainers']);

function isPotentialArtifactTagPrefix(value: string): boolean {
  if (!value.startsWith('<') || value.includes('>')) return false;

  const body = value.slice(1);
  if (body === '' || body === '/') return true;

  const isClosing = body.startsWith('/');
  const tagBody = isClosing ? body.slice(1) : body;
  if (tagBody === '') return true;

  const nameMatch = tagBody.match(/^(\w*)([\s\S]*)$/);
  if (!nameMatch || nameMatch[1].length === 0) return false;

  const [, name, rest] = nameMatch;
  if (rest.length === 0) return true;
  if (!ARTIFACT_TAG_NAME_RE.test(name)) return false;
  return isClosing ? /^\s*$/.test(rest) : /^\s/.test(rest);
}

function trailingArtifactTagPrefixLength(text: string): number {
  const start = text.lastIndexOf('<');
  if (start === -1) return 0;

  const suffix = text.slice(start);
  return isPotentialArtifactTagPrefix(suffix) ? suffix.length : 0;
}

export class ArtifactStreamParser {
  private state: ParserState = 'normal';
  private artifactBuf = '';
  private mainBuf = '';
  private currentArtifact: Partial<Artifact> = {};
  private onArtifactComplete: (artifact: Artifact) => void;
  private onMainText: (text: string) => void;
  private artifactCounter = 0;
  private artifactDepth = 0;
  private artifactBodyTagBuf = '';

  constructor(
    onArtifactComplete: (artifact: Artifact) => void,
    onMainText: (text: string) => void,
  ) {
    this.onArtifactComplete = onArtifactComplete;
    this.onMainText = onMainText;
  }

  feed(tokens: string) {
    let remaining = this.state === 'normal' ? this.mainBuf + tokens : this.artifactBodyTagBuf + tokens;
    if (this.state === 'normal') this.mainBuf = '';
    else this.artifactBodyTagBuf = '';

    while (remaining.length > 0) {
      if (this.state === 'normal') {
        const openIdx = remaining.search(ARTIFACT_OPEN_START_RE);
        if (openIdx === -1) {
          const pendingLength = trailingArtifactTagPrefixLength(remaining);
          const textEnd = remaining.length - pendingLength;
          this.emitMain(remaining.slice(0, textEnd));
          this.mainBuf = remaining.slice(textEnd);
          remaining = '';
          break;
        }

        if (openIdx > 0) {
          this.emitMain(remaining.slice(0, openIdx));
        }

        const closeIdx = remaining.indexOf('>', openIdx);
        if (closeIdx === -1) {
          this.mainBuf = remaining.slice(openIdx);
          remaining = '';
          break;
        }

        const tagStr = remaining.slice(openIdx, closeIdx + 1);
        const match = tagStr.match(ARTIFACT_OPEN_RE);
        if (match) {
          const rawType = match[1].toLowerCase();
          const artifactType = (INERT_LEGACY_TYPES.has(rawType) ? 'code' : rawType) as ArtifactType;
          this.currentArtifact = {
            type: artifactType,
            placement: (match[2] || 'inline') as ArtifactPlacement,
            title: match[3] || (artifactType === 'code' ? 'Code' : `${artifactType.charAt(0).toUpperCase() + artifactType.slice(1)} Diagram`),
            language: match[4] || undefined,
          };
          this.artifactBuf = '';
          this.artifactDepth = 0;
          this.artifactBodyTagBuf = '';
          this.state = 'in_artifact_body';
          remaining = remaining.slice(closeIdx + 1);
        } else {
          this.emitMain(tagStr);
          remaining = remaining.slice(closeIdx + 1);
        }
      } else {
        const boundary = this.findNextArtifactBoundary(remaining);
        if (!boundary) {
          const pendingLength = trailingArtifactTagPrefixLength(remaining);
          const textEnd = remaining.length - pendingLength;
          this.artifactBuf += remaining.slice(0, textEnd);
          this.artifactBodyTagBuf = remaining.slice(textEnd);
          remaining = '';
        } else if (boundary.kind === 'open') {
          this.artifactBuf += remaining.slice(0, boundary.end);
          if (!boundary.selfClosing) this.artifactDepth += 1;
          remaining = remaining.slice(boundary.end);
        } else if (this.artifactDepth > 0) {
          this.artifactBuf += remaining.slice(0, boundary.end);
          this.artifactDepth -= 1;
          remaining = remaining.slice(boundary.end);
        } else {
          this.artifactBuf += remaining.slice(0, boundary.start);
          remaining = remaining.slice(boundary.end);
          this.emitArtifact();
          this.state = 'normal';
          this.artifactBodyTagBuf = '';
        }
      }
    }
  }

  private findNextArtifactBoundary(text: string): { kind: 'open' | 'close'; start: number; end: number; selfClosing?: boolean } | null {
    ARTIFACT_BODY_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ARTIFACT_BODY_TAG_RE.exec(text)) !== null) {
      const tag = match[0];
      if (ARTIFACT_CLOSE_RE.test(tag)) {
        return { kind: 'close', start: match.index, end: match.index + tag.length };
      }
      if (ARTIFACT_OPEN_RE.test(tag)) {
        return { kind: 'open', start: match.index, end: match.index + tag.length, selfClosing: /\/\s*>$/.test(tag) };
      }
    }
    return null;
  }

  private emitMain(text: string) {
    if (text.length > 0) {
      this.onMainText(text);
    }
  }

  private emitArtifact() {
    let code = this.artifactBuf;
    const artifact: Artifact = {
      id: `artifact-${Date.now()}-${this.artifactCounter++}`,
      type: this.currentArtifact.type || 'code',
      title: this.currentArtifact.title || 'Artifact',
      placement: this.currentArtifact.placement || 'inline',
      code,
    };

    const langMatch = code.match(/^```(\w+)\n/);
    if (langMatch) {
      artifact.language = langMatch[1];
      artifact.code = code.slice(langMatch[0].length).replace(/\n```\s*$/, '');
    }

    if (artifact.type === 'code') {
      const fenceMatch = code.match(/```(\w+)\n([\s\S]*?)```/);
      if (fenceMatch) {
        artifact.language = fenceMatch[1];
        artifact.code = fenceMatch[2].trim();
      }
    }

    artifact.code = normalizeArtifactSource(artifact.type, artifact.code);

    this.onArtifactComplete(artifact);
    this.artifactDepth = 0;
  }

  flush() {
    if (this.state === 'in_artifact_body') {
      this.artifactBuf += this.artifactBodyTagBuf;
      this.artifactBodyTagBuf = '';
      if (this.artifactBuf.trim().length > 0) {
        this.emitArtifact();
      }
    }
    this.emitMain(this.mainBuf);
    this.state = 'normal';
    this.artifactBuf = '';
    this.artifactBodyTagBuf = '';
    this.mainBuf = '';
    this.currentArtifact = {};
    this.artifactDepth = 0;
  }

  reset() {
    this.state = 'normal';
    this.artifactBuf = '';
    this.artifactBodyTagBuf = '';
    this.mainBuf = '';
    this.currentArtifact = {};
    this.artifactDepth = 0;
  }

  feedChunk(chunk: string, onText: (text: string) => void) {
    void onText;
    this.feed(chunk);
  }
}

export function detectCodeFenceFallback(text: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const CODE_RE = /```(\w+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = CODE_RE.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const code = match[2].trim();
    let type: ArtifactType = 'code';
    let title = lang ? `${lang.toUpperCase()} Code` : 'Code Block';

    if (lang === 'html' || lang === 'htm') { type = 'html'; title = 'HTML'; }
    else if (lang === 'svg') { type = 'svg'; title = 'SVG'; }
    else if (lang === 'mermaid') { type = 'mermaid'; title = 'Mermaid Diagram'; }
    else if (lang === 'deck') { type = 'deck'; title = 'Presentation'; }
    else if (KROKI_RENDERABLE.has(lang)) { type = lang; title = `${lang.charAt(0).toUpperCase() + lang.slice(1)} Diagram`; }
    
    artifacts.push({
      id: `fallback-code-${Date.now()}-${count++}`,
      type, title, placement: 'inline', code, language: lang || undefined
    });
  }

  const svgMatch = text.match(/<svg[\s\S]*?<\/svg>/);
  if (svgMatch) {
    artifacts.push({
      id: `fallback-svg-${Date.now()}-${count++}`,
      type: 'svg', title: 'SVG Graphic', placement: 'inline',
      code: svgMatch[0],
    });
  }

  const dotMatch = text.match(/(?:digraph|graph)\s+\w+\s*\{[\s\S]+?\}/i);
  if (dotMatch && !artifacts.some(a => a.type === 'graphviz')) {
    artifacts.push({
      id: `fallback-dot-${Date.now()}-${count++}`,
      type: 'graphviz', title: 'Graphviz Diagram', placement: 'inline',
      code: dotMatch[0],
    });
  }

  return artifacts;
}
