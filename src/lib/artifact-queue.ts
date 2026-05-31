import type { Artifact } from './stream-parser';
import type { ArtifactStatus } from './artifact-lifecycle';

export interface ArtifactEntry {
  messageIdx: number;
  artifact: Artifact;
  ts: number;
  status?: ArtifactStatus;
  error?: string;
}

type Subscriber = (entries: ArtifactEntry[]) => void;
const DEFAULT_SUBSCRIBER_DEBOUNCE_MS = 50;

export function createArtifactQueue() {
  let entries: ArtifactEntry[] = [];
  let subscribers: Subscriber[] = [];

  function push(entry: ArtifactEntry) {
    const idx = entries.findIndex(e => e.messageIdx === entry.messageIdx && e.artifact.id === entry.artifact.id);
    entries = idx === -1
      ? [...entries, entry]
      : entries.map((existing, i) => i === idx ? { ...existing, ...entry, ts: existing.ts } : existing);
    for (const sub of subscribers) sub(entries);
  }

  function remove(messageIdx: number, artifactId: string) {
    entries = entries.filter(e => !(e.messageIdx === messageIdx && e.artifact.id === artifactId));
    for (const sub of subscribers) sub(entries);
  }

  function replace(
    messageIdx: number,
    artifactId: string,
    replacement: Artifact,
    meta: Partial<Pick<ArtifactEntry, 'status' | 'ts'>> & { error?: string | null } = {},
  ): ArtifactEntry | null {
    let updated: ArtifactEntry | null = null;
    entries = entries.map(e => {
      if (e.messageIdx !== messageIdx || e.artifact.id !== artifactId) return e;
      const next: ArtifactEntry = {
        ...e,
        ...meta,
        messageIdx,
        artifact: replacement,
        ts: meta.ts ?? e.ts,
      };
      if (meta.error === null) delete next.error;
      updated = next;
      return next;
    });
    for (const sub of subscribers) sub(entries);
    return updated;
  }

  function forMessage(messageIdx: number): ArtifactEntry[] {
    return entries.filter(e => e.messageIdx === messageIdx);
  }

  function clear() {
    entries = [];
    for (const sub of subscribers) sub(entries);
  }

  function subscribe(sub: Subscriber): () => void {
    subscribers = [...subscribers, sub];
    sub(entries);
    return () => { subscribers = subscribers.filter(s => s !== sub); };
  }

  function subscribeDebounced(sub: Subscriber, delayMs: number = DEFAULT_SUBSCRIBER_DEBOUNCE_MS): () => void {
    let latest = entries;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler: Subscriber = (next) => {
      latest = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        sub(latest);
      }, delayMs);
    };
    subscribers = [...subscribers, handler];
    sub(entries);
    return () => {
      if (timer) clearTimeout(timer);
      subscribers = subscribers.filter(s => s !== handler);
    };
  }

  return { push, remove, replace, forMessage, clear, subscribe, subscribeDebounced, get entries() { return entries; } };
}

export type ArtifactQueue = ReturnType<typeof createArtifactQueue>;
