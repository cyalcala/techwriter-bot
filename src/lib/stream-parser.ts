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

type ParserState = 'normal' | 'in_opening_tag' | 'in_artifact_body' | 'in_closing_tag';

const ARTIFACT_OPEN_RE = /<\w*rtifact\s+type="(\w+)"(?:\s+placement="(\w+)")?(?:\s+title="([^"]*)")?(?:\s+language="([^"]*)")?\s*\/?>/i;
const ARTIFACT_CLOSE_RE = /<\/\w*rtifact\s*>/i;

export class ArtifactStreamParser {
  private state: ParserState = 'normal';
  private artifactBuf = '';
  private tagBuf = '';
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
    for (const char of tokens) {
      this.processChar(char);
    }
  }

  private processChar(char: string) {
    switch (this.state) {
      case 'normal':
        this.tagBuf += char;
        if (this.tagBuf.length > 100) {
          this.flushTagBuf();
        } else if (char === '>' && this.tagBuf.includes('<artifact')) {
          const match = this.tagBuf.match(ARTIFACT_OPEN_RE);
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
            this.tagBuf = '';
          } else {
            this.flushTagBuf();
          }
        }
        break;

      case 'in_artifact_body':
        if (char === '<') {
          this.tagBuf = '<';
          this.state = 'in_closing_tag';
        } else {
          this.artifactBuf += char;
        }
        break;

      case 'in_closing_tag':
        this.tagBuf += char;
        if (this.tagBuf.length > 50) {
          this.artifactBuf += this.tagBuf;
          this.tagBuf = '';
          this.state = 'in_artifact_body';
        } else if (char === '>') {
          if (ARTIFACT_CLOSE_RE.test(this.tagBuf)) {
            this.emitArtifact();
            this.state = 'normal';
            this.tagBuf = '';
          } else {
            this.artifactBuf += this.tagBuf;
            this.tagBuf = '';
            this.state = 'in_artifact_body';
          }
        }
        break;
    }
  }

  private emitArtifact() {
    const code = this.artifactBuf;
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

  private flushTagBuf() {
    this.mainBuf += this.tagBuf;
    this.flushMainBuf();
    this.tagBuf = '';
  }

  private flushMainBuf() {
    if (this.mainBuf.length > 0) {
      this.onMainText(this.mainBuf);
      this.mainBuf = '';
    }
  }

  flush() {
    if (this.state === 'normal') {
      this.mainBuf += this.tagBuf;
      this.tagBuf = '';
    } else if (this.state === 'in_artifact_body') {
      if (this.artifactBuf.trim().length > 0) {
        this.emitArtifact();
      } else {
        this.mainBuf += `<artifact type="${this.currentArtifact.type || 'code'}" placement="${this.currentArtifact.placement || 'inline'}" title="${this.currentArtifact.title || ''}">`;
        this.mainBuf += this.artifactBuf;
      }
      this.state = 'normal';
    } else if (this.state === 'in_closing_tag') {
      this.emitArtifact();
    }
    this.flushMainBuf();
  }

  reset() {
    this.state = 'normal';
    this.artifactBuf = '';
    this.tagBuf = '';
    this.mainBuf = '';
    this.currentArtifact = {};
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

  const d2Match = text.match(/(?:^|\n)(?:\w+)(?:\s*->\s*\w+|\s*\.\w+\s*\{)/m);
  if (d2Match && !artifacts.some(a => a.type === 'd2' || a.type === 'mermaid' || a.type === 'graphviz')) {
    const d2Code = text.replace(/<[\/]?\w*rtifact[^>]*>/gi, '').trim();
    if (d2Code.length > 50 && (d2Code.includes('->') || d2Code.includes('shape:'))) {
      artifacts.push({
        id: `fallback-d2-${Date.now()}-${count++}`,
        type: 'd2', title: 'D2 Diagram', placement: 'inline',
        code: d2Code,
      });
    }
  }

  return artifacts;
}