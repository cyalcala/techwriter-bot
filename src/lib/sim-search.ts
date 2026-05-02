import { cosineSimilarity } from './rag-db';
import type { ChunkVector } from './rag-db';

let worker: Worker | null = null;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker('/workers/similarity-worker.js');
    return worker;
  } catch {
    return null;
  }
}

export async function searchInWorker(
  vectors: ChunkVector[],
  queryVector: number[],
  topK: number = 3,
  threshold: number = 0.3,
): Promise<{ id: string; text: string; score: number }[]> {
  const w = getWorker();

  if (w) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(fallbackSearch(vectors, queryVector, topK, threshold));
      }, 3000);

      w.onmessage = (event: MessageEvent) => {
        clearTimeout(timeout);
        if (event.data.type === 'result') {
          resolve(event.data.results);
        }
      };

      w.onerror = () => {
        clearTimeout(timeout);
        resolve(fallbackSearch(vectors, queryVector, topK, threshold));
        worker = null;
      };

      w.postMessage({ type: 'search', vectors, queryVector, topK, threshold });
    });
  }

  return fallbackSearch(vectors, queryVector, topK, threshold);
}

function fallbackSearch(
  vectors: ChunkVector[],
  queryVector: number[],
  topK: number,
  threshold: number,
): { id: string; text: string; score: number }[] {
  const scored = vectors.map(v => ({
    id: v.id,
    text: v.text,
    score: cosineSimilarity(queryVector, v.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter(v => v.score > threshold);
}