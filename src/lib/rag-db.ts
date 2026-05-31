const LEGACY_DB_NAME = 'techwriter-rag';

export interface ChunkVector {
  id: string;
  sessionId: string;
  text: string;
  vector: number[];
  timestamp: number;
  documentId?: string;
  filename?: string;
  startLine?: number;
  endLine?: number;
  heading?: string;
}

export interface StoredDocument {
  id: string;
  filename: string;
  chunkCount: number;
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

export async function getStoredDocuments(sessionId: string): Promise<StoredDocument[]> {
  const vectors = await getStoredVectors(sessionId);
  const documents = new Map<string, StoredDocument>();

  for (const vector of vectors) {
    const id = vector.documentId || vector.filename || vector.id;
    const existing = documents.get(id);
    if (existing) {
      existing.chunkCount += 1;
    } else {
      documents.set(id, {
        id,
        filename: vector.filename || 'document',
        chunkCount: 1,
      });
    }
  }

  return [...documents.values()];
}

export async function storeVectors(
  sessionId: string,
  chunks: { text: string; vector: number[]; documentId?: string; filename?: string; startLine?: number; endLine?: number; heading?: string }[],
): Promise<void> {
  clearLegacyIndexedDb();
  const timestamp = Date.now();
  const existing = vectorsBySession.get(sessionId) || [];
  const next = chunks.map((chunk, index) => ({
    id: `${sessionId}_${chunk.documentId || 'document'}_${timestamp}_${index}`,
    sessionId,
    text: chunk.text,
    vector: chunk.vector,
    documentId: chunk.documentId,
    filename: chunk.filename,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    heading: chunk.heading,
    timestamp,
  }));
  vectorsBySession.set(sessionId, [...existing, ...next]);
  activityBySession.set(sessionId, timestamp);
}

export async function deleteDocumentVectors(sessionId: string, documentId: string): Promise<void> {
  clearLegacyIndexedDb();
  const existing = vectorsBySession.get(sessionId) || [];
  const remaining = existing.filter((vector) => (vector.documentId || vector.filename || vector.id) !== documentId);

  if (remaining.length > 0) {
    vectorsBySession.set(sessionId, remaining);
    activityBySession.set(sessionId, Date.now());
  } else {
    vectorsBySession.delete(sessionId);
    activityBySession.delete(sessionId);
  }
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
