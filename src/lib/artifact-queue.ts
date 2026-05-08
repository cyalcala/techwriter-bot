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
    meta: Partial<Pick<ArtifactEntry, 'status' | 'error' | 'ts'>> = {},
  ): ArtifactEntry | null {
    let updated: ArtifactEntry | null = null;
    entries = entries.map(e =>
      e.messageIdx === messageIdx && e.artifact.id === artifactId
        ? (updated = {
            ...e,
            ...meta,
            messageIdx,
            artifact: replacement,
            ts: meta.ts ?? e.ts,
          })
        : e
    );
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

  return { push, remove, replace, forMessage, clear, subscribe, get entries() { return entries; } };
}

export type ArtifactQueue = ReturnType<typeof createArtifactQueue>;
