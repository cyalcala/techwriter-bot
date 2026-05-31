import { embedChunks, validateDocument, type EmbedProgress } from './embed-pipeline';
import { storeVectors, getStoredVectors } from './rag-db';
import { searchInWorker } from './sim-search';

export type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export interface RagState {
  uploadStatus: UploadState;
  uploadProgress: EmbedProgress | null;
  uploadedFileName: string;
  ragDegraded: boolean;
  documents: UploadedDocumentRecord[];
}

export function createDefaultRagState(): RagState {
  return {
    uploadStatus: 'idle',
    uploadProgress: null,
    uploadedFileName: '',
    ragDegraded: false,
    documents: [],
  };
}

export function clearRagState(): RagState {
  return createDefaultRagState();
}

export interface RagChunk {
  text: string;
  score: number;
  filename?: string;
  startLine?: number;
  endLine?: number;
  heading?: string;
}

export interface DocumentChunk {
  text: string;
  filename: string;
  startLine: number;
  endLine: number;
  heading?: string;
}

export interface UploadedDocumentRecord {
  id: string;
  filename: string;
  chunkCount: number;
}

export interface UploadResult {
  success: boolean;
  chunkCount: number;
  skipped: number;
  degraded: boolean;
  message: string;
  sourceText?: string;
  document?: UploadedDocumentRecord;
}

function safeFilename(name: string): string {
  return name.split(/[\\/]/).pop()?.trim() || 'document';
}

function createDocumentId(filename: string): string {
  const base = safeFilename(filename)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'document';
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function lineForOffset(text: string, offset: number): number {
  if (offset <= 0) return 1;
  const slice = text.slice(0, Math.min(offset, text.length));
  return (slice.match(/\n/g) || []).length + 1;
}

function headingForLine(lines: string[], line: number): string | undefined {
  for (let index = Math.min(line - 1, lines.length - 1); index >= 0; index -= 1) {
    const match = lines[index].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) return match[1].trim();
  }
  return undefined;
}

export function createDocumentChunks(
  text: string,
  filename: string,
  chunkSize: number = 500,
  overlap: number = 100,
  maxChunks: number = 100,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const step = Math.max(1, chunkSize - overlap);
  const safeName = safeFilename(filename);
  const lines = text.split(/\r?\n/);

  for (let start = 0; start < text.length && chunks.length < maxChunks; start += step) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end);
    if (!chunk.trim()) continue;
    const startLine = lineForOffset(text, start);
    const endLine = lineForOffset(text, Math.max(start, end - 1));
    chunks.push({
      text: chunk,
      filename: safeName,
      startLine,
      endLine,
      heading: headingForLine(lines, startLine),
    });
  }

  return chunks;
}

export function createRagRetrievalMessage({ embedFailed }: { embedFailed: boolean }): string {
  return embedFailed
    ? 'Document retrieval is temporarily unavailable. Please retry the document question in a moment.'
    : "I don't have enough context in the uploaded document to answer that.";
}

export async function handleFileUpload(
  file: File,
  sessionId: string,
  onProgress: (p: EmbedProgress) => void,
  onStatusChange: (s: UploadState) => void,
): Promise<UploadResult> {
  const validationError = validateDocument(file);
  if (validationError) {
    return { success: false, chunkCount: 0, skipped: 0, degraded: false, message: `Upload error: ${validationError}` };
  }

  onStatusChange('uploading');
  let sourceText: string | undefined;

  try {
    sourceText = await file.text();
    const text = sourceText;
    if (!text.trim()) {
      onStatusChange('error');
      return { success: false, chunkCount: 0, skipped: 0, degraded: false, message: 'Upload failed: File is empty.' };
    }

    const documentId = createDocumentId(file.name);
    const chunks = createDocumentChunks(text, file.name, 500, 100, 100);
    const chunkTexts = chunks.map((chunk) => chunk.text);
    onProgress({ done: 0, total: chunks.length, skipped: 0, stage: 'embedding' });

    const { vectors, skipped, degraded } = await embedChunks(chunkTexts, (p) => onProgress(p));

    const validChunks: { text: string; vector: number[]; documentId: string; filename: string; startLine: number; endLine: number; heading?: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (vectors[i] && vectors[i].length > 0) {
        validChunks.push({ ...chunks[i], documentId, vector: vectors[i] });
      }
    }

    if (validChunks.length === 0) {
      onStatusChange('error');
      return { success: false, chunkCount: 0, skipped, degraded, sourceText, message: 'Upload failed: Failed to generate embeddings for this document.' };
    }

    await storeVectors(sessionId, validChunks);

    const modeNote = degraded ? ' (partial indexing)' : '';
    const skipNote = skipped > 0 ? ` (${skipped} skipped)` : '';

    onStatusChange('done');
    onProgress({ done: chunks.length, total: chunks.length, skipped, stage: 'done' });

    return {
      success: true,
      chunkCount: validChunks.length,
      skipped,
      degraded,
      sourceText,
      document: { id: documentId, filename: safeFilename(file.name), chunkCount: validChunks.length },
      message: `I've processed **${file.name}** — ${validChunks.length} chunks indexed${skipNote}${modeNote}. You can now ask questions about it.`,
    };
  } catch (err: any) {
    onStatusChange('error');
    return { success: false, chunkCount: 0, skipped: 0, degraded: false, sourceText, message: `Upload failed: ${err.message}` };
  }
}

export async function searchDocumentChunks(
  sessionId: string,
  query: string,
): Promise<{ chunks: RagChunk[]; embedFailed: boolean }> {
  try {
    const qEmbedRes = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [query] }),
    });

    if (!qEmbedRes.ok) {
      return { chunks: [], embedFailed: true };
    }

    const qEmbData = await qEmbedRes.json();
    const queryVec = qEmbData.vectors?.[0];
    if (!queryVec || queryVec.length === 0) {
      return { chunks: [], embedFailed: true };
    }

    const storedVectors = await getStoredVectors(sessionId);
    if (storedVectors.length === 0) {
      return { chunks: [], embedFailed: false };
    }

    const similar = await searchInWorker(storedVectors, queryVec, 3, 0.3);
    if (similar.length === 0) {
      return { chunks: [], embedFailed: false };
    }

    return {
      chunks: similar.map((c: { text: string; score: number; filename?: string; startLine?: number; endLine?: number; heading?: string }) => ({
        text: c.text,
        score: c.score,
        filename: c.filename,
        startLine: c.startLine,
        endLine: c.endLine,
        heading: c.heading,
      })),
      embedFailed: false,
    };
  } catch {
    return { chunks: [], embedFailed: true };
  }
}

export function formatRagContext(chunks: RagChunk[], maxLen: number = 2000): string {
  if (chunks.length === 0) return '';

  const extractKeyPoints = (text: string, max: number = 300): string => {
    const sentences = text.split(/[.!?]\s+/);
    let result = '';
    for (const s of sentences) {
      if (s.length < 10) continue;
      if (result.length + s.length > max) break;
      result += (result ? '. ' : '') + s;
    }
    return result || text.slice(0, max);
  };

  const citationForChunk = (chunk: RagChunk, index: number): string => {
    if (chunk.filename && chunk.startLine) {
      const heading = chunk.heading ? ` (${chunk.heading})` : '';
      return `[Doc: ${chunk.filename}, line ${chunk.startLine}]${heading}`;
    }
    return `[Point ${index + 1}]`;
  };

  const parts = chunks.map((c, i) => `${citationForChunk(c, i)} ${extractKeyPoints(c.text)}`);
  const raw = parts.join('\n');
  return raw.length > maxLen
    ? raw.slice(0, maxLen) + '\n[Context truncated — ask for details on specific points]'
    : raw;
}
