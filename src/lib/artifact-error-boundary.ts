import type { ArtifactType } from './stream-parser';

const LABELS: Partial<Record<ArtifactType, string>> = {
  d2: 'D2',
  flowchart: 'Flowchart',
  graphviz: 'Graphviz',
  html: 'HTML',
  katex: 'KaTeX',
  markmap: 'Markmap',
  mermaid: 'Mermaid',
  plantuml: 'PlantUML',
  react: 'React',
  svg: 'SVG',
  vega: 'Vega',
};

const HINTS: Partial<Record<ArtifactType, string>> = {
  d2: 'Check the diagram syntax or retry the server renderer from this open session.',
  flowchart: 'Check the flowchart syntax or retry the server renderer from this open session.',
  graphviz: 'Check DOT syntax or retry the server renderer from this open session.',
  html: 'Review the sandboxed HTML source, then retry the renderer or view the code.',
  katex: 'Check the LaTeX expression, then retry the renderer or view the source.',
  markmap: 'Check the Markdown heading structure, then retry the renderer or view the source.',
  mermaid: 'Check the diagram syntax, then retry the renderer or use Fix with AI from the artifact panel.',
  plantuml: 'Check PlantUML syntax or retry the server renderer from this open session.',
  react: 'Make sure the React artifact defines an App component before retrying.',
  svg: 'Check the SVG markup, then view the source if rendering is still blocked.',
  vega: 'Check the Vega or Vega-Lite JSON, then retry the renderer or view the source.',
};

export function getArtifactRecoveryHint(type: string): string {
  const key = type.toLowerCase() as ArtifactType;
  return HINTS[key] || 'Open the source, correct the artifact, or retry the renderer from this open session.';
}

export function getArtifactTypeLabel(type: string): string {
  const key = type.toLowerCase() as ArtifactType;
  return LABELS[key] || `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

export function formatArtifactRendererError(type: string, message: string, code: string): string {
  const label = getArtifactTypeLabel(type || 'artifact');
  const hint = getArtifactRecoveryHint(type || 'artifact');
  return [
    `<div class="artifact-error" role="alert" data-artifact-error-type="${escapeAttr(type || 'artifact')}">`,
    `<strong>${escapeHtml(label)} renderer unavailable</strong>`,
    `<span>${escapeHtml(message || 'Renderer failed without details.')}</span>`,
    `<span class="artifact-error-hint">${escapeHtml(hint)}</span>`,
    `<pre>${escapeHtml(code || '')}</pre>`,
    '</div>',
  ].join('');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
