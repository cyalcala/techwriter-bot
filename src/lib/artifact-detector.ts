import type { Artifact, ArtifactType } from './stream-parser';

interface RawArtifact {
  type: ArtifactType;
  title: string;
  code: string;
  confidence: 'tag' | 'fence' | 'heuristic' | 'stray';
}

const STRAY_DIAGRAM_STARTS = /\b(graph\s+(TB|TD|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|flowchart\s+(TB|TD|BT|RL|LR)|gitgraph|mindmap|timeline|quadrantChart|block\-beta|requirementDiagram|C4Context|C4Container)\b/i;

function scanStrayDiagramBlock(text: string, startIdx: number): { code: string; type: ArtifactType; end: number } | null {
  const rest = text.slice(startIdx);
  const lines = rest.split('\n');
  const block: string[] = [];
  let i = 0;
  for (const line of lines) {
    if (line.trim() === '' && i > 1) break;
    if (i > 0 && /^(Here|This |The |Let me|I've |Above|Now you|You can|Would |Feel|Note|If you|For more|Check|See |Can I|Hope|Great|Below|Try|Copy|Paste|Run |The above)/i.test(line.trim())) break;
    block.push(line);
    i++;
  }
  const code = block.join('\n').trim();
  if (code.length < 20) return null;
  
  let type: ArtifactType;
  if (/@startuml/i.test(code)) type = 'plantuml';
  else if (/\b(?:digraph|graph)\s+\w+\s*\{/.test(code)) type = 'graphviz';
  else if (/\b(?:shape|style|label|direction):/.test(code) || /(?:->|<->|--)/.test(code)) type = 'd2';
  else type = 'mermaid';
  
  return { code, type, end: startIdx + code.length };
}

export function detectStrayDiagrams(text: string): { artifacts: RawArtifact[]; cleanText: string } {
  const found: RawArtifact[] = [];
  let clean = text;
  
  const plantUmlRe = /@startuml\s*\n([\s\S]*?)@enduml/gi;
  let umlMatch;
  while ((umlMatch = plantUmlRe.exec(clean)) !== null) {
    const code = umlMatch[0];
    if (code.length > 20) {
      found.push({ type: 'plantuml', title: 'PlantUML Diagram', code, confidence: 'stray' });
      clean = clean.replace(umlMatch[0], '');
    }
  }
  
  const dotRe = /(?:digraph|graph)\s+\w+\s*\{[\s\S]+?\}/gi;
  let dotMatch;
  while ((dotMatch = dotRe.exec(clean)) !== null) {
    const code = dotMatch[0];
    if (code.length > 30 && !found.some(f => f.code === code)) {
      found.push({ type: 'graphviz', title: 'Graphviz Diagram', code, confidence: 'stray' });
      clean = clean.replace(dotMatch[0], '');
    }
  }
  
  let searchIdx = 0;
  while (searchIdx < clean.length) {
    const slice = clean.slice(searchIdx);
    const m = STRAY_DIAGRAM_STARTS.exec(slice);
    if (!m) break;
    const localIdx = m.index;
    const prevChar = localIdx > 0 ? slice[localIdx - 1] : '\n';
    if (prevChar !== '\n' && prevChar !== '\r' && prevChar !== undefined && localIdx !== 0) {
      searchIdx += localIdx + m[0].length;
      continue;
    }
    const block = scanStrayDiagramBlock(clean, searchIdx + localIdx);
    if (block && !found.some(f => f.code === block.code)) {
      found.push({ type: block.type, title: `${block.type.charAt(0).toUpperCase() + block.type.slice(1)} Diagram`, code: block.code, confidence: 'stray' });
      clean = clean.slice(0, searchIdx + localIdx) + clean.slice(block.end);
    } else {
      searchIdx++;
    }
  }
  
  return { artifacts: found, cleanText: clean };
}

export function detectAllArtifacts(text: string, streamArtifacts: Artifact[]): { artifacts: Artifact[]; cleanText: string } {
  if (text.length < 50 && streamArtifacts.length === 0) {
    return { artifacts: [], cleanText: text.trim() };
  }

  const found: RawArtifact[] = [];
  let clean = text;

  const tagRe = /<\w*rtifact\s+type="(\w+)"(?:\s+placement="(\w+)")?(?:\s+title="([^"]*)")?(?:\s+language="([^"]*)")?\s*>([\s\S]*?)<\/\w*rtifact\s*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(text)) !== null) {
    const type = normalizeType(tagMatch[1]);
    const title = tagMatch[3] || `${type} Diagram`;
    const code = tagMatch[5].trim();
    if (type && code) {
      found.push({ type, title, code, confidence: 'tag' });
      clean = clean.replace(tagMatch[0], '');
    }
  }

  const streamIds = new Set(streamArtifacts.map(a => a.id));
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

  clean = clean.replace(/<[\/]?\w*rtifact[^>]*>/gi, '');

  const strayResult = detectStrayDiagrams(clean);
  for (const sa of strayResult.artifacts) {
    if (!found.some(f => f.type === sa.type && f.code === sa.code)) {
      found.push(sa);
    }
  }
  clean = strayResult.cleanText;

  if (streamArtifacts.length > 0) {
    for (const sa of streamArtifacts) {
      if (!streamIds.has(sa.id)) continue;
      found.unshift({ type: sa.type, title: sa.title || '', code: sa.code, confidence: 'tag' });
    }
  }

  const seen = new Set<string>();
  const artifacts: Artifact[] = [];
  for (const f of found) {
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
  if (!code || code.trim().length < 5) return false;
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
