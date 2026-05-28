import type { ArtifactEntry } from './artifact-queue';
import type { ArtifactStatus } from './artifact-lifecycle';
import type { Artifact } from './stream-parser';

export interface ArtifactRepairTarget {
  messageIdx: number;
  artifactId: string;
}

export interface ArtifactRepairReplacementPlan {
  messageIdx: number;
  artifactId: string;
  artifact: Artifact;
  meta: {
    status: ArtifactStatus;
    error: null;
    ts: number;
  };
}

export function createArtifactRepairTarget(entry: ArtifactEntry): ArtifactRepairTarget {
  return {
    messageIdx: entry.messageIdx,
    artifactId: entry.artifact.id,
  };
}

export function planArtifactRepairReplacement(
  target: ArtifactRepairTarget,
  artifact: Artifact,
  ts = Date.now(),
): ArtifactRepairReplacementPlan {
  return {
    messageIdx: target.messageIdx,
    artifactId: target.artifactId,
    artifact,
    meta: { status: 'ready', error: null, ts },
  };
}
