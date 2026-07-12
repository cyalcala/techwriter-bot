import type { Artifact, ArtifactType } from './stream-parser';
import { normalizeArtifactSource } from './diagram-source-normalizer';
import { normalizeArtifactType, validateArtifact, getDefaultArtifactTitle, detectCodeLanguage } from './artifact-types';

interface RawArtifact {
  type: ArtifactType;
  title: string;
  code: string;
  confidence: 'tag' | 'fence' | 'heuristic';
}

// Legacy runtime types that no longer render; degrade to inert code so old
// exported sessions still open. Mirrors INERT_LEGACY_TYPES in stream-parser.
const INERT_LEGACY_TYPES = new Set(['webcontainer', 'webcontainers']);

// Resolve a raw type/lang token (plus its content, needed to disambiguate a
// bare `json` fence into vega/deck/document/none) to a supported artifact type.
// This delegates to the canonical classifier in artifact-types.ts so the
// post-stream fallback stays in lockstep with the streaming tag path — the two
// used to diverge (e.g. this file blindly mapped every `json` block to vega).
function resolveType(raw: string, code: string): ArtifactType | null {
  return normalizeArtifactType(raw, code) ?? (INERT_LEGACY_TYPES.has(raw.trim().toLowerCase()) ? 'code' : null);
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
    const typeMatch = openTag.match(/\btype\s*=\s*"([\w-]+)"/i);
    const titleMatch = openTag.match(/\btitle\s*=\s*"([^"]*)"/i);
    const title = titleMatch ? titleMatch[1] : null;
    const closeTag = `</artifact>`;
    const closeIdx = clean.indexOf(closeTag, openEnd);
    if (closeIdx === -1) { searchFrom = openEnd + 1; continue; }
    const code = clean.slice(openEnd + 1, closeIdx).trim();
    const type = typeMatch && code ? resolveType(typeMatch[1], code) : null;
    if (type && code) {
      found.push({ type, title: title || getDefaultArtifactTitle(type), code, confidence: 'tag' });
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
    const type = code ? resolveType(lang, code) : null;
    if (type && code && !found.some(f => f.type === type && f.code === code)) {
      found.push({ type, title: getDefaultArtifactTitle(type), code, confidence: 'fence' });
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
    const code = normalizeArtifactSource(f.type, f.code);
    if (!validateArtifact(f.type, code)) continue;
    const key = `${f.type}:${code.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push({
      id: `${f.type}-${Date.now().toString(36)}-${artifacts.length}`,
      type: f.type,
      title: f.title || getDefaultArtifactTitle(f.type),
      placement: 'inline',
      code,
      language: f.type === 'code' ? detectCodeLanguage(code) : undefined,
    });
  }

  return { artifacts, cleanText: clean.trim() };
}
