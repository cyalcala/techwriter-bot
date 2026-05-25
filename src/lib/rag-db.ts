const LEGACY_DB_NAME = 'techwriter-rag';

export interface ChunkVector {
  id: string;
  sessionId: string;
  text: string;
  vector: number[];
  timestamp: number;
}

const vectorsBySession = new Map<string, ChunkVector[]>();
const activityBySession = new Map<string, number>();
let legacyCleanupStarted = false;

function clearLegacyIndexedDb(): void {
  if (legacyCleanupStarted) return;
  legacyCleanupStarted = true;
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {}
}

export async function getStoredVectors(sessionId: string): Promise<ChunkVector[]> {
  clearLegacyIndexedDb();
  return [...(vectorsBySession.get(sessionId) || [])];
}

export async function storeVectors(sessionId: string, chunks: { text: string; vector: number[] }[]): Promise<void> {
  clearLegacyIndexedDb();
  const timestamp = Date.now();
  const existing = vectorsBySession.get(sessionId) || [];
  const next = chunks.map((chunk, index) => ({
    id: `${sessionId}_${timestamp}_${index}`,
    sessionId,
    text: chunk.text,
    vector: chunk.vector,
    timestamp,
  }));
  vectorsBySession.set(sessionId, [...existing, ...next]);
  activityBySession.set(sessionId, timestamp);
}

export async function updateActivity(sessionId: string): Promise<void> {
  if (vectorsBySession.has(sessionId)) activityBySession.set(sessionId, Date.now());
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchSimilarChunks(sessionId: string, queryVector: number[], topK: number = 3): Promise<ChunkVector[]> {
  const vectors = await getStoredVectors(sessionId);
  return vectors
    .map(vector => ({ ...vector, score: cosineSimilarity(queryVector, vector.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(vector => vector.score > 0.3);
}

export async function clearSessionVectors(sessionId: string): Promise<void> {
  vectorsBySession.delete(sessionId);
  activityBySession.delete(sessionId);
}

export async function purgeStaleData(maxHours: number = 2): Promise<void> {
  clearLegacyIndexedDb();
  const cutoff = Date.now() - maxHours * 3_600_000;
  for (const [sessionId, lastActivity] of activityBySession) {
    if (lastActivity < cutoff) {
      vectorsBySession.delete(sessionId);
      activityBySession.delete(sessionId);
    }
  }
}
