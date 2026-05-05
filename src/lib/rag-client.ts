import { embedChunks, chunkText, validateDocument, type EmbedProgress } from './embed-pipeline';
import { storeVectors, getStoredVectors, updateActivity, cosineSimilarity } from './rag-db';
import { searchInWorker } from './sim-search';

export type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export interface RagState {
  uploadStatus: UploadState;
  uploadProgress: EmbedProgress | null;
  uploadedFileName: string;
  ragDegraded: boolean;
}

export function createDefaultRagState(): RagState {
  return {
    uploadStatus: 'idle',
    uploadProgress: null,
    uploadedFileName: '',
    ragDegraded: false,
  };
}

export function clearRagState(): RagState {
  return createDefaultRagState();
}

export interface RagChunk {
  text: string;
  score: number;
}

export async function handleFileUpload(
  file: File,
  sessionId: string,
  onProgress: (p: EmbedProgress) => void,
  onStatusChange: (s: UploadState) => void,
): Promise<{ success: boolean; chunkCount: number; skipped: number; degraded: boolean; message: string }> {
  const validationError = validateDocument(file);
  if (validationError) {
    return { success: false, chunkCount: 0, skipped: 0, degraded: false, message: `Upload error: ${validationError}` };
  }

  onStatusChange('uploading');

  try {
    const text = await file.text();
    if (!text.trim()) {
      onStatusChange('error');
      return { success: false, chunkCount: 0, skipped: 0, degraded: false, message: 'Upload failed: File is empty.' };
    }

    const chunks = chunkText(text, 500, 100, 100);
    onProgress({ done: 0, total: chunks.length, skipped: 0, stage: 'embedding' });

    const { vectors, skipped, degraded } = await embedChunks(chunks, (p) => onProgress(p));

    const validChunks: { text: string; vector: number[] }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (vectors[i] && vectors[i].length > 0) {
        validChunks.push({ text: chunks[i], vector: vectors[i] });
      }
    }

    if (validChunks.length === 0) {
      onStatusChange('error');
      return { success: false, chunkCount: 0, skipped, degraded, message: 'Upload failed: Failed to generate embeddings for this document.' };
    }

    await storeVectors(sessionId, validChunks);

    const modeNote = degraded ? ' (offline fallback)' : '';
    const skipNote = skipped > 0 ? ` (${skipped} skipped)` : '';

    onStatusChange('done');
    onProgress({ done: chunks.length, total: chunks.length, skipped, stage: 'done' });

    return {
      success: true,
      chunkCount: validChunks.length,
      skipped,
      degraded,
      message: `I've processed **${file.name}** — ${validChunks.length} chunks indexed${skipNote}${modeNote}. You can now ask questions about it.`,
    };
  } catch (err: any) {
    onStatusChange('error');
    return { success: false, chunkCount: 0, skipped: 0, degraded: false, message: `Upload failed: ${err.message}` };
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
      chunks: similar.map((c: { text: string; score: number }) => ({
        text: c.text,
        score: c.score,
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

  const parts = chunks.map((c, i) => `[Point ${i + 1}] ${extractKeyPoints(c.text)}`);
  const raw = parts.join('\n');
  return raw.length > maxLen
    ? raw.slice(0, maxLen) + '\n[Context truncated — ask for details on specific points]'
    : raw;
}
