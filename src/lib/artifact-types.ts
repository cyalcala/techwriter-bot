import type { ArtifactType } from './stream-parser';
import { KROKI_RENDERABLE } from './kroki-renderer';
import { looksLikeDeckSpec } from './deck-schema';
import { looksLikeDocSpec } from './doc-schema';

export const SUPPORTED_ARTIFACT_TYPES = [
  'code',
  'html',
  'svg',
  'mermaid',
  'react',
  'katex',
  'markmap',
  'd2',
  'vega',
  'graphviz',
  'plantuml',
  'flowchart',
  'deck',
  'document',
] as const satisfies readonly ArtifactType[];

export const PREVIEWABLE_ARTIFACT_TYPES = [
  'html',
  'svg',
  'mermaid',
  'react',
  'katex',
  'markmap',
  'd2',
  'vega',
  'graphviz',
  'plantuml',
  'flowchart',
  'deck',
  'document',
] as const satisfies readonly ArtifactType[];

const TYPE_ALIASES: Record<string, ArtifactType> = {
  code: 'code',
  text: 'code',
  txt: 'code',
  html: 'html',
  htm: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  mmd: 'mermaid',
  react: 'react',
  jsx: 'react',
  tsx: 'react',
  katex: 'katex',
  latex: 'katex',
  tex: 'katex',
  markmap: 'markmap',
  markdown: 'markmap',
  md: 'markmap',
  d2: 'd2',
  vega: 'vega',
  'vega-lite': 'vega',
  vegalite: 'vega',
  graphviz: 'graphviz',
  dot: 'graphviz',
  plantuml: 'plantuml',
  puml: 'plantuml',
  flowchart: 'flowchart',
  deck: 'deck',
  slides: 'deck',
  slidedeck: 'deck',
  presentation: 'deck',
  document: 'document',
  doc: 'document',
  report: 'document',
};

const CODE_LANGS = new Set([
  'python',
  'py',
  'javascript',
  'typescript',
  'js',
  'ts',
  'bash',
  'sh',
  'shell',
  'css',
  'sql',
  'go',
  'rust',
  'rs',
  'java',
  'cpp',
  'c++',
  'c',
  'csharp',
  'cs',
  'jsonc',
  'yaml',
  'yml',
  'toml',
]);

export const ARTIFACT_LANGUAGE_ALIASES = new Set([
  ...Object.keys(TYPE_ALIASES),
  ...CODE_LANGS,
  'json',
]);

export function normalizeArtifactType(raw: string | null | undefined, code = ''): ArtifactType | null {
  const key = (raw || '').trim().toLowerCase();
  if (!key) return null;
  if (key === 'json') {
    if (looksLikeVegaSpec(code)) return 'vega';
    if (looksLikeDeckSpec(code)) return 'deck';
    return looksLikeDocSpec(code) ? 'document' : null;
  }
  if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  if (CODE_LANGS.has(key)) return 'code';
  return null;
}

export function getDefaultArtifactTitle(type: ArtifactType, language?: string): string {
  if (type === 'code') return language ? `${language.toUpperCase()} Code` : 'Code';
  if (type === 'html') return 'HTML';
  if (type === 'svg') return 'SVG';
  if (type === 'react') return 'React Component';
  if (type === 'katex') return 'Math Formula';
  if (type === 'vega') return 'Vega Chart';
  if (type === 'deck') return 'Presentation';
  if (type === 'document') return 'Document';
  return `${type.charAt(0).toUpperCase() + type.slice(1)} Diagram`;
}

export function detectCodeLanguage(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/\b(def|class)\s+\w+|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

export function stripOuterFence(code: string): { code: string; language?: string } {
  const match = code.match(/^\s*```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (!match) return { code: code.trim() };
  return {
    language: match[1]?.trim().toLowerCase() || undefined,
    code: match[2].trim(),
  };
}

export function validateArtifact(type: ArtifactType, rawCode: string): boolean {
  const code = rawCode.trim();
  if (!type || code.length < 5) return false;

  switch (type) {
    case 'mermaid':
      return /\b(graph\s+(TB|TD|BT|RL|LR)|flowchart\s+(TB|TD|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|gitgraph|mindmap|timeline|quadrantChart|block-beta|requirementDiagram|journey|sankey-beta|xychart-beta|C4Context|C4Container)\b/i.test(code);
    case 'graphviz':
      return /\b(?:strict\s+)?(?:digraph|graph)\s+[\w"]*\s*\{/i.test(code) && balanced(code, '{', '}');
    case 'd2':
      return /(?:->|<->|--|\.shape|\.style|\.label|:\s*\{)/.test(code) && code.length > 12;
    case 'plantuml':
      return /@startuml/i.test(code) && /@enduml/i.test(code);
    case 'katex':
      return /[\\^_{}=]/.test(code) || /\\\w+/.test(code);
    case 'vega':
      return looksLikeVegaSpec(code);
    case 'flowchart':
      return /=>|->|:>/.test(code) && code.length > 20;
    case 'markmap':
      return /^#+\s/m.test(code) && code.length > 10;
    case 'code':
      return code.length >= 5;
    case 'html':
      return /<[a-z][\s\S]*>/i.test(code);
    case 'svg':
      return /<svg\b[\s\S]*<\/svg>/i.test(code);
    case 'react':
      return /(function|class|const|import|export|jsx|render|App|ReactDOM)/i.test(code);
    case 'deck':
      return looksLikeDeckSpec(code);
    case 'document':
      return looksLikeDocSpec(code);
    default:
      return KROKI_RENDERABLE.has(type as string) ? code.length >= 5 : false;
  }
}

export function looksLikeVegaSpec(code: string): boolean {
  try {
    const parsed = JSON.parse(code);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const schema = typeof parsed.$schema === 'string' ? parsed.$schema.toLowerCase() : '';
    if (schema.includes('vega.github.io/schema')) return true;
    return Boolean(
      parsed.mark ||
      parsed.encoding ||
      parsed.layer ||
      parsed.hconcat ||
      parsed.vconcat ||
      parsed.facet ||
      parsed.spec ||
      (parsed.data && (parsed.scales || parsed.axes || parsed.marks)),
    );
  } catch {
    return false;
  }
}

function balanced(value: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === open) depth++;
    if (char === close) depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
