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

export function createArtifactRegenerationPrompt(entry: ArtifactEntry): string {
  const { artifact } = entry;
  const title = artifact.title ? ` titled "${artifact.title}"` : '';

  return [
    `Regenerate this ${artifact.type} artifact${title}.`,
    'Replace the current artifact in this open session with an improved version.',
    'Return one complete artifact block only, using the same artifact type unless a syntax-compatible fix requires a closely related diagram type.',
    '',
    `\`\`\`${artifact.type}`,
    artifact.code,
    '```',
  ].join('\n');
}
