/**
 * Contract for a checked-in Archify page. This is intentionally a reference
 * format, not a model-controlled HTML or URL format.
 */

export type ArchifyDiagramType = 'architecture' | 'workflow' | 'sequence' | 'dataflow' | 'lifecycle';

export const ARCHIFY_STATIC_DIAGRAMS = Object.freeze({
  'techwriter-architecture': {
    type: 'architecture' as const,
    title: 'Techwriter Bot delivery architecture',
    src: '/diagrams/techwriter-architecture.html',
  },
  'artifact-workflow': {
    type: 'workflow' as const,
    title: 'Artifact generation and rendering workflow',
    src: '/diagrams/artifact-workflow.html',
  },
  'chat-request-sequence': {
    type: 'sequence' as const,
    title: 'Chat request and provider failover sequence',
    src: '/diagrams/chat-request-sequence.html',
  },
  'context-dataflow': {
    type: 'dataflow' as const,
    title: 'Techwriter Bot context and answer data flow',
    src: '/diagrams/context-dataflow.html',
  },
  'provider-circuit-lifecycle': {
    type: 'lifecycle' as const,
    title: 'Provider circuit lifecycle',
    src: '/diagrams/provider-circuit-lifecycle.html',
  },
});

export type ArchifyDiagramId = keyof typeof ARCHIFY_STATIC_DIAGRAMS;

export interface ArchifyArtifactReference {
  schemaVersion: 1;
  diagramId: ArchifyDiagramId;
  diagramType: ArchifyDiagramType;
  title?: string;
}

export type ParseArchifyArtifactResult =
  | { ok: true; value: ArchifyArtifactReference }
  | { ok: false; error: string };

const MAX_REFERENCE_BYTES = 16 * 1024;
const ALLOWED_KEYS = new Set(['schemaVersion', 'diagramId', 'diagramType', 'title']);

export function parseArchifyArtifact(raw: string): ParseArchifyArtifactResult {
  if (typeof raw !== 'string' || raw.length > MAX_REFERENCE_BYTES) {
    return { ok: false, error: 'Archify references must be a small JSON object.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Archify reference is not valid JSON.' };
  }
  if (!isRecord(parsed)) return { ok: false, error: 'Archify reference must be a JSON object.' };

  const keys = Object.keys(parsed);
  if (keys.some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, error: 'Archify reference contains unsupported fields.' };
  }
  if (parsed.schemaVersion !== 1) return { ok: false, error: 'Archify reference must use schemaVersion 1.' };
  if (typeof parsed.diagramId !== 'string' || !hasDiagram(parsed.diagramId)) {
    return { ok: false, error: 'Archify reference names an unavailable static diagram.' };
  }

  const diagram = ARCHIFY_STATIC_DIAGRAMS[parsed.diagramId];
  if (parsed.diagramType !== diagram.type) {
    return { ok: false, error: 'Archify diagramType does not match the allowlisted diagram.' };
  }
  if (parsed.title !== undefined && (typeof parsed.title !== 'string' || parsed.title.trim().length === 0 || parsed.title.length > 120 || /[\u0000-\u001f]/.test(parsed.title))) {
    return { ok: false, error: 'Archify title must be a short printable string.' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      diagramId: parsed.diagramId,
      diagramType: diagram.type,
      ...(typeof parsed.title === 'string' ? { title: parsed.title.trim() } : {}),
    },
  };
}

export function validateArchifyArtifact(raw: string): boolean {
  return parseArchifyArtifact(raw).ok;
}

export function renderArchifyArtifactFrame(raw: string): string {
  const result = parseArchifyArtifact(raw);
  if (!result.ok) throw new Error(result.error);
  const diagram = ARCHIFY_STATIC_DIAGRAMS[result.value.diagramId];
  const title = result.value.title || diagram.title;
  return `<iframe title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" loading="lazy" src="${diagram.src}" class="artifact-frame artifact-frame-archify"></iframe>`;
}

function hasDiagram(value: string): value is ArchifyDiagramId {
  return Object.prototype.hasOwnProperty.call(ARCHIFY_STATIC_DIAGRAMS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
