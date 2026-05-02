const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

interface EmbedResponse {
  vectors: number[][];
  errors: (string | null)[];
}

export interface EmbedProgress {
  done: number;
  total: number;
  skipped: number;
  stage: 'idle' | 'embedding' | 'done' | 'error';
}

export async function embedChunks(
  chunks: string[],
  onProgress?: (p: EmbedProgress) => void,
  signal?: AbortSignal,
): Promise<{ vectors: number[][]; skipped: number }> {
  const allVectors: number[][] = [];
  let skipped = 0;
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');

    const batch = chunks.slice(i, i + BATCH_SIZE);
    let batchResult: EmbedResponse | null = null;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error('Aborted');

      try {
        const res = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: batch }),
          signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
        }

        batchResult = await res.json() as EmbedResponse;
        break;
      } catch (e: any) {
        lastError = e.message || 'Unknown error';
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }
    }

    if (!batchResult) {
      skipped += batch.length;
      batch.forEach(() => allVectors.push([]));
    } else {
      for (let j = 0; j < batch.length; j++) {
        const err = batchResult.errors?.[j];
        const vec = batchResult.vectors?.[j];
        if (err || !vec || vec.length === 0) {
          skipped++;
          allVectors.push([]);
        } else {
          allVectors.push(vec);
        }
      }
    }

    onProgress?.({
      done: Math.min(i + BATCH_SIZE, total),
      total,
      skipped,
      stage: 'embedding',
    });
  }

  return { vectors: allVectors, skipped };
}

export function chunkText(text: string, chunkSize: number = 500, overlap: number = 100, maxChunks: number = 100): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

export function validateDocument(file: File): string | null {
  const validTypes = ['text/plain', 'text/markdown', 'application/json', 'text/csv', 'text/x-markdown'];
  const validExts = ['.txt', '.md', '.json', '.csv'];

  if (file.size > 5 * 1024 * 1024) return 'File exceeds 5MB limit.';
  if (file.size === 0) return 'File is empty.';

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
    return `Unsupported file type: ${file.name}. Supported: .txt, .md, .json, .csv`;
  }

  return null;
}