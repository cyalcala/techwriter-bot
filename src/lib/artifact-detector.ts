import type { Artifact, ArtifactType } from './stream-parser';
import { detectCodeLanguage, getDefaultArtifactTitle, normalizeArtifactType, validateArtifact } from './artifact-types';
import { generateArtifactId } from './artifact-lifecycle';

interface RawArtifact {
  type: ArtifactType;
  title: string;
  code: string;
  confidence: 'tag' | 'fence' | 'heuristic';
}

export function detectAllArtifacts(text: string, streamArtifacts: Artifact[]): { artifacts: Artifact[]; cleanText: string } {
  if (text.length < 50 && streamArtifacts.length === 0 && !/(<artifact\b|```)/i.test(text)) {
    return { artifacts: [], cleanText: text.trim() };
  }

  const found: RawArtifact[] = [];
  let clean = text;

  clean = clean.replace(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact\s*>/gi, (full, attrsRaw: string, body: string) => {
    const attrs = parseAttributes(attrsRaw);
    const code = String(body || '').trim();
    const type = normalizeArtifactType(attrs.type, code);
    if (type && code && validateArtifact(type, code)) {
      found.push({
        type,
        title: attrs.title || getDefaultArtifactTitle(type, attrs.language),
        code,
        confidence: 'tag',
      });
      return '';
    }
    return full;
  });

  clean = clean.replace(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g, (full, rawLang: string, body: string) => {
    const lang = (rawLang || '').trim().toLowerCase();
    const code = String(body || '').trim();
    const type = normalizeArtifactType(lang, code);
    if (type && code && validateArtifact(type, code) && !found.some(f => f.type === type && f.code === code)) {
      found.push({
        type,
        title: getDefaultArtifactTitle(type, type === 'code' ? lang : undefined),
        code,
        confidence: 'fence',
      });
      return '';
    }
    return full;
  });

  const dotRe = /\b(?:digraph|graph)\s+\w+\s*\{[\s\S]+?\}/gi;
  clean = clean.replace(dotRe, (code: string) => {
    if (validateArtifact('graphviz', code) && !found.some(f => f.code === code)) {
      found.push({ type: 'graphviz', title: 'Graphviz Diagram', code, confidence: 'heuristic' });
      return '';
    }
    return code;
  });

  clean = clean.replace(/<\/?artifact[^>]*>/gi, '');

  if (streamArtifacts.length > 0) {
    for (const sa of streamArtifacts) {
      if (!sa?.id || !sa?.type || !sa?.code) continue;
      if (!validateArtifact(sa.type, sa.code)) continue;
      found.unshift({ type: sa.type, title: sa.title || getDefaultArtifactTitle(sa.type, sa.language), code: sa.code, confidence: 'tag' });
    }
  }

  const seen = new Set<string>();
  const artifacts: Artifact[] = [];
  for (const f of found) {
    if (!f.type || !f.code) continue;
    const key = `${f.type}:${f.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push({
      id: generateArtifactId(f.type, f.code),
      type: f.type,
      title: f.title || getDefaultArtifactTitle(f.type),
      placement: 'inline',
      code: f.code,
      language: f.type === 'code' ? detectCodeLanguage(f.code) : undefined,
    });
  }

  return { artifacts, cleanText: clean.trim() };
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}
