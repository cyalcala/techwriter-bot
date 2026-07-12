// Deck artifact contract: the LLM emits strict JSON against hand-crafted
// layouts; design quality lives in the templates, not the model.
// Strategy: docs/VIDEO_PRESENTATION_STRATEGY.md (7-8 slide hard cap).
import { salvageObjectArrayByKeys, salvageFirstObjectArray, salvageStringField, arrayHasTextContent } from './json-salvage';

const SLIDE_KEYS = ['slides', 'slideList', 'pages', 'cards'];

export const DECK_MAX_SLIDES = 8;

export const DECK_LAYOUTS = [
  'title',
  'agenda',
  'bullets',
  'two-column',
  'stat',
  'quote',
  'code',
  'closing',
] as const;

export type DeckLayout = (typeof DECK_LAYOUTS)[number];

export interface DeckSlide {
  layout: DeckLayout;
  data: Record<string, unknown>;
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
}

const LAYOUT_SET = new Set<string>(DECK_LAYOUTS);

const LAYOUT_ALIASES: Record<string, DeckLayout> = {
  cover: 'title',
  intro: 'title',
  toc: 'agenda',
  outline: 'agenda',
  content: 'bullets',
  list: 'bullets',
  text: 'bullets',
  columns: 'two-column',
  comparison: 'two-column',
  split: 'two-column',
  number: 'stat',
  metric: 'stat',
  'big-stat': 'stat',
  callout: 'quote',
  snippet: 'code',
  end: 'closing',
  thanks: 'closing',
  summary: 'closing',
};

function stripFence(code: string): string {
  const match = code.match(/^\s*```[^\r\n`]*\r?\n([\s\S]*?)\r?\n?```\s*$/);
  return (match ? match[1] : code).trim();
}

function extractJsonObject(code: string): string {
  const start = code.indexOf('{');
  const end = code.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return code;
  return code.slice(start, end + 1);
}

function tryParse(text: string): unknown | null {
  try { return JSON.parse(text); } catch { return null; }
}

// Parse with the lenient fallbacks free-tier models need: outer fences,
// prose around the object, trailing commas.
export function parseDeckSpec(rawCode: string): unknown | null {
  const stripped = stripFence(String(rawCode ?? ''));
  return tryParse(stripped)
    ?? tryParse(extractJsonObject(stripped))
    ?? tryParse(extractJsonObject(stripped).replace(/,\s*([}\]])/g, '$1'));
}

function normalizeSlide(raw: unknown): DeckSlide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const slide = raw as Record<string, unknown>;
  const rawLayout = String(slide.layout ?? '').trim().toLowerCase();
  const layout: DeckLayout = LAYOUT_SET.has(rawLayout)
    ? rawLayout as DeckLayout
    : LAYOUT_ALIASES[rawLayout] ?? 'bullets';
  const data = slide.data && typeof slide.data === 'object' && !Array.isArray(slide.data)
    ? slide.data as Record<string, unknown>
    : {};
  return { layout, data };
}

// Validate + repair into a renderable spec, or null when unsalvageable.
// Unknown layouts coerce to 'bullets'; slides beyond DECK_MAX_SLIDES are
// dropped (the cap is a strict product decision, enforced in code, not
// just in the prompt). Truncated model output (cut off by the token limit)
// is salvaged so a partial deck still renders instead of erroring.
export function repairDeckSpec(rawCode: string): DeckSpec | null {
  const stripped = stripFence(String(rawCode ?? ''));
  const parsed = parseDeckSpec(rawCode);
  const obj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : null;

  // 1) top-level array of slides; 2) a known slides-array key; 3) salvage
  // that key from truncated JSON; 4) any array of objects anywhere.
  let rawSlides: unknown[] | null = Array.isArray(parsed) ? parsed as unknown[] : null;
  if (!rawSlides && obj) {
    for (const k of SLIDE_KEYS) { if (Array.isArray(obj[k])) { rawSlides = obj[k] as unknown[]; break; } }
  }
  if (!rawSlides || rawSlides.length === 0) {
    const salvaged = salvageObjectArrayByKeys(stripped, SLIDE_KEYS);
    if (salvaged.length) rawSlides = salvaged;
  }
  if (!rawSlides || rawSlides.length === 0) {
    const any = salvageFirstObjectArray(stripped, arrayHasTextContent);
    if (any.length) rawSlides = any;
  }
  if (!rawSlides || rawSlides.length === 0) return null;

  const slides = rawSlides
    .map(normalizeSlide)
    .filter((s): s is DeckSlide => s !== null)
    .slice(0, DECK_MAX_SLIDES);
  if (slides.length === 0) return null;

  const rawTitle = obj?.title;
  const title = (typeof rawTitle === 'string' && rawTitle.trim())
    ? rawTitle.trim()
    : (rawTitle && typeof rawTitle === 'object' && !Array.isArray(rawTitle) && typeof (rawTitle as any).heading === 'string' && (rawTitle as any).heading.trim())
      ? (rawTitle as any).heading.trim()
      : (salvageStringField(stripped, 'title') || 'Presentation');
  const rawSub = obj?.subtitle;
  const subtitle = typeof rawSub === 'string' && rawSub.trim() ? rawSub.trim() : undefined;

  return { title, subtitle, slides };
}

export function looksLikeDeckSpec(code: string): boolean {
  const parsed = parseDeckSpec(code);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.slides) && obj.slides.length > 0
    && obj.slides.every(s => !!s && typeof s === 'object');
}
