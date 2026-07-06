// Client-side PDF export for document artifacts via jsPDF (MIT), lazy-
// loaded from a CSP-allowed CDN. Flowing A4 layout with line-level
// pagination. Strategy: docs/DOCUMENT_ARTIFACT_STRATEGY.md.
import type { DocBlock, DocSpec } from './doc-schema';
import { loadExternalScript } from './renderer-loader';

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const ML = 56, MR = 56, MT = 64, MB = 56;
const CONTENT_W = PAGE_W - ML - MR;

const TEXT: [number, number, number] = [28, 25, 23];
const MUTED: [number, number, number] = [64, 60, 56];
const FAINT: [number, number, number] = [140, 133, 128];
const ACCENT: [number, number, number] = [217, 119, 6];
const BORDER: [number, number, number] = [214, 211, 209];
const CODE_BG: [number, number, number] = [245, 245, 244];
const CODE_FG: [number, number, number] = [41, 37, 36];

const HEADING_SIZE: Record<number, number> = { 1: 17, 2: 14, 3: 12 };

export async function exportDocToPdf(spec: DocSpec, filenameBase: string): Promise<void> {
  await loadExternalScript(JSPDF_CDN);
  const JsPDF = (window as any).jspdf?.jsPDF;
  if (!JsPDF) throw new Error('PDF library failed to load');

  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  let y = MT;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - MB) { doc.addPage(); y = MT; }
  };

  const writeWrapped = (
    text: string, size: number, color: [number, number, number],
    opts: { bold?: boolean; mono?: boolean; italic?: boolean; x?: number; width?: number; gapAfter?: number } = {},
  ) => {
    const x = opts.x ?? ML;
    const width = opts.width ?? CONTENT_W;
    const family = opts.mono ? 'courier' : 'helvetica';
    const style = opts.bold ? 'bold' : opts.italic ? 'italic' : 'normal';
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lineH = size * 1.45;
    const lines = doc.splitTextToSize(text, width);
    for (const line of lines) {
      ensure(lineH);
      doc.text(line, x, y, { baseline: 'top' });
      y += lineH;
    }
    y += opts.gapAfter ?? 0;
  };

  const listItems = (items: string[], ordered: boolean) => {
    items.forEach((item, i) => {
      const marker = ordered ? `${i + 1}.` : '•';
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...ACCENT);
      const lineH = 11 * 1.45;
      ensure(lineH);
      doc.text(marker, ML + 6, y, { baseline: 'top' });
      writeWrapped(item, 11, MUTED, { x: ML + 26, width: CONTENT_W - 26, gapAfter: 3 });
    });
    y += 6;
  };

  const renderBlock = (b: DocBlock) => {
    switch (b.type) {
      case 'heading':
        y += 8;
        writeWrapped(b.text, HEADING_SIZE[b.level] || 14, TEXT, { bold: true, gapAfter: 4 });
        break;
      case 'paragraph':
        writeWrapped(b.text, 11, MUTED, { gapAfter: 8 });
        break;
      case 'bullets':
        listItems(b.items, false);
        break;
      case 'numbered':
        listItems(b.items, true);
        break;
      case 'code': {
        const lines = doc.splitTextToSize(b.code, CONTENT_W - 20);
        const lineH = 9.5 * 1.5;
        const boxH = lines.length * lineH + 16;
        ensure(Math.min(boxH, PAGE_H - MT - MB));
        doc.setFillColor(...CODE_BG);
        doc.rect(ML, y, CONTENT_W, Math.min(boxH, PAGE_H - MB - y), 'F');
        doc.setFont('courier', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...CODE_FG);
        let cy = y + 8;
        for (const line of lines) {
          if (cy + lineH > PAGE_H - MB) { doc.addPage(); cy = MT; y = MT; }
          doc.text(line, ML + 10, cy, { baseline: 'top' });
          cy += lineH;
        }
        y = cy + 10;
        break;
      }
      case 'quote': {
        const startY = y;
        writeWrapped(b.text, 11.5, TEXT, { italic: true, x: ML + 14, width: CONTENT_W - 14, gapAfter: b.attribution ? 2 : 8 });
        if (b.attribution) writeWrapped(`— ${b.attribution}`, 10, FAINT, { x: ML + 14, width: CONTENT_W - 14, gapAfter: 8 });
        doc.setDrawColor(...ACCENT); doc.setLineWidth(2);
        doc.line(ML + 2, startY, ML + 2, Math.min(y - 6, PAGE_H - MB));
        break;
      }
      case 'table': {
        const cols = Math.max(b.headers.length, b.rows[0]?.length || 1);
        const colW = CONTENT_W / cols;
        const drawRow = (cells: string[], bold: boolean) => {
          const cellLines = cells.map(c => doc.splitTextToSize(c, colW - 12));
          const rowH = Math.max(1, ...cellLines.map(l => l.length)) * 13 + 10;
          ensure(rowH);
          doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 9.5);
          doc.setTextColor(...(bold ? TEXT : MUTED));
          cells.forEach((_, ci) => {
            doc.text(cellLines[ci], ML + ci * colW + 6, y + 6, { baseline: 'top' });
          });
          doc.setDrawColor(...BORDER); doc.setLineWidth(bold ? 1 : 0.5);
          doc.line(ML, y + rowH, ML + CONTENT_W, y + rowH);
          y += rowH;
        };
        if (b.headers.length) drawRow(b.headers, true);
        for (const row of b.rows) drawRow(row, false);
        y += 10;
        break;
      }
    }
  };

  writeWrapped(spec.title, 22, TEXT, { bold: true, gapAfter: spec.subtitle ? 2 : 6 });
  if (spec.subtitle) writeWrapped(spec.subtitle, 12, FAINT, { gapAfter: 6 });
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
  doc.line(ML, y, ML + CONTENT_W, y); y += 14;

  for (const block of spec.blocks) renderBlock(block);

  doc.save(`${filenameBase}.pdf`);
}
