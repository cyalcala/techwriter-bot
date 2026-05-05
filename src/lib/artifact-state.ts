import type { Artifact } from './stream-parser';

export interface SplitArtifact {
  messageIdx: number;
  artifact: Artifact;
}

export type SplitTab = 'code' | 'preview';

export function createArtifactState(): {
  artifacts: { messageIdx: number; artifact: Artifact }[];
  splitArtifact: SplitArtifact | null;
  splitTab: SplitTab;
  artifactError: string | null;
} {
  return {
    artifacts: [],
    splitArtifact: null,
    splitTab: 'preview',
    artifactError: null,
  };
}

export function openSplitArtifact(idx: number, artifact: Artifact, artifacts: { messageIdx: number; artifact: Artifact }[]): { split: SplitArtifact; tab: SplitTab } {
  const existing = artifacts.find(a => a.messageIdx === idx && a.artifact.id === artifact.id);
  return {
    split: { messageIdx: idx, artifact: existing?.artifact || artifact },
    tab: 'preview',
  };
}

export function closeSplitArtifact(): { split: null; error: null } {
  return { split: null, error: null };
}

export function fixArtifactError(error: string | null, split: SplitArtifact | null): string | null {
  if (!error || !split) return null;
  return `The following artifact has an error:\n\n\`\`\`\n${split.artifact.code}\n\`\`\`\n\nError: ${error}\n\nPlease fix this code.`;
}
