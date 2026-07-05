import { describe, expect, it } from 'vitest';
import { validateDocument } from '../lib/embed-pipeline';
import { documentKindFor, extractDocumentText } from '../lib/document-parsers';
import { chunkDocument, createDocumentChunks } from '../lib/rag-client';

describe('document kind dispatch', () => {
  it('routes by extension, case-insensitive', () => {
    expect(documentKindFor('report.pdf')).toBe('pdf');
    expect(documentKindFor('Notes.DOCX')).toBe('docx');
    expect(documentKindFor('readme.md')).toBe('text');
    expect(documentKindFor('data.csv')).toBe('text');
    expect(documentKindFor('config.yaml')).toBe('text');
    expect(documentKindFor('noext')).toBe('text');
  });
});

describe('validateDocument allowlist', () => {
  it('accepts the newly supported formats', () => {
    expect(validateDocument(new File(['x'], 'a.pdf'))).toBeNull();
    expect(validateDocument(new File(['x'], 'a.docx'))).toBeNull();
    expect(validateDocument(new File(['x'], 'a.yaml'))).toBeNull();
    expect(validateDocument(new File(['x'], 'a.yml'))).toBeNull();
    expect(validateDocument(new File(['x'], 'a.md'))).toBeNull();
  });

  it('rejects unsupported types and empty/oversized files', () => {
    expect(validateDocument(new File(['x'], 'a.exe'))).toContain('Unsupported');
    expect(validateDocument(new File([], 'a.pdf'))).toContain('empty');
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf');
    expect(validateDocument(big)).toContain('5MB');
  });
});

describe('extractDocumentText (text path runs without browser libs)', () => {
  it('reads and trims a text file', async () => {
    const file = new File(['  # Title\n\nBody text.  '], 'doc.md', { type: 'text/markdown' });
    const result = await extractDocumentText(file);
    expect(result.kind).toBe('text');
    expect(result.text).toBe('# Title\n\nBody text.');
  });
});

describe('chunkDocument (paragraph-aware, capped, truncation-aware)', () => {
  it('keeps a small document as one line-accurate chunk', () => {
    const { chunks, truncated } = chunkDocument('# API\n\nIntro paragraph.\n\n## Auth\nUse bearer tokens.', 'api.md', 80, 20, 5);
    expect(chunks).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(chunks[0]).toMatchObject({ filename: 'api.md', startLine: 1, heading: 'API' });
    expect(chunks[0].text).toContain('Use bearer tokens.');
  });

  it('cuts on a paragraph boundary when one falls in the window', () => {
    const text = 'Para one is here.\n\nPara two is here.\n\nPara three is last.';
    const { chunks } = chunkDocument(text, 'p.txt', 25, 5, 50);
    expect(chunks[0].text.trim()).toBe('Para one is here.');
  });

  it('flags truncation and honors the chunk cap on large documents', () => {
    const para = 'x'.repeat(90);
    const text = Array.from({ length: 40 }, (_, i) => `${para}${i}`).join('\n\n');
    const { chunks, truncated } = chunkDocument(text, 'big.txt', 100, 0, 3);
    expect(chunks).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('always makes forward progress (no infinite overlap loop)', () => {
    const text = 'word '.repeat(2000); // 10k chars, no paragraph breaks
    const { chunks } = chunkDocument(text, 'flat.txt', 700, 120, 500);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.length).toBeLessThanOrEqual(500);
  });

  it('createDocumentChunks stays array-returning for back-compat', () => {
    const chunks = createDocumentChunks('a\n\nb\n\nc', 'x.txt');
    expect(Array.isArray(chunks)).toBe(true);
  });
});
