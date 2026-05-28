import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactQueue } from '../lib/artifact-queue';
import { createArtifactRepairTarget, planArtifactRepairReplacement } from '../lib/artifact-repair';
import type { Artifact } from '../lib/stream-parser';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const brokenArtifact: Artifact = {
  id: 'mermaid-broken',
  type: 'mermaid',
  title: 'Checkout Flow',
  placement: 'inline',
  code: 'graph TD\nA --',
};

describe('active-session artifact repair flow', () => {
  it('plans repair replacement against the original queue entry', () => {
    const target = createArtifactRepairTarget({
      messageIdx: 3,
      artifact: brokenArtifact,
      ts: 100,
      status: 'error',
      error: 'syntax error',
    });
    const fixedArtifact: Artifact = {
      id: 'mermaid-fixed',
      type: 'mermaid',
      title: 'Fixed Flow',
      placement: 'inline',
      code: 'graph TD\nA-->B',
    };

    const plan = planArtifactRepairReplacement(target, fixedArtifact, 200);

    expect(plan).toEqual({
      messageIdx: 3,
      artifactId: 'mermaid-broken',
      artifact: fixedArtifact,
      meta: { status: 'ready', error: null, ts: 200 },
    });
  });

  it('clears stale queue errors when a repair replacement lands', () => {
    const queue = createArtifactQueue();
    const target = createArtifactRepairTarget({
      messageIdx: 3,
      artifact: brokenArtifact,
      ts: 100,
      status: 'error',
      error: 'syntax error',
    });
    const fixedArtifact: Artifact = {
      id: 'mermaid-fixed',
      type: 'mermaid',
      title: 'Checkout Flow',
      placement: 'inline',
      code: 'graph TD\nA-->B',
    };

    queue.push({ messageIdx: 3, artifact: brokenArtifact, ts: 100, status: 'error', error: 'syntax error' });
    const plan = planArtifactRepairReplacement(target, fixedArtifact, 200);
    const updated = queue.replace(plan.messageIdx, plan.artifactId, plan.artifact, plan.meta);

    expect(updated).toEqual({ messageIdx: 3, artifact: fixedArtifact, ts: 200, status: 'ready' });
    expect(queue.entries).toEqual([{ messageIdx: 3, artifact: fixedArtifact, ts: 200, status: 'ready' }]);
  });

  it('wires chat repair mode to replace instead of appending a separate artifact entry', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('pendingArtifactRepair');
    expect(island).toContain('createArtifactRepairTarget(activeArtifactEntry)');
    expect(island).toContain('planArtifactRepairReplacement(repairTarget');
    expect(island).toContain('artifactQueue.replace(repairPlan.messageIdx, repairPlan.artifactId');
    expect(island).toContain('activeArtifactEntry = updatedRepair');
  });
});
