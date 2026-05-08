import type { Artifact } from './stream-parser';

export interface ArtifactEntry {
  messageIdx: number;
  artifact: Artifact;
  ts: number;
}

type Subscriber = (entries: ArtifactEntry[]) => void;

export function createArtifactQueue() {
  let entries: ArtifactEntry[] = [];
  let subscribers: Subscriber[] = [];

  function push(entry: ArtifactEntry) {
    entries = [...entries, entry];
    for (const sub of subscribers) sub(entries);
  }

  function remove(messageIdx: number, artifactId: string) {
    entries = entries.filter(e => !(e.messageIdx === messageIdx && e.artifact.id === artifactId));
    for (const sub of subscribers) sub(entries);
  }

  function replace(messageIdx: number, artifactId: string, replacement: Artifact) {
    entries = entries.map(e =>
      e.messageIdx === messageIdx && e.artifact.id === artifactId
        ? { messageIdx, artifact: replacement }
        : e
    );
    for (const sub of subscribers) sub(entries);
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
