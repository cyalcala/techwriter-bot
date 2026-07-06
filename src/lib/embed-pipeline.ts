// 10 = server MAX_TEXTS_PER_REQUEST; halves request count for large docs.
// At ~700-char chunks this keeps each request body well under the 10KB cap.
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1500, 4000];
// Embed batches concurrently. A max-size doc is ~50 batches; 4-wide keeps
// total requests under the server's per-minute window while cutting
// wall-clock ~4x vs sequential (the old bottleneck).
const CONCURRENCY = 4;

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
  const total = chunks.length;
  const allVectors: number[][] = new Array(total).fill(null) as unknown as number[][];
  let skipped = 0;
  let degraded = false;
  let serverDown = false; // set once the server rate-limits/511s — stop starting new batches
  let done = 0;

  const batches: { start: number; items: string[] }[] = [];
  for (let i = 0; i < total; i += BATCH_SIZE) batches.push({ start: i, items: chunks.slice(i, i + BATCH_SIZE) });

  const markSkipped = (batch: { start: number; items: string[] }) => {
    for (let j = 0; j < batch.items.length; j++) allVectors[batch.start + j] = [];
    skipped += batch.items.length;
    degraded = true;
  };

  const runBatch = async (batch: { start: number; items: string[] }) => {
    if (signal?.aborted) throw new Error('Aborted');

    if (serverDown) {
      markSkipped(batch);
    } else {
      let result: EmbedResponse | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (signal?.aborted) throw new Error('Aborted');
        try {
          const res = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batch.items }),
            signal,
          });
          if (!res.ok) {
            await res.json().catch(() => ({}));
            if (res.status === 429 || res.status === 503) { serverDown = true; degraded = true; }
            throw new Error(`HTTP ${res.status}`);
          }
          result = await res.json() as EmbedResponse;
          break;
        } catch {
          if (attempt < MAX_RETRIES - 1 && !serverDown) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          else break;
        }
      }

      if (result) {
        for (let j = 0; j < batch.items.length; j++) {
          const vec = result.vectors?.[j];
          const err = result.errors?.[j];
          if (err || !vec || vec.length === 0) { allVectors[batch.start + j] = []; skipped++; }
          else allVectors[batch.start + j] = vec;
        }
      } else {
        markSkipped(batch);
      }
    }

    done += batch.items.length;
    onProgress?.({ done: Math.min(done, total), total, skipped, stage: serverDown ? 'error' : 'embedding' });
  };

  // Bounded-concurrency pool over the batches.
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length || 1) }, async () => {
    while (next < batches.length) {
      const mine = next++;
      await runBatch(batches[mine]);
    }
  });
  await Promise.all(workers);

  for (let i = 0; i < total; i++) if (!allVectors[i]) allVectors[i] = [];

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
