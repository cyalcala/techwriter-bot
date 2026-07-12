import { describe, expect, it } from 'vitest';
import { normalizeArtifactSource, normalizeMermaidSource, joinDanglingEdges } from '../lib/diagram-source-normalizer';
import { loadRenderer } from '../lib/renderer-loader';

const bpoDiagram = [
  'graph LR',
  'A[Customer Inquiry] -->|request received|> B[Initial Screening]',
  'B -->|eligible|> C[Data Collection]',
  'C -->|information gathered|> D[Verification Process]',
  'D -->|verified|> E[Quality Check]',
  'E -->|approved|> F[Resolution/Response]',
  'F -->|closed|> G[Follow-up/Feedback]',
  'subgraph BPO Process',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'end',
  'style BPO Process fill:#f9f,stroke:#333,stroke-width:4px',
].join('\n');

describe('diagram source normalization', () => {
  it('repairs common AI Mermaid flowchart syntax without changing the diagram intent', () => {
    const normalized = normalizeMermaidSource(bpoDiagram);

    expect(normalized).toContain('A[Customer Inquiry] -->|request received| B[Initial Screening]');
    expect(normalized).toContain('E -->|approved| F[Resolution/Response]');
    expect(normalized).toContain('subgraph BPO_Process [BPO Process]');
    expect(normalized).toContain('style BPO_Process fill:#f9f,stroke:#333,stroke-width:4px');
    expect(normalized).not.toContain('|>');
    expect(normalized).not.toContain('style BPO Process');
  });

  it('decodes escaped arrows and strips markdown fences for Mermaid artifacts', () => {
    const normalized = normalizeArtifactSource('mermaid', [
      '```mermaid',
      'graph TD',
      'A[Start] --&gt;|ready|&gt; B[Done]',
      '```',
    ].join('\n'));

    expect(normalized).toBe('graph TD\nA[Start] -->|ready| B[Done]');
  });

  it('joins edges a model split across two lines (the Kroki 400 "got NODE_STRING" bug)', () => {
    // Reproduces the user-reported failure: labeled edges wrapped onto two lines
    // so the target node starts a new line, which Kroki/mermaid reject.
    const split = [
      'graph TD',
      '    T[Tokenizer] -->|breaks|',
      '    InputText[Input Text]',
      '    AST -->|optimizes|',
      '    OptimizedAST[Optimized AST]',
    ].join('\n');

    const normalized = normalizeMermaidSource(split);

    expect(normalized).toContain('T[Tokenizer] -->|breaks| InputText[Input Text]');
    expect(normalized).toContain('AST -->|optimizes| OptimizedAST[Optimized AST]');
  });

  it('joinDanglingEdges leaves valid one-line and multi-node edges untouched', () => {
    const valid = [
      'graph LR',
      'A[Start] -->|go| B[End]',
      'A & B --> C',
      'C --> D & E',
    ].join('\n');
    expect(joinDanglingEdges(valid)).toBe(valid);
  });

  it('joinDanglingEdges never merges structural lines (subgraph/end/style)', () => {
    const src = [
      'graph TD',
      'A -->|x|',
      'B',
      'subgraph Group',
      'B --> C',
      'end',
      'style A fill:#fff',
    ].join('\n');
    const out = joinDanglingEdges(src);
    expect(out).toContain('A -->|x| B');
    // the `subgraph`, `end`, and `style` lines stay on their own lines
    expect(out).toContain('\nsubgraph Group');
    expect(out).toContain('\nend');
    expect(out).toContain('\nstyle A fill:#fff');
  });

  it('joinDanglingEdges does not merge frontmatter delimiters or dash-ending comments', () => {
    const frontmatter = ['---', 'title: My Diagram', '---', 'graph LR', 'A --> B'].join('\n');
    // The `---` fences must not swallow the `title:`/`graph` lines.
    expect(joinDanglingEdges(frontmatter)).toBe(frontmatter);

    const withComment = ['graph LR', '%% a comment ---', 'A --> B'].join('\n');
    expect(joinDanglingEdges(withComment)).toBe(withComment);

    // A node label ending in dashes is not a dangling edge.
    const dashLabel = ['graph LR', 'A[Section ---]', 'B --> C'].join('\n');
    expect(joinDanglingEdges(dashLabel)).toBe(dashLabel);
  });

  it('does not require optional browser CDN renderers before server-rendered diagram fallbacks', async () => {
    await expect(loadRenderer('mermaid')).resolves.toBeUndefined();
    await expect(loadRenderer('d2')).resolves.toBeUndefined();
    await expect(loadRenderer('graphviz')).resolves.toBeUndefined();
    await expect(loadRenderer('vega')).resolves.toBeUndefined();
    await expect(loadRenderer('flowchart')).resolves.toBeUndefined();
  });
});
