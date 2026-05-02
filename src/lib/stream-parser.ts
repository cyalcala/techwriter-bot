export type ArtifactType = 'code' | 'html' | 'svg' | 'mermaid' | 'react';
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

const ARTIFACT_OPEN_RE = /<artifact\s+type="(\w+)"\s+placement="(\w+)"\s+title="([^"]*)"\s*>/i;
const ARTIFACT_CLOSE_RE = /<\/artifact\s*>/i;

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
            this.currentArtifact = {
              type: match[1] as ArtifactType,
              placement: match[2] as ArtifactPlacement,
              title: match[3] || 'Artifact',
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
      // unclosed artifact — emit what we have as main text
      this.mainBuf += `<artifact type="${this.currentArtifact.type || 'code'}" placement="${this.currentArtifact.placement || 'inline'}" title="${this.currentArtifact.title || ''}">`;
      this.mainBuf += this.artifactBuf;
      this.state = 'normal';
    } else if (this.state === 'in_closing_tag') {
      this.artifactBuf += this.tagBuf;
      this.state = 'in_artifact_body';
      // emit what we have
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
    const lang = match[1] || '';
    const code = match[2].trim();
    let type: ArtifactType = 'code';

    if (lang === 'html' || lang === 'htm') type = 'html';
    else if (lang === 'svg') type = 'svg';
    else if (lang === 'mermaid') type = 'mermaid';
    else if (lang === 'jsx' || lang === 'tsx' || lang === 'react') type = 'react';

    artifacts.push({
      id: `fallback-${Date.now()}-${count++}`,
      type,
      title: lang ? `${lang.toUpperCase()} Code` : 'Code Block',
      placement: 'inline',
      code,
      language: lang || undefined,
    });
  }

  const svgMatch = text.match(/<svg[\s\S]*?<\/svg>/);
  if (svgMatch) {
    artifacts.push({
      id: `fallback-svg-${Date.now()}-${count++}`,
      type: 'svg',
      title: 'SVG Graphic',
      placement: 'inline',
      code: svgMatch[0],
    });
  }

  return artifacts;
}