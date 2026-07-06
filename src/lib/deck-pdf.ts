// Client-side PDF export for deck artifacts via jsPDF (MIT), lazy-loaded
// from a CSP-allowed CDN. Canvas is 720x405pt (= PptxGenJS LAYOUT_16x9's
// 10x5.625in at 72pt/in) so the deck-pptx layout coordinates and font
// sizes map here 1:1 (inches * 72). Faithful, not pixel-identical.
import type { DeckSlide, DeckSpec } from './deck-schema';
import { loadExternalScript } from './renderer-loader';

const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';

const IN = 72;
const W = 10 * IN;
const H = 5.625 * IN;

const TEXT: [number, number, number] = [28, 25, 23];
const MUTED: [number, number, number] = [87, 83, 74];
const FAINT: [number, number, number] = [168, 162, 158];
const ACCENT: [number, number, number] = [217, 119, 6];
const BAR: [number, number, number] = [245, 158, 11];
const CODE_BG: [number, number, number] = [41, 37, 36];
const CODE_FG: [number, number, number] = [231, 229, 228];

function str(data: Record<string, unknown>, key: string, max = 240): string {
  const value = data[key];
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).slice(0, max);
}

function list(data: Record<string, unknown>, key: string, maxItems: number): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .slice(0, maxItems)
    .map(v => String(v).slice(0, 200));
}

interface TextOpts {
  size?: number; color?: [number, number, number]; bold?: boolean;
  align?: 'left' | 'center'; maxWidth?: number; lineGap?: number;
}

function drawText(doc: any, text: string, x: number, y: number, o: TextOpts = {}): number {
  if (!text) return 0;
  const size = o.size ?? 15;
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...(o.color ?? TEXT));
  const maxWidth = o.maxWidth ?? W - 2 * 0.7 * IN;
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y, { align: o.align ?? 'left', baseline: 'top', lineHeightFactor: 1.3 });
  const lineHeight = size * 1.3;
  return lines.length * lineHeight + (o.lineGap ?? 0);
}

function drawBullets(doc: any, items: string[], x: number, y: number, size = 15, maxWidth = W - 2.4 * IN): number {
  let cursor = y;
  for (const item of items) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...ACCENT);
    doc.text('•', x, cursor, { baseline: 'top' });
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(item, maxWidth - 16);
    doc.text(lines, x + 16, cursor, { baseline: 'top', lineHeightFactor: 1.3 });
    cursor += Math.max(size * 1.3, lines.length * size * 1.3) + 6;
  }
  return cursor - y;
}

function isCentered(layout: string): boolean {
  return layout === 'title' || layout === 'stat' || layout === 'quote' || layout === 'closing';
}

function renderSlide(doc: any, slide: DeckSlide) {
  const d = slide.data;
  const cx = W / 2;
  const left = 0.9 * IN;
  const contentW = W - 1.8 * IN;

  if (!isCentered(slide.layout)) {
    doc.setFillColor(...BAR);
    doc.rect(0.7 * IN, 0, 0.55 * IN, 0.06 * IN, 'F');
  }

  switch (slide.layout) {
    case 'title': {
      const kicker = str(d, 'kicker', 40);
      if (kicker) drawText(doc, kicker.toUpperCase(), cx, 1.5 * IN, { size: 12, bold: true, color: ACCENT, align: 'center' });
      drawText(doc, str(d, 'heading', 120) || 'Untitled', cx, 2.1 * IN, { size: 30, bold: true, color: TEXT, align: 'center', maxWidth: W - 1.6 * IN });
      drawText(doc, str(d, 'subheading'), cx, 3.35 * IN, { size: 15, color: MUTED, align: 'center', maxWidth: W - 2.4 * IN });
      break;
    }
    case 'agenda': {
      drawText(doc, str(d, 'heading', 120) || 'Agenda', left, 0.6 * IN, { size: 22, bold: true });
      let y = 1.5 * IN;
      list(d, 'items', 6).forEach((item, i) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...ACCENT);
        doc.text(String(i + 1), left, y, { baseline: 'top' });
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
        const lines = doc.splitTextToSize(item, contentW - 24);
        doc.text(lines, left + 24, y, { baseline: 'top', lineHeightFactor: 1.3 });
        y += Math.max(28, lines.length * 21) + 6;
      });
      break;
    }
    case 'bullets': {
      const icon = str(d, 'icon', 4);
      drawText(doc, `${icon ? icon + '  ' : ''}${str(d, 'heading', 120)}`, left, 0.55 * IN, { size: 22, bold: true });
      drawBullets(doc, list(d, 'bullets', 5), left, 1.5 * IN, 15, contentW);
      break;
    }
    case 'two-column': {
      drawText(doc, str(d, 'heading', 120), left, 0.55 * IN, { size: 22, bold: true });
      const colW = contentW / 2 - 14;
      const rightX = left + colW + 28;
      drawText(doc, (str(d, 'leftTitle', 60) || 'Left').toUpperCase(), left, 1.45 * IN, { size: 11, bold: true, color: ACCENT });
      drawBullets(doc, list(d, 'leftItems', 4), left, 1.9 * IN, 13, colW);
      drawText(doc, (str(d, 'rightTitle', 60) || 'Right').toUpperCase(), rightX, 1.45 * IN, { size: 11, bold: true, color: ACCENT });
      drawBullets(doc, list(d, 'rightItems', 4), rightX, 1.9 * IN, 13, colW);
      break;
    }
    case 'stat': {
      drawText(doc, str(d, 'heading', 120), cx, 1.1 * IN, { size: 15, color: MUTED, align: 'center' });
      drawText(doc, str(d, 'value', 40) || '—', cx, 1.85 * IN, { size: 46, bold: true, color: ACCENT, align: 'center' });
      drawText(doc, str(d, 'label'), cx, 3.15 * IN, { size: 15, bold: true, color: TEXT, align: 'center' });
      drawText(doc, str(d, 'context'), cx, 3.75 * IN, { size: 12, color: FAINT, align: 'center', maxWidth: W - 2.8 * IN });
      break;
    }
    case 'quote': {
      drawText(doc, `“${str(d, 'text', 280)}”`, cx, 1.7 * IN, { size: 20, color: TEXT, align: 'center', maxWidth: W - 2.2 * IN });
      const attribution = str(d, 'attribution', 80);
      if (attribution) drawText(doc, `— ${attribution}`, cx, 3.5 * IN, { size: 13, color: FAINT, align: 'center' });
      break;
    }
    case 'code': {
      drawText(doc, str(d, 'heading', 120), left, 0.55 * IN, { size: 18, bold: true });
      const code = str(d, 'code', 900);
      doc.setFillColor(...CODE_BG);
      doc.rect(left, 1.4 * IN, contentW, H - 1.9 * IN, 'F');
      doc.setFont('courier', 'normal'); doc.setFontSize(11); doc.setTextColor(...CODE_FG);
      const lines = doc.splitTextToSize(code, contentW - 24);
      doc.text(lines.slice(0, 16), left + 12, 1.4 * IN + 14, { baseline: 'top', lineHeightFactor: 1.4 });
      break;
    }
    case 'closing': {
      drawText(doc, str(d, 'heading', 120) || 'Thank you', cx, 1.7 * IN, { size: 26, bold: true, color: TEXT, align: 'center', maxWidth: W - 1.6 * IN });
      drawText(doc, str(d, 'subheading'), cx, 2.6 * IN, { size: 14, color: MUTED, align: 'center', maxWidth: W - 2.4 * IN });
      const items = list(d, 'items', 3);
      if (items.length) drawBullets(doc, items, cx - 1.4 * IN, 3.3 * IN, 13, 2.8 * IN);
      break;
    }
    default:
      drawBullets(doc, list(d, 'bullets', 5), left, 1.5 * IN, 15, contentW);
  }
}

export async function exportDeckToPdf(spec: DeckSpec, filenameBase: string): Promise<void> {
  await loadExternalScript(JSPDF_CDN);
  const JsPDF = (window as any).jspdf?.jsPDF;
  if (!JsPDF) throw new Error('PDF library failed to load');

  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H] });

  spec.slides.forEach((slide, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape');
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, W, H, 'F');
    renderSlide(doc, slide);
    // footer
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...FAINT);
    if (i > 0) doc.text(spec.title.slice(0, 80), 0.3 * IN, H - 0.28 * IN, { baseline: 'top' });
    doc.text(`${i + 1} / ${spec.slides.length}`, W - 0.3 * IN, H - 0.28 * IN, { align: 'right', baseline: 'top' });
  });

  doc.save(`${filenameBase}.pdf`);
}
