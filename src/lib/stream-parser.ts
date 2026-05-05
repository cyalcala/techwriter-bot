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

const ARTIFACT_OPEN_RE = /<\w*rtifact\s+type="(\w+)"(?:\s+placement="(\w+)")?(?:\s+title="([^"]*)")?(?:\s+language="([^"]*)")?\s*\/?>/i;
const ARTIFACT_CLOSE_RE = /<\/\w*rtifact\s*>/i;

export class ArtifactStreamParser {
  private state: ParserState = 'normal';
  private artifactBuf = '';
  private mainBuf = '';
  private currentArtifact: Partial<Artifact> = {};
  private onArtifactComplete: (artifact: Artifact) => void;
  private onMainText: (text: string) => void;
  private artifactCounter = 0;

  constructor(
    onArtifactComplete: (artifact: Artifact) => void,
    onMainText: (text: string) => void,
  ) {
    this.onArtifactComplete = onArtifactComplete;
    this.onMainText = onMainText;
  }

  feed(tokens: string) {
    let remaining = tokens;
    while (remaining.length > 0) {
      if (this.state === 'normal') {
        const openIdx = remaining.indexOf('<artifact');
        if (openIdx === -1) {
          this.emitMain(remaining);
          remaining = '';
          break;
        }

        if (openIdx > 0) {
          this.emitMain(remaining.slice(0, openIdx));
        }

        const closeIdx = remaining.indexOf('>', openIdx);
        if (closeIdx === -1) {
          this.emitMain(remaining);
          remaining = '';
          break;
        }

        const tagStr = remaining.slice(openIdx, closeIdx + 1);
        const match = tagStr.match(ARTIFACT_OPEN_RE);
        if (match) {
          const artifactType = match[1] as ArtifactType;
          this.currentArtifact = {
            type: artifactType,
            placement: (match[2] || 'inline') as ArtifactPlacement,
            title: match[3] || (artifactType === 'code' ? 'Code' : `${artifactType.charAt(0).toUpperCase() + artifactType.slice(1)} Diagram`),
            language: match[4] || undefined,
          };
          this.artifactBuf = '';
          this.state = 'in_artifact_body';
          remaining = remaining.slice(closeIdx + 1);
        } else {
          this.emitMain(tagStr);
          remaining = remaining.slice(closeIdx + 1);
        }
      } else {
        const closeIdx = remaining.indexOf('</artifact>');
        if (closeIdx === -1) {
          this.artifactBuf += remaining;
          remaining = '';
        } else {
          this.artifactBuf += remaining.slice(0, closeIdx);
          remaining = remaining.slice(closeIdx + 11);
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

    this.onArtifactComplete(artifact);
  }

  flush() {
    if (this.state === 'in_artifact_body' && this.artifactBuf.trim().length > 0) {
      this.emitArtifact();
    }
    this.emitMain(this.mainBuf);
    this.state = 'normal';
    this.artifactBuf = '';
    this.mainBuf = '';
    this.currentArtifact = {};
  }

  reset() {
    this.state = 'normal';
    this.artifactBuf = '';
    this.mainBuf = '';
    this.currentArtifact = {};
  }

  feedChunk(chunk: string, onText: (text: string) => void) {
    this.mainBuf += chunk;
    this.feed(chunk);
    this.emitMain(this.mainBuf);
    this.mainBuf = '';
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
    else if (lang === 'jsx' || lang === 'tsx' || lang === 'react') { type = 'react'; title = 'React Component'; }
    else if (lang === 'graphviz' || lang === 'dot') { type = 'graphviz'; title = 'Graphviz Diagram'; }
    else if (lang === 'd2') { type = 'd2'; title = 'D2 Diagram'; }
    else if (lang === 'plantuml' || lang === 'puml') { type = 'plantuml'; title = 'PlantUML Diagram'; }
    else if (lang === 'katex' || lang === 'latex' || lang === 'tex') { type = 'katex'; title = 'Math Formula'; }
    else if (lang === 'vega' || lang === 'vega-lite' || lang === 'json') { type = 'vega'; title = 'Vega Chart'; }
    else if (lang === 'flowchart') { type = 'flowchart'; title = 'Flowchart'; }

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
