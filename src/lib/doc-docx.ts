// Client-side DOCX export for document artifacts via the docx library
// (dolanmiu, MIT), lazy-loaded from a CSP-allowed CDN. Strategy:
// docs/DOCUMENT_ARTIFACT_STRATEGY.md.
import type { DocBlock, DocSpec } from './doc-schema';

const DOCX_CDN = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';

const SCRIPT_TIMEOUT_MS = 20_000;
const loaded = new Set<string>();

function loadScriptOnce(src: string): Promise<void> {
  if (loaded.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error(`Timed out loading ${src}`)); }, SCRIPT_TIMEOUT_MS);
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timer); loaded.add(src); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(script);
  });
}

function blocksToChildren(d: any, spec: DocSpec): any[] {
  const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = d;
  const headingLevel = (lvl: number) => lvl === 1 ? HeadingLevel.HEADING_1 : lvl === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2;
  const children: any[] = [];

  children.push(new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }));
  if (spec.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, italics: true, color: '8C8580' })] }));

  for (const b of spec.blocks as DocBlock[]) {
    switch (b.type) {
      case 'heading':
        children.push(new Paragraph({ text: b.text, heading: headingLevel(b.level) }));
        break;
      case 'paragraph':
        children.push(new Paragraph({ text: b.text }));
        break;
      case 'bullets':
        for (const item of b.items) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
        break;
      case 'numbered':
        b.items.forEach((item, i) => children.push(new Paragraph({ text: `${i + 1}. ${item}` })));
        break;
      case 'code':
        for (const line of b.code.split('\n')) {
          children.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18 })] }));
        }
        break;
      case 'quote':
        children.push(new Paragraph({ children: [new TextRun({ text: b.text, italics: true })], indent: { left: 360 } }));
        if (b.attribution) children.push(new Paragraph({ children: [new TextRun({ text: `— ${b.attribution}`, italics: true, color: '8C8580' })], indent: { left: 360 } }));
        break;
      case 'table': {
        const rows: any[] = [];
        if (b.headers.length) {
          rows.push(new TableRow({ children: b.headers.map(h => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }));
        }
        for (const row of b.rows) {
          rows.push(new TableRow({ children: row.map(c => new TableCell({ children: [new Paragraph(c)] })) }));
        }
        if (rows.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
        break;
      }
    }
  }
  return children;
}

export async function exportDocToDocx(spec: DocSpec, filenameBase: string): Promise<void> {
  await loadScriptOnce(DOCX_CDN);
  const d = (window as any).docx;
  if (!d?.Document || !d?.Packer) throw new Error('DOCX library failed to load');

  const doc = new d.Document({ sections: [{ children: blocksToChildren(d, spec) }] });
  const blob = await d.Packer.toBlob(doc);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
