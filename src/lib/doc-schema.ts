// Document artifact contract: the model emits a structured multi-section
// document as strict JSON; it renders as a rich artifact and exports to
// PDF / DOCX / Markdown. Strategy: docs/DOCUMENT_ARTIFACT_STRATEGY.md.
import { salvageObjectArrayByKeys, salvageFirstObjectArray, salvageStringField } from './json-salvage';

const BLOCK_KEYS = ['blocks', 'content', 'sections', 'body'];

export const DOC_MAX_BLOCKS = 60;
export const DOC_MAX_LIST_ITEMS = 24;
export const DOC_MAX_TABLE_ROWS = 24;
export const DOC_MAX_TABLE_COLS = 8;

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'code'; language?: string; code: string }
  | { type: 'quote'; text: string; attribution?: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

export interface DocSpec {
  title: string;
  subtitle?: string;
  blocks: DocBlock[];
}

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

export function parseDocSpec(rawCode: string): unknown | null {
  const stripped = stripFence(String(rawCode ?? ''));
  return tryParse(stripped)
    ?? tryParse(extractJsonObject(stripped))
    ?? tryParse(extractJsonObject(stripped).replace(/,\s*([}\]])/g, '$1'));
}

function str(value: unknown, max = 4000): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).slice(0, max);
}

function strList(value: unknown, maxItems: number, maxLen = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .slice(0, maxItems)
    .map(v => String(v).slice(0, maxLen));
}

function normalizeBlock(raw: unknown): DocBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const type = String(b.type ?? '').trim().toLowerCase();

  switch (type) {
    case 'heading': {
      const text = str(b.text, 300);
      if (!text) return null;
      const lvl = Number(b.level);
      const level = (lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 2) as 1 | 2 | 3;
      return { type: 'heading', level, text };
    }
    case 'paragraph': {
      const text = str(b.text);
      return text ? { type: 'paragraph', text } : null;
    }
    case 'bullets':
    case 'numbered': {
      const items = strList(b.items, DOC_MAX_LIST_ITEMS);
      return items.length ? { type: type as 'bullets' | 'numbered', items } : null;
    }
    case 'code': {
      const code = str(b.code, 6000);
      if (!code) return null;
      const language = str(b.language, 24) || undefined;
      return { type: 'code', language, code };
    }
    case 'quote': {
      const text = str(b.text, 1000);
      if (!text) return null;
      const attribution = str(b.attribution, 160) || undefined;
      return { type: 'quote', text, attribution };
    }
    case 'table': {
      const headers = strList(b.headers, DOC_MAX_TABLE_COLS, 120);
      const rawRows = Array.isArray(b.rows) ? b.rows : [];
      const rows = rawRows.slice(0, DOC_MAX_TABLE_ROWS)
        .map(r => strList(r, DOC_MAX_TABLE_COLS, 200))
        .filter(r => r.length > 0);
      if (headers.length === 0 && rows.length === 0) return null;
      return { type: 'table', headers, rows };
    }
    default: {
      // Unknown block: salvage any text as a paragraph.
      const text = str(b.text) || str(b.content);
      return text ? { type: 'paragraph', text } : null;
    }
  }
}

// Validate + repair into a renderable document, or null when unsalvageable.
export function repairDocSpec(rawCode: string): DocSpec | null {
  const stripped = stripFence(String(rawCode ?? ''));
  const parsed = parseDocSpec(rawCode);
  const obj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : null;

  let rawBlocks: unknown[] | null = Array.isArray(parsed) ? parsed as unknown[] : null;
  if (!rawBlocks && obj) {
    for (const k of BLOCK_KEYS) { if (Array.isArray(obj[k])) { rawBlocks = obj[k] as unknown[]; break; } }
  }
  if (!rawBlocks || rawBlocks.length === 0) {
    const salvaged = salvageObjectArrayByKeys(stripped, BLOCK_KEYS);
    if (salvaged.length) rawBlocks = salvaged;
  }
  if (!rawBlocks || rawBlocks.length === 0) {
    const any = salvageFirstObjectArray(stripped);
    if (any.length) rawBlocks = any;
  }
  if (!rawBlocks || rawBlocks.length === 0) return null;

  const blocks = rawBlocks
    .map(normalizeBlock)
    .filter((b): b is DocBlock => b !== null)
    .slice(0, DOC_MAX_BLOCKS);
  if (blocks.length === 0) return null;

  const title = (obj ? str(obj.title, 200).trim() : '') || salvageStringField(stripped, 'title') || 'Document';
  const subtitle = (obj ? str(obj.subtitle, 300).trim() : '') || undefined;
  return { title, subtitle, blocks };
}

export function looksLikeDocSpec(code: string): boolean {
  const parsed = parseDocSpec(code);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) return false;
  return obj.blocks.some(b => !!b && typeof b === 'object' && typeof (b as any).type === 'string');
}

export function docToMarkdown(spec: DocSpec): string {
  const out: string[] = [`# ${spec.title}`];
  if (spec.subtitle) out.push(`_${spec.subtitle}_`);
  for (const b of spec.blocks) {
    switch (b.type) {
      case 'heading': out.push(`${'#'.repeat(b.level + 1)} ${b.text}`); break;
      case 'paragraph': out.push(b.text); break;
      case 'bullets': out.push(b.items.map(i => `- ${i}`).join('\n')); break;
      case 'numbered': out.push(b.items.map((i, n) => `${n + 1}. ${i}`).join('\n')); break;
      case 'code': out.push('```' + (b.language || '') + '\n' + b.code + '\n```'); break;
      case 'quote': out.push(`> ${b.text}${b.attribution ? `\n>\n> — ${b.attribution}` : ''}`); break;
      case 'table': {
        if (b.headers.length) {
          out.push(`| ${b.headers.join(' | ')} |`);
          out.push(`| ${b.headers.map(() => '---').join(' | ')} |`);
        }
        for (const row of b.rows) out.push(`| ${row.join(' | ')} |`);
        break;
      }
    }
  }
  return out.join('\n\n') + '\n';
}
