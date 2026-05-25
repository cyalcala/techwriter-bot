import type { Artifact, ArtifactType } from './stream-parser';

interface RawArtifact {
  type: ArtifactType;
  title: string;
  code: string;
  confidence: 'tag' | 'fence' | 'heuristic';
}

export function detectAllArtifacts(text: string, streamArtifacts: Artifact[]): { artifacts: Artifact[]; cleanText: string } {
  if (text.length < 50 && streamArtifacts.length === 0) {
    return { artifacts: [], cleanText: text.trim() };
  }

  const found: RawArtifact[] = [];
  let clean = text;

  let searchFrom = 0;
  while (true) {
    const openStart = clean.indexOf('<artifact', searchFrom);
    if (openStart === -1) break;
    const openEnd = clean.indexOf('>', openStart);
    if (openEnd === -1) break;
    const openTag = clean.slice(openStart, openEnd + 1);
    const typeMatch = openTag.match(/\btype\s*=\s*"(\w+)"/i);
    const titleMatch = openTag.match(/\btitle\s*=\s*"([^"]*)"/i);
    const type = typeMatch ? normalizeType(typeMatch[1]) : null;
    const title = titleMatch ? titleMatch[1] : null;
    const closeTag = `</artifact>`;
    const closeIdx = clean.indexOf(closeTag, openEnd);
    if (closeIdx === -1) { searchFrom = openEnd + 1; continue; }
    const code = clean.slice(openEnd + 1, closeIdx).trim();
    if (type && code) {
      found.push({ type, title: title || `${type} Diagram`, code, confidence: 'tag' });
      clean = clean.slice(0, openStart) + clean.slice(closeIdx + closeTag.length);
      searchFrom = openStart;
    } else {
      searchFrom = openEnd + 1;
    }
  }

  const streamIds = new Set(streamArtifacts.map(a => a?.id).filter(Boolean));
  const fenceRe = /```(\w[\w-]*)?\n([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(clean)) !== null) {
    const lang = (fenceMatch[1] || '').toLowerCase();
    const code = fenceMatch[2].trim();
    const type = langToType(lang);
    if (type && code && !found.some(f => f.type === type && f.code === code)) {
      const title = lang ? `${lang.toUpperCase()} Diagram` : 'Code Block';
      found.push({ type, title, code, confidence: 'fence' });
      clean = clean.replace(fenceMatch[0], '');
      fenceRe.lastIndex = 0;
    }
  }

  const dotRe = /\b(?:digraph|graph)\s+\w+\s*\{[\s\S]+?\}/gi;
  let dotMatch: RegExpExecArray | null;
  while ((dotMatch = dotRe.exec(clean)) !== null) {
    const code = dotMatch[0];
    if (code.length > 30 && !found.some(f => f.code === code)) {
      found.push({ type: 'graphviz', title: 'Graphviz Diagram', code, confidence: 'heuristic' });
      clean = clean.replace(dotMatch[0], '');
    }
  }

  clean = clean.replace(/<\/?artifact[^>]*>/gi, '');

  if (streamArtifacts.length > 0) {
    for (const sa of streamArtifacts) {
      if (!sa?.id || !sa?.type || !sa?.code) continue;
      if (!streamIds.has(sa.id)) continue;
      found.unshift({ type: sa.type, title: sa.title || '', code: sa.code, confidence: 'tag' });
    }
  }

  const seen = new Set<string>();
  const artifacts: Artifact[] = [];
  for (const f of found) {
    if (!f.type || !f.code) continue;
    if (!validateArtifact(f.type, f.code)) continue;
    const key = `${f.type}:${f.code.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push({
      id: `${f.type}-${Date.now().toString(36)}-${artifacts.length}`,
      type: f.type,
      title: f.title || `${f.type} Diagram`,
      placement: 'inline',
      code: f.code,
      language: f.type === 'code' ? detectLang(f.code) : undefined,
    });
  }

  return { artifacts, cleanText: clean.trim() };
}

function langToType(lang: string): ArtifactType | null {
  switch (lang) {
    case 'code': return 'code';
    case 'html': case 'htm': return 'html';
    case 'svg': return 'svg';
    case 'mermaid': return 'mermaid';
    case 'jsx': case 'tsx': case 'react': return 'react';
    case 'graphviz': case 'dot': return 'graphviz';
    case 'd2': return 'd2';
    case 'plantuml': case 'puml': return 'plantuml';
    case 'katex': case 'latex': case 'tex': return 'katex';
    case 'vega': case 'vega-lite': case 'json': return 'vega';
    case 'flowchart': return 'flowchart';
    case 'markmap': case 'md': return 'markmap';
    case 'webcontainer': return 'webcontainer';
    case 'python': case 'javascript': case 'typescript': case 'js': case 'ts':
    case 'bash': case 'sh': case 'css': case 'sql': case 'go': case 'rust':
    case 'java': case 'cpp': case 'c': return 'code';
    default: return null;
  }
}

function normalizeType(raw: string): ArtifactType | null {
  return langToType(raw);
}

function detectLang(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/def\s|class\s|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

function validateArtifact(type: ArtifactType, code: string): boolean {
  if (!type || !code || code.trim().length < 5) return false;
  switch (type) {
    case 'mermaid':
      return /(graph\s+(TB|TD|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|flowchart|gitgraph|mindmap|timeline|quadrantChart|block-beta|requirementDiagram|C4Context|C4Container)/i.test(code);
    case 'graphviz':
      return /\b(digraph|graph|strict)\s+\w+\s*\{/i.test(code) && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length;
    case 'd2':
      return /(?:->|<->|--|\.shape|\.style|\.label)/.test(code) && code.length > 20;
    case 'plantuml':
      return /@startuml/i.test(code) && /@enduml/i.test(code);
    case 'katex':
      return /[\\\^_{}]/.test(code) || /\\\w+/.test(code);
    case 'vega':
      try { JSON.parse(code); return true; } catch { return false; }
    case 'webcontainer':
      try { const p = JSON.parse(code); return !!p.files && Object.keys(p.files).length > 0; } catch { return false; }
    case 'flowchart':
      return /=>|->|:>/.test(code) && code.length > 30;
    case 'markmap':
      return /^#+\s/m.test(code) && code.length > 20;
    case 'code':
      return code.trim().length >= 5;
    case 'html':
      return /<[a-z][\s\S]*>/i.test(code);
    case 'svg':
      return /<svg[\s\S]*<\/svg>/i.test(code);
    case 'react':
      return /(function|class|const|import|export|jsx|render|App)/i.test(code);
    default:
      return true;
  }
}
