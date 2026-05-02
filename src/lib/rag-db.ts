const DB_NAME = 'techwriter-rag';
const DB_VERSION = 1;
const VECTOR_STORE = 'vectors';
const META_STORE = 'meta';

export interface ChunkVector {
  id: string;
  sessionId: string;
  text: string;
  vector: number[];
  timestamp: number;
}

interface SessionMeta {
  sessionId: string;
  lastActivity: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VECTOR_STORE)) {
        db.createObjectStore(VECTOR_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredVectors(sessionId: string): Promise<ChunkVector[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, 'readonly');
      const store = tx.objectStore(VECTOR_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter(v => v.sessionId === sessionId));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function storeVectors(sessionId: string, chunks: { text: string; vector: number[] }[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([VECTOR_STORE, META_STORE], 'readwrite');
    const vStore = tx.objectStore(VECTOR_STORE);
    const mStore = tx.objectStore(META_STORE);

    for (const chunk of chunks) {
      const id = `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      vStore.put({
        id,
        sessionId,
        text: chunk.text,
        vector: chunk.vector,
        timestamp: Date.now(),
      });
    }

    mStore.put({ sessionId, lastActivity: Date.now() });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable — graceful degradation
  }
}

export async function updateActivity(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ sessionId, lastActivity: Date.now() });
  } catch {}
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
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
  if (vectors.length === 0) return [];

  const scored = vectors.map(v => ({
    ...v,
    score: cosineSimilarity(queryVector, v.vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter(v => v.score > 0.3);
}

export async function clearSessionVectors(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([VECTOR_STORE, META_STORE], 'readwrite');
    const vStore = tx.objectStore(VECTOR_STORE);
    const mStore = tx.objectStore(META_STORE);

    const all = await new Promise<ChunkVector[]>((resolve, reject) => {
      const req = vStore.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    for (const v of all) {
      if (v.sessionId === sessionId) vStore.delete(v.id);
    }
    mStore.delete(sessionId);

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

export async function purgeStaleData(maxHours: number = 2): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([VECTOR_STORE, META_STORE], 'readwrite');
    const vStore = tx.objectStore(VECTOR_STORE);
    const mStore = tx.objectStore(META_STORE);

    const metas = await new Promise<SessionMeta[]>((resolve, reject) => {
      const req = mStore.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }).catch(() => [] as SessionMeta[]);

    const cutoff = Date.now() - maxHours * 3600000;

    for (const meta of metas) {
      if (meta.lastActivity < cutoff) {
        const all = await new Promise<ChunkVector[]>((resolve, reject) => {
          const req = vStore.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        }).catch(() => [] as ChunkVector[]);

        for (const v of all) {
          if (v.sessionId === meta.sessionId) vStore.delete(v.id);
        }
        mStore.delete(meta.sessionId);
      }
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}