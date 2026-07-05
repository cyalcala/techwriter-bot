// Client-side PPTX export for deck artifacts via PptxGenJS (MIT), lazy-
// loaded from the CSP-allowed jsdelivr CDN. The export is a faithful
// editable approximation of the HTML deck, not pixel-identical
// (docs/VIDEO_PRESENTATION_STRATEGY.md).
import type { DeckSlide, DeckSpec } from './deck-schema';
import { loadExternalScript } from './renderer-loader';

const PPTXGEN_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';

const TEXT = '1C1917';
const MUTED = '57534E';
const FAINT = 'A8A29E';
const ACCENT = 'D97706';

// LAYOUT_16x9 canvas is 10 x 5.625 inches.
const W = 10;
const H = 5.625;

function str(data: Record<string, unknown>, key: string, max = 200): string {
  const value = data[key];
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).slice(0, max);
}

function list(data: Record<string, unknown>, key: string, maxItems: number): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .slice(0, maxItems)
    .map(item => String(item).slice(0, 160));
}

function bullets(items: string[]): { text: string; options: Record<string, unknown> }[] {
  return items.map(text => ({ text, options: { bullet: { code: '2022' }, color: MUTED, breakLine: true } }));
}

function addHeading(slide: any, text: string, opts: Record<string, unknown> = {}) {
  if (!text) return;
  slide.addText(text, { x: 0.7, y: 0.55, w: W - 1.4, h: 0.7, fontSize: 22, bold: true, color: TEXT, ...opts });
}

function addSlideBody(slide: any, deckSlide: DeckSlide) {
  const d = deckSlide.data;
  switch (deckSlide.layout) {
    case 'title': {
      const kicker = str(d, 'kicker', 40);
      if (kicker) slide.addText(kicker.toUpperCase(), { x: 1, y: 1.5, w: W - 2, h: 0.4, fontSize: 12, bold: true, color: ACCENT, align: 'center', charSpacing: 3 });
      slide.addText(str(d, 'heading', 120) || 'Untitled', { x: 0.8, y: 2.1, w: W - 1.6, h: 1.1, fontSize: 32, bold: true, color: TEXT, align: 'center' });
      const sub = str(d, 'subheading');
      if (sub) slide.addText(sub, { x: 1.2, y: 3.3, w: W - 2.4, h: 0.8, fontSize: 15, color: MUTED, align: 'center' });
      break;
    }
    case 'agenda': {
      addHeading(slide, str(d, 'heading', 120) || 'Agenda');
      const items = list(d, 'items', 6);
      slide.addText(
        items.map((text, i) => ({ text: `${i + 1}   ${text}`, options: { color: MUTED, breakLine: true } })),
        { x: 0.9, y: 1.5, w: W - 1.8, h: H - 2.2, fontSize: 16, lineSpacing: 30, valign: 'top' },
      );
      break;
    }
    case 'bullets': {
      const icon = str(d, 'icon', 4);
      addHeading(slide, `${icon ? icon + '  ' : ''}${str(d, 'heading', 120)}`);
      slide.addText(bullets(list(d, 'bullets', 5)), { x: 0.9, y: 1.5, w: W - 1.8, h: H - 2.2, fontSize: 15, lineSpacing: 28, valign: 'top' });
      break;
    }
    case 'two-column': {
      addHeading(slide, str(d, 'heading', 120));
      const colW = (W - 1.8) / 2 - 0.2;
      slide.addText(str(d, 'leftTitle', 60).toUpperCase() || 'LEFT', { x: 0.9, y: 1.45, w: colW, h: 0.4, fontSize: 11, bold: true, color: ACCENT, charSpacing: 2 });
      slide.addText(bullets(list(d, 'leftItems', 4)), { x: 0.9, y: 1.95, w: colW, h: H - 2.6, fontSize: 13.5, lineSpacing: 24, valign: 'top' });
      slide.addText(str(d, 'rightTitle', 60).toUpperCase() || 'RIGHT', { x: 0.9 + colW + 0.4, y: 1.45, w: colW, h: 0.4, fontSize: 11, bold: true, color: ACCENT, charSpacing: 2 });
      slide.addText(bullets(list(d, 'rightItems', 4)), { x: 0.9 + colW + 0.4, y: 1.95, w: colW, h: H - 2.6, fontSize: 13.5, lineSpacing: 24, valign: 'top' });
      break;
    }
    case 'stat': {
      const heading = str(d, 'heading', 120);
      if (heading) slide.addText(heading, { x: 1, y: 1.1, w: W - 2, h: 0.5, fontSize: 15, color: MUTED, align: 'center' });
      slide.addText(str(d, 'value', 40) || '—', { x: 1, y: 1.9, w: W - 2, h: 1.2, fontSize: 48, bold: true, color: ACCENT, align: 'center' });
      const label = str(d, 'label');
      if (label) slide.addText(label, { x: 1, y: 3.2, w: W - 2, h: 0.5, fontSize: 15, bold: true, color: TEXT, align: 'center' });
      const context = str(d, 'context');
      if (context) slide.addText(context, { x: 1.4, y: 3.8, w: W - 2.8, h: 0.6, fontSize: 12, color: FAINT, align: 'center' });
      break;
    }
    case 'quote': {
      slide.addText(`“${str(d, 'text', 280)}”`, { x: 1.1, y: 1.6, w: W - 2.2, h: 1.8, fontSize: 20, italic: true, color: TEXT, align: 'center' });
      const attribution = str(d, 'attribution', 80);
      if (attribution) slide.addText(`— ${attribution}`, { x: 1.1, y: 3.6, w: W - 2.2, h: 0.5, fontSize: 13, color: FAINT, align: 'center' });
      break;
    }
    case 'code': {
      addHeading(slide, str(d, 'heading', 120));
      slide.addText(str(d, 'code', 900), {
        x: 0.9, y: 1.5, w: W - 1.8, h: H - 2.3,
        fontFace: 'Courier New', fontSize: 11, color: 'E7E5E4',
        fill: { color: '292524' }, valign: 'top',
      });
      break;
    }
    case 'closing': {
      slide.addText(str(d, 'heading', 120) || 'Thank you', { x: 0.8, y: 1.7, w: W - 1.6, h: 0.9, fontSize: 28, bold: true, color: TEXT, align: 'center' });
      const sub = str(d, 'subheading');
      if (sub) slide.addText(sub, { x: 1.2, y: 2.7, w: W - 2.4, h: 0.6, fontSize: 14, color: MUTED, align: 'center' });
      const items = list(d, 'items', 3);
      if (items.length) slide.addText(bullets(items), { x: 2.6, y: 3.4, w: W - 5.2, h: 1.4, fontSize: 13, lineSpacing: 24, valign: 'top' });
      break;
    }
    default:
      slide.addText(bullets(list(d, 'bullets', 5)), { x: 0.9, y: 1.5, w: W - 1.8, h: H - 2.2, fontSize: 15, lineSpacing: 28, valign: 'top' });
  }
}

export async function exportDeckToPptx(spec: DeckSpec, filenameBase: string): Promise<void> {
  await loadExternalScript(PPTXGEN_CDN);
  const PptxGenJS = (window as any).PptxGenJS;
  if (!PptxGenJS) throw new Error('PPTX library failed to load');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = spec.title;

  spec.slides.forEach((deckSlide, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const centered = deckSlide.layout === 'title' || deckSlide.layout === 'stat' || deckSlide.layout === 'quote' || deckSlide.layout === 'closing';
    if (!centered) slide.addShape('rect', { x: 0.7, y: 0, w: 0.55, h: 0.06, fill: { color: 'F59E0B' } });
    addSlideBody(slide, deckSlide);
    if (i > 0) slide.addText(spec.title.slice(0, 80), { x: 0.3, y: H - 0.4, w: 4, h: 0.3, fontSize: 9, color: FAINT });
    slide.addText(`${i + 1} / ${spec.slides.length}`, { x: W - 1.3, y: H - 0.4, w: 1, h: 0.3, fontSize: 9, color: FAINT, align: 'right' });
  });

  await pptx.writeFile({ fileName: `${filenameBase}.pptx` });
}
