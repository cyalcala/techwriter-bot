import { describe, expect, it, vi } from 'vitest';
import { detectAllArtifacts } from '../lib/artifact-detector';
import { createArtifactQueue, type ArtifactEntry } from '../lib/artifact-queue';
import { extractArtifactTitle, generateArtifactId } from '../lib/artifact-lifecycle';
import { ArtifactStreamParser, type Artifact, type ArtifactType } from '../lib/stream-parser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const taggedCases: Array<{ type: ArtifactType; code: string }> = [
  { type: 'code', code: 'const answer = 42;' },
  { type: 'html', code: '<section><h1>Hello</h1></section>' },
  { type: 'svg', code: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' },
  { type: 'mermaid', code: 'graph TD\nA-->B' },
  { type: 'react', code: 'function App(){ return <main>Hello</main>; }' },
  { type: 'katex', code: 'x_i^2 + y_i^2 = z_i^2' },
  { type: 'markmap', code: '# Root\n## Branch\n- Leaf' },
  { type: 'd2', code: 'alpha -> beta\nbeta -> gamma' },
  {
    type: 'vega',
    code: '{"$schema":"https://vega.github.io/schema/vega-lite/v5.json","data":{"values":[{"a":"A","b":1}]},"mark":"bar","encoding":{"x":{"field":"a"},"y":{"field":"b","type":"quantitative"}}}',
  },
  { type: 'graphviz', code: 'digraph G { A -> B }' },
  { type: 'plantuml', code: '@startuml\nAlice -> Bob: Hello\n@enduml' },
  { type: 'flowchart', code: 'st=>start: Start\nop=>operation: Work\nst->op' },
];

describe('artifact detection', () => {
  it('recognizes every supported tagged artifact type', () => {
    const text = taggedCases.map(({ type, code }) => `<artifact type="${type}" title="${type}">${code}</artifact>`).join('\n');

    const result = detectAllArtifacts(text, []);

    expect(result.artifacts.map((artifact) => artifact.type)).toEqual(taggedCases.map(({ type }) => type));
    expect(result.cleanText).toBe('');
  });

  it('detects multiple fenced artifacts without skipping after cleanup', () => {
    const text = [
      'Here are two diagrams:',
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '```d2',
      'alpha -> beta',
      'beta -> gamma',
      '```',
    ].join('\n');

    const result = detectAllArtifacts(text, []);

    expect(result.artifacts.map((artifact) => artifact.type)).toEqual(['mermaid', 'd2']);
    expect(result.cleanText).toBe('Here are two diagrams:');
  });

  it('normalizes Mermaid fenced artifacts found after streaming', () => {
    const text = [
      '```mermaid',
      'graph TD',
      'A[Start] --&gt;|ready|&gt; B[Done]',
      '```',
    ].join('\n');

    const result = detectAllArtifacts(text, []);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].code).toBe('graph TD\nA[Start] -->|ready| B[Done]');
  });

  it('does not classify ordinary json fences as Vega charts', () => {
    const result = detectAllArtifacts('```json\n{"ok":true}\n```', []);

    expect(result.artifacts).toEqual([]);
    expect(result.cleanText).toContain('```json');
  });

  it('degrades legacy webcontainer artifacts to inert code', () => {
    const result = detectAllArtifacts(
      '<artifact type="webcontainer" title="Old app">{"files":{"package.json":{"contents":"{}"}}}</artifact>',
      [],
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({ type: 'code', title: 'Old app' });
  });
});

describe('artifact stream parser', () => {
  function feedUtf8ByteChunks(parser: ArtifactStreamParser, value: string) {
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode(value)) {
      const chunk = decoder.decode(Uint8Array.of(byte), { stream: true });
      if (chunk) parser.feed(chunk);
    }
    const finalChunk = decoder.decode();
    if (finalChunk) parser.feed(finalChunk);
  }

  it('parses artifact tags split across token boundaries without leaking markup', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Intro <arti');
    parser.feed('fact type="code" title="Demo">```ts\nconst value = 1;\n```</artifact> outro');
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'code',
      title: 'Demo',
      language: 'ts',
      code: 'const value = 1;',
    });
  });

  it('feedChunk emits main text once', () => {
    const text: string[] = [];
    const parser = new ArtifactStreamParser(() => {}, (chunk) => text.push(chunk));

    parser.feedChunk('plain text', (chunk) => text.push(chunk));

    expect(text).toEqual(['plain text']);
  });

  it('streams legacy webcontainer output as inert code', () => {
    const artifacts: Artifact[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), () => {});

    parser.feed('<artifact type="webcontainer" title="Old app">{"files":{"index.html":"hello"}}</artifact>');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ type: 'code', title: 'Old app' });
  });

  it('parses tolerant artifact open tags split across token boundaries', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Intro <xr');
    parser.feed('tifact type="mermaid" title="Flow">graph TD\nA-->B</xrtifact> outro');
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'mermaid',
      title: 'Flow',
      code: 'graph TD\nA-->B',
    });
  });

  it('normalizes common AI Mermaid mistakes before queueing streamed artifacts', () => {
    const artifacts: Artifact[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), () => {});

    parser.feed([
      '<artifact type="mermaid" title="BPO Flow">',
      'graph LR',
      'A[Customer Inquiry] -->|request received|> B[Initial Screening]',
      'subgraph BPO Process',
      'B',
      'end',
      'style BPO Process fill:#f9f,stroke:#333,stroke-width:4px',
      '</artifact>',
    ].join('\n'));
    parser.flush();

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].code).toContain('A[Customer Inquiry] -->|request received| B[Initial Screening]');
    expect(artifacts[0].code).toContain('subgraph BPO_Process [BPO Process]');
    expect(artifacts[0].code).toContain('style BPO_Process fill:#f9f,stroke:#333,stroke-width:4px');
  });

  it('closes artifact bodies when the close tag is split across token boundaries', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Intro <artifact type="code" title="Demo">const value = 1;</arti');
    parser.feed('fact> outro');
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'code',
      title: 'Demo',
      code: 'const value = 1;',
    });
  });

  it('preserves UTF-8 artifact content while tags arrive as byte-sized chunks', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    feedUtf8ByteChunks(
      parser,
      'Intro <artifact type="code" title="Resume">Résumé ✓\nnaive cafe</artifact> outro',
    );
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'code',
      title: 'Resume',
      code: 'Résumé ✓\nnaive cafe',
    });
  });

  it('preserves unfinished tag-like artifact content on flush', () => {
    const artifacts: Artifact[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), () => {});

    parser.feed('<artifact type="html" title="Draft"><div');
    parser.flush();

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'html',
      title: 'Draft',
      code: '<div',
    });
  });

  it('accepts case-varied artifact close tags without swallowing trailing text', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Intro <artifact type="mermaid" title="Flow">graph TD\nA-->B</Artifact> outro');
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'mermaid',
      title: 'Flow',
      code: 'graph TD\nA-->B',
    });
  });

  it('accepts typo-style artifact open and close tags without leaking markup', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Intro <xrtifact type="mermaid" title="Flow">graph TD\nA-->B</xrtifact> outro');
    parser.flush();

    expect(text.join('')).toBe('Intro  outro');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: 'mermaid',
      title: 'Flow',
      code: 'graph TD\nA-->B',
    });
  });

  it('keeps nested artifact tags inside the outer artifact body', () => {
    const artifacts: Artifact[] = [];
    const text: string[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), (chunk) => text.push(chunk));

    parser.feed('Start <artifact type="mermaid">graph TD\nA-->B\n<artifact type="code">const nested = true;</artifact>\nB-->C</artifact> End');
    parser.flush();

    expect(text.join('')).toBe('Start  End');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ type: 'mermaid' });
    expect(artifacts[0].code).toContain('<artifact type="code">const nested = true;</artifact>');
    expect(artifacts[0].code).toContain('B-->C');
  });
});

describe('artifact lifecycle and queue', () => {
  it('normalizes standalone URL artifact types before rendering', () => {
    const standalone = readFileSync(join(process.cwd(), 'src', 'components', 'ArtifactStandalone.svelte'), 'utf8');

    expect(standalone).toContain("normalizeArtifactType(type, code) || 'code'");
    expect(standalone).toContain('normalizeArtifactSource(artifactType, code)');
  });

  it('loads app styles on standalone artifact routes', () => {
    const route = readFileSync(join(process.cwd(), 'src', 'pages', 'artifact', '[id].astro'), 'utf8');

    expect(route).toContain("import '../../styles/global.css'");
  });

  it('uses the full artifact body when generating stable ids', () => {
    const base = 'x'.repeat(220);

    expect(generateArtifactId('code', base + 'a')).not.toBe(generateArtifactId('code', base + 'b'));
    expect(generateArtifactId('code', base + 'a')).toBe(generateArtifactId('code', base + 'a'));
  });

  it('extracts D2 title values without the title prefix', () => {
    expect(extractArtifactTitle('title: Checkout Flow\nuser -> app', 'd2')).toBe('Checkout Flow');
  });

  it('preserves queue metadata when replacing a rendered artifact', () => {
    const queue = createArtifactQueue();
    const artifact: Artifact = {
      id: 'mermaid-1',
      type: 'mermaid',
      title: 'Flow',
      placement: 'inline',
      code: 'graph TD\nA-->B',
    };

    queue.push({ messageIdx: 2, artifact, ts: 123, status: 'generating' });
    queue.replace(2, 'mermaid-1', { ...artifact, type: 'svg', code: '<svg></svg>' }, { status: 'ready' });

    expect(queue.entries).toEqual([
      {
        messageIdx: 2,
        ts: 123,
        status: 'ready',
        artifact: { ...artifact, type: 'svg', code: '<svg></svg>' },
      },
    ]);
  });

  it('debounces artifact queue subscribers by 50 ms', () => {
    vi.useFakeTimers();
    try {
      const queue = createArtifactQueue();
      const calls: ArtifactEntry[][] = [];
      const unsubscribe = queue.subscribeDebounced((entries) => calls.push(entries), 50);
      const first: Artifact = {
        id: 'mermaid-1',
        type: 'mermaid',
        title: 'Flow',
        placement: 'inline',
        code: 'graph TD\nA-->B',
      };
      const second: Artifact = {
        ...first,
        id: 'mermaid-2',
        code: 'graph TD\nB-->C',
      };

      queue.push({ messageIdx: 1, artifact: first, ts: 100 });
      vi.advanceTimersByTime(25);
      queue.push({ messageIdx: 1, artifact: second, ts: 101 });
      vi.advanceTimersByTime(49);

      expect(calls).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(calls).toHaveLength(2);
      expect(calls[1].map((entry) => entry.artifact.id)).toEqual(['mermaid-1', 'mermaid-2']);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
