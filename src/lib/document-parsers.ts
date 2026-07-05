// Client-side text extraction for uploaded documents. Binary formats
// (PDF, DOCX) are parsed IN THE BROWSER so raw content never leaves the
// device except as embedding chunks — preserving the privacy-first model.
// Libraries are lazy-loaded from CSP-allowed CDNs only when needed.
// Strategy: docs/DOCUMENT_ARTIFACT_STRATEGY.md.

// pdf.js: Apache-2.0. Legacy UMD build exposes window.pdfjsLib; its worker
// is fetched (connect-src https:) and wrapped as a blob: worker
// (worker-src 'self' blob:) — both allowed by the current CSP.
const PDFJS_VERSION = '3.11.174';
const PDFJS_LIB = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
// mammoth.js: BSD-2-Clause. Browser build exposes window.mammoth.
const MAMMOTH_LIB = 'https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js';

// Hard ceiling on extracted text so a pathological file can't exhaust
// memory; chunking applies the embedding-budget cap on top of this.
const MAX_EXTRACTED_CHARS = 2_000_000;

const SCRIPT_TIMEOUT_MS = 20_000;
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

function loadScriptOnce(src: string): Promise<void> {
  if (loaded.has(src)) return Promise.resolve();
  const pending = loading.get(src);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { loading.delete(src); script.remove(); reject(new Error(`Timed out loading ${src}`)); }, SCRIPT_TIMEOUT_MS);
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timer); loaded.add(src); loading.delete(src); resolve(); };
    script.onerror = () => { clearTimeout(timer); loading.delete(src); script.remove(); reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

export type DocumentKind = 'pdf' | 'docx' | 'text';

export interface ExtractedDocument {
  text: string;
  kind: DocumentKind;
  note?: string;
}

export function documentKindFor(filename: string): DocumentKind {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  return 'text';
}

function clampText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

async function extractPdf(file: File): Promise<ExtractedDocument> {
  await loadScriptOnce(PDFJS_LIB);
  const pdfjs = (window as any).pdfjsLib;
  if (!pdfjs?.getDocument) throw new Error('PDF reader failed to load.');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item: any) => (typeof item.str === 'string' ? item.str : '')).filter(Boolean);
    if (strings.length) pages.push(strings.join(' '));
    if (pages.join('\n\n').length > MAX_EXTRACTED_CHARS) break;
  }
  try { await doc.destroy(); } catch {}

  const { text, truncated } = clampText(pages.join('\n\n').trim());
  if (!text) {
    return { text: '', kind: 'pdf', note: 'No selectable text found — this PDF may be scanned/image-only (OCR is not supported).' };
  }
  return {
    text,
    kind: 'pdf',
    note: truncated ? `PDF is very large; extracted the first ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.` : undefined,
  };
}

async function extractDocx(file: File): Promise<ExtractedDocument> {
  await loadScriptOnce(MAMMOTH_LIB);
  const mammoth = (window as any).mammoth;
  if (!mammoth?.extractRawText) throw new Error('DOCX reader failed to load.');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const { text, truncated } = clampText(String(result?.value || '').trim());
  if (!text) return { text: '', kind: 'docx', note: 'No text could be extracted from this document.' };
  return { text, kind: 'docx', note: truncated ? 'Document is very large; extracted the leading portion.' : undefined };
}

// Extract plain text from any supported upload. PDF/DOCX are parsed via
// lazy-loaded libraries; everything else is read as UTF-8 text.
export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  const kind = documentKindFor(file.name);
  if (kind === 'pdf') return extractPdf(file);
  if (kind === 'docx') return extractDocx(file);
  const { text } = clampText((await file.text()).trim());
  return { text, kind: 'text' };
}
