import type { Artifact } from './stream-parser';

export interface SplitArtifact {
  messageIdx: number;
  artifacts: { messageIdx: number; artifact: Artifact }[];
  activeIdx: number;
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

export function openSplitArtifacts(
  msgIdx: number,
  all: { messageIdx: number; artifact: Artifact }[],
): { split: SplitArtifact; tab: SplitTab } {
  return {
    split: { messageIdx: msgIdx, artifacts: all, activeIdx: 0 },
    tab: 'preview' as SplitTab,
  };
}

export function getActiveArtifact(state: SplitArtifact): { messageIdx: number; artifact: Artifact } {
  return state.artifacts[state.activeIdx] || state.artifacts[0];
}

export function nextArtifact(state: SplitArtifact): number {
  return (state.activeIdx + 1) % state.artifacts.length;
}

export function prevArtifact(state: SplitArtifact): number {
  return (state.activeIdx - 1 + state.artifacts.length) % state.artifacts.length;
}

export function closeSplitArtifact(): { split: null; error: null } {
  return { split: null, error: null };
}

export function fixArtifactError(error: string | null, split: SplitArtifact | null): string | null {
  if (!error || !split || split.artifacts.length === 0) return null;
  const active = getActiveArtifact(split);
  return `The following artifact has an error:\n\n\`\`\`\n${active.artifact.code}\n\`\`\`\n\nError: ${error}\n\nPlease fix this code.`;
}
