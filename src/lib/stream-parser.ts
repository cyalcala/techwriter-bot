import { detectCodeLanguage, getDefaultArtifactTitle, normalizeArtifactType, stripOuterFence } from './artifact-types';
import { generateArtifactId } from './artifact-lifecycle';

export type ArtifactType = 'code' | 'html' | 'svg' | 'mermaid' | 'react' | 'katex' | 'markmap' | 'd2' | 'vega' | 'graphviz' | 'plantuml' | 'flowchart' | 'webcontainer';
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

const ARTIFACT_OPEN_PREFIX = '<artifact';
const ARTIFACT_CLOSE_RE = /<\/artifact\s*>/i;
const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

export class ArtifactStreamParser {
  private state: ParserState = 'normal';
  private pending = '';
  private artifactBuf = '';
  private currentArtifact: Partial<Artifact> = {};
  private onArtifactComplete: (artifact: Artifact) => void;
  private onMainText: (text: string) => void;

  constructor(
    onArtifactComplete: (artifact: Artifact) => void,
    onMainText: (text: string) => void,
  ) {
    this.onArtifactComplete = onArtifactComplete;
    this.onMainText = onMainText;
  }

  feed(tokens: string) {
    this.pending += tokens;
    this.drain(false);
  }

  private drain(flush: boolean) {
    while (this.pending.length > 0) {
      if (this.state === 'normal') {
        const lower = this.pending.toLowerCase();
        const openIdx = lower.indexOf(ARTIFACT_OPEN_PREFIX);
        if (openIdx === -1) {
          const keep = flush ? 0 : trailingArtifactPrefixLength(lower);
          const emit = this.pending.slice(0, this.pending.length - keep);
          if (emit) this.emitMain(emit);
          this.pending = this.pending.slice(this.pending.length - keep);
          break;
        }

        if (openIdx > 0) {
          this.emitMain(this.pending.slice(0, openIdx));
          this.pending = this.pending.slice(openIdx);
        }

        const tagEnd = this.pending.indexOf('>');
        if (tagEnd === -1) {
          if (flush) {
            this.emitMain(this.pending);
            this.pending = '';
          }
          break;
        }

        const tagStr = this.pending.slice(0, tagEnd + 1);
        const attrs = parseAttributes(tagStr);
        const artifactType = normalizeArtifactType(attrs.type);
        if (artifactType) {
          const language = attrs.language || undefined;
          const placement = normalizePlacement(attrs.placement);
          this.currentArtifact = {
            type: artifactType,
            placement,
            title: attrs.title || getDefaultArtifactTitle(artifactType, language),
            language,
          };
          this.artifactBuf = '';
          this.state = 'in_artifact_body';
          this.pending = this.pending.slice(tagEnd + 1);
        } else {
          this.emitMain(tagStr);
          this.pending = this.pending.slice(tagEnd + 1);
        }
      } else {
        const closeIdx = this.pending.search(ARTIFACT_CLOSE_RE);
        if (closeIdx === -1) {
          if (flush) {
            this.artifactBuf += this.pending;
            this.pending = '';
            this.emitArtifact();
            this.state = 'normal';
            continue;
          }
          this.artifactBuf += this.pending;
          this.pending = '';
        } else {
          const closeMatch = this.pending.slice(closeIdx).match(ARTIFACT_CLOSE_RE);
          this.artifactBuf += this.pending.slice(0, closeIdx);
          this.pending = this.pending.slice(closeIdx + (closeMatch?.[0].length || 0));
          this.emitArtifact();
          this.state = 'normal';
        }
      }
    }
  }

  private emitMain(text: string) {
    if (text.length > 0) {
      this.onMainText(text);
    }
  }

  private emitArtifact() {
    const type = this.currentArtifact.type || 'code';
    const stripped = stripOuterFence(this.artifactBuf);
    const language = stripped.language || this.currentArtifact.language || (type === 'code' ? detectCodeLanguage(stripped.code) : undefined);
    const artifact: Artifact = {
      id: generateArtifactId(type, stripped.code),
      type,
      title: this.currentArtifact.title || getDefaultArtifactTitle(type, language),
      placement: this.currentArtifact.placement || 'inline',
      code: stripped.code,
      language,
    };

    this.onArtifactComplete(artifact);
  }

  flush() {
    this.drain(true);
    this.state = 'normal';
    this.pending = '';
    this.artifactBuf = '';
    this.currentArtifact = {};
  }

  reset() {
    this.state = 'normal';
    this.pending = '';
    this.artifactBuf = '';
    this.currentArtifact = {};
  }

  feedChunk(chunk: string, _onText: (text: string) => void) {
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

    const normalizedType = normalizeArtifactType(lang, code);
    if (normalizedType) {
      type = normalizedType;
      title = getDefaultArtifactTitle(normalizedType, lang);
    }

    artifacts.push({
      id: `fallback-${Date.now()}-${count++}`,
      type, title, placement: 'inline', code,
      language: lang || undefined,
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

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function normalizePlacement(raw: string | undefined): ArtifactPlacement {
  return raw === 'side' || raw === 'modal' || raw === 'inline' ? raw : 'inline';
}

function trailingArtifactPrefixLength(value: string): number {
  const max = Math.min(value.length, ARTIFACT_OPEN_PREFIX.length - 1);
  for (let len = max; len > 0; len--) {
    if (ARTIFACT_OPEN_PREFIX.startsWith(value.slice(-len))) return len;
  }
  return 0;
}
