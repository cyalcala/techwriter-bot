// 10 = server MAX_TEXTS_PER_REQUEST; halves request count for large docs.
// At ~700-char chunks this keeps each request body well under the 10KB cap.
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1500, 4000];

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
): Promise<{ vectors: number[][]; skipped: number; degraded: boolean }> {
  const allVectors: number[][] = [];
  let skipped = 0;
  let degraded = false;
  const total = chunks.length;
  let serverFailed = false;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');

    const batch = chunks.slice(i, i + BATCH_SIZE);

    if (!serverFailed) {
      let batchResult: EmbedResponse | null = null;

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
            if (res.status === 429 || res.status === 503) {
              serverFailed = true;
              degraded = true;
            }
            throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
          }

          batchResult = await res.json() as EmbedResponse;
          break;
        } catch {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          }
        }
      }

      if (batchResult) {
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
        onProgress?.({
          done: Math.min(i + BATCH_SIZE, total),
          total,
          skipped,
          stage: 'embedding',
        });
        continue;
      }
    }

    skipped += batch.length;
    for (let j = 0; j < batch.length; j++) allVectors.push([]);
    degraded = true;
    onProgress?.({
      done: Math.min(i + BATCH_SIZE, total),
      total,
      skipped,
      stage: 'error',
    });
  }

  return { vectors: allVectors, skipped, degraded };
}

export function chunkText(text: string, chunkSize: number = 500, overlap: number = 100, maxChunks: number = 100): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

export function validateDocument(file: File): string | null {
  const validTypes = [
    'text/plain', 'text/markdown', 'text/x-markdown', 'application/json', 'text/csv',
    'text/yaml', 'application/x-yaml', 'application/yaml',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const validExts = ['.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.pdf', '.docx'];

  if (file.size > 5 * 1024 * 1024) return 'File exceeds 5MB limit.';
  if (file.size === 0) return 'File is empty.';

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
    return `Unsupported file type: ${file.name}. Supported: .pdf, .docx, .txt, .md, .json, .csv, .yaml`;
  }

  return null;
}
