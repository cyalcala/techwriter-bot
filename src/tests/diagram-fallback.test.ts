import { describe, expect, it } from 'vitest';
import { createFallbackDiagramArtifact } from '../lib/diagram-fallback';

describe('automatic diagram fallback', () => {
  it('creates a substantive architecture view without copying unsafe label syntax', () => {
    const artifact = createFallbackDiagramArtifact('Discuss political dynasties: <script>', 'architecture');

    expect(artifact.type).toBe('mermaid');
    expect(artifact.title).toContain('Architecture view');
    expect(artifact.code).toContain('People / actors');
    expect(artifact.code).not.toContain('<script>');
    expect(artifact.code).toContain('graph LR');
  });

  it('uses the selected Mermaid grammar for every supported view', () => {
    expect(createFallbackDiagramArtifact('a topic', 'workflow').code).toContain('graph LR');
    expect(createFallbackDiagramArtifact('a topic', 'sequence').code).toContain('sequenceDiagram');
    expect(createFallbackDiagramArtifact('a topic', 'dataflow').code).toContain('Sources about a topic');
    expect(createFallbackDiagramArtifact('a topic', 'lifecycle').code).toContain('stateDiagram-v2');
  });
});
