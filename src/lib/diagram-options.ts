import { DIAGRAM_OPTIONS, type DiagramChoicePayload, type DiagramOption, type DiagramPlan, type DiagramType } from './path-router';

const DIAGRAM_TYPES = new Set<DiagramType>(DIAGRAM_OPTIONS.map((option) => option.type));
const DIAGRAM_OPTIONS_TAG_RE = /<diagram-options\b[^>]*>([\s\S]*?)<\/diagram-options>/gi;

export interface ExtractedDiagramOptions {
  cleanText: string;
  payload: DiagramChoicePayload | null;
}

function boundedText(value: unknown, fallback: string, maxLength = 180): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeOption(value: unknown): DiagramOption | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DiagramOption>;
  if (typeof candidate.type !== 'string' || !DIAGRAM_TYPES.has(candidate.type as DiagramType)) return null;
  const canonical = DIAGRAM_OPTIONS.find((option) => option.type === candidate.type);
  if (!canonical) return null;
  return {
    type: canonical.type,
    label: boundedText(candidate.label, canonical.label, 60),
    description: boundedText(candidate.description, canonical.description, 180),
  };
}

function normalizePayload(value: unknown): DiagramChoicePayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DiagramChoicePayload> & Partial<DiagramPlan>;
  const recommended = typeof candidate.recommended === 'string' && DIAGRAM_TYPES.has(candidate.recommended as DiagramType)
    ? candidate.recommended as DiagramType
    : null;
  if (!recommended) return null;

  const rawOptions = Array.isArray(candidate.options) ? candidate.options : [];
  const seen = new Set<DiagramType>();
  const options = rawOptions
    .map(normalizeOption)
    .filter((option): option is DiagramOption => Boolean(option))
    .filter((option) => {
      if (seen.has(option.type)) return false;
      seen.add(option.type);
      return true;
    });
  const canonicalRecommended = DIAGRAM_OPTIONS.find((option) => option.type === recommended)!;

  // A choice plan from the server may omit the recommended option or return
  // options in an arbitrary order. Always put the recommended angle first and
  // fill in the remaining canonical choices so the UI remains predictable.
  const ordered = [
    canonicalRecommended,
    ...options,
    ...DIAGRAM_OPTIONS,
  ].filter((option, index, all) => all.findIndex((candidate) => candidate.type === option.type) === index);

  const confidenceValue = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
    ? Math.max(0, Math.min(1, candidate.confidence))
    : 0.5;

  return {
    schemaVersion: 1,
    kind: 'diagram-options',
    recommended,
    confidence: Number(confidenceValue.toFixed(2)),
    options: ordered,
    prompt: boundedText(candidate.prompt, 'Choose a visual angle, or use the recommended view.', 180),
  };
}

function parsePayload(raw: string): DiagramChoicePayload | null {
  const candidate = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!candidate) return null;
  try {
    return normalizePayload(JSON.parse(candidate));
  } catch {
    return null;
  }
}

/**
 * Extract a model-emitted diagram picker without allowing its JSON wrapper to
 * leak into the readable explanation. Invalid blocks are also removed so a
 * malformed model response never becomes the dominant UI content.
 */
export function extractDiagramOptions(text: string, choicePlan?: unknown): ExtractedDiagramOptions {
  let payload = normalizePayload(choicePlan);
  const cleanText = text.replace(DIAGRAM_OPTIONS_TAG_RE, (_whole, raw: string) => {
    const parsed = parsePayload(raw);
    if (parsed) payload = parsed;
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, payload };
}

export function diagramChoicePrompt(option: DiagramOption): string {
  return [
    `Create the ${option.label.toLowerCase()} diagram for the topic above.`,
    `Use the ${option.label.toLowerCase()} view: ${option.description.toLowerCase()}.`,
    'Keep the explanation concise and return it together with exactly one readable diagram artifact.',
  ].join(' ');
}
