import type { Artifact } from './stream-parser';
import type { DiagramType } from './path-router';

/**
 * A small deterministic safety net for the automatic visual path. Providers
 * occasionally return a good explanation but omit the requested artifact;
 * this keeps the UI's promise of an explanation plus a visual without
 * inventing topic-specific facts.
 */
export function createFallbackDiagramArtifact(query: string, type: DiagramType): Artifact {
  const topic = cleanLabel(query) || 'The topic';
  const title = `${capitalize(type)} view: ${topic}`;

  const diagrams: Record<DiagramType, string> = {
    architecture: [
      'graph LR',
      `  T["${topic}"] --> P["People / actors"]`,
      `  T --> N["Networks / institutions"]`,
      `  T --> R["Resources / incentives"]`,
      `  P --> O["Outcomes / influence"]`,
      `  N --> O`,
      `  R --> O`,
    ].join('\n'),
    workflow: [
      'graph LR',
      `  A["${topic}"] --> B["Context"]`,
      '  B --> C{"Decision or choice"}',
      '  C -->|continue| D["Action"]',
      '  C -->|pause / revise| B',
      '  D --> E["Outcome"]',
    ].join('\n'),
    sequence: [
      'sequenceDiagram',
      '  participant Q as Question',
      '  participant S as Subject',
      `  Q->>S: Ask about ${topic}`,
      '  S-->>Q: Explain the main relationships',
      '  Q->>S: Choose a visual angle',
      '  S-->>Q: Return the selected diagram',
    ].join('\n'),
    dataflow: [
      'graph LR',
      `  S["Sources about ${topic}"] --> E["Evidence"]`,
      '  E --> I["Interpretation"]',
      '  I --> D["Decision / response"]',
      '  D --> O["Observed outcome"]',
      '  O -. feedback .-> E',
    ].join('\n'),
    lifecycle: [
      'stateDiagram-v2',
      '  [*] --> Framed',
      `  Framed: ${topic}`,
      '  Framed --> Active: conditions align',
      '  Active --> Transition: pressure or change',
      '  Transition --> Renewed: adapts',
      '  Transition --> Dormant: loses momentum',
      '  Renewed --> Active',
      '  Dormant --> [*]',
    ].join('\n'),
  };

  return {
    id: `fallback-diagram-${Date.now().toString(36)}`,
    type: 'mermaid',
    title,
    placement: 'inline',
    code: diagrams[type],
    language: 'mermaid',
  };
}

function cleanLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'`<>()[\]{}|;]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
