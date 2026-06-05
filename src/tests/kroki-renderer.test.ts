import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KROKI_RENDERABLE, renderViaKroki } from '../lib/kroki-renderer';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Kroki artifact rendering', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('covers the server-rendered diagram types used by artifact previews', () => {
    expect([...KROKI_RENDERABLE].sort()).toEqual(['d2', 'flowchart', 'graphviz', 'mermaid', 'plantuml', 'vega']);
  });

  it('retries transient Kroki failures once and sanitizes returned SVG', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }))
      .mockResolvedValueOnce(new Response('<svg onload="alert(1)"><script>alert(1)</script><path /></svg>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = renderViaKroki('graphviz', 'digraph G { A -> B }');
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.svg).toContain('<svg');
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).not.toContain('onload=');
  });

  it('does not retry permanent syntax errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('syntax error', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderViaKroki('d2', 'broken');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 400, error: 'syntax error' });
  });

  it('maps Flowchart.js artifacts to Kroki flowchart rendering', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<svg><path /></svg>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await renderViaKroki('flowchart', 'st=>start: Start\nop=>operation: Work\nst->op');

    expect(String(fetchMock.mock.calls[0][0])).toContain('/flowchart/svg');
  });

  it('keeps Mermaid-like flowchart aliases on Kroki Mermaid rendering', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<svg><path /></svg>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await renderViaKroki('flowchart', 'graph TD\nA-->|done|>B');

    expect(String(fetchMock.mock.calls[0][0])).toContain('/mermaid/svg');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('A-->|done| B');
  });

  it('normalizes common AI Mermaid mistakes before sending source to Kroki', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<svg><path /></svg>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await renderViaKroki('mermaid', [
      'graph LR',
      'A[Customer Inquiry] -->|request received|> B[Initial Screening]',
      'subgraph BPO Process',
      'B',
      'end',
      'style BPO Process fill:#f9f,stroke:#333,stroke-width:4px',
    ].join('\n'));

    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('A[Customer Inquiry] -->|request received| B[Initial Screening]');
    expect(body).toContain('subgraph BPO_Process [BPO Process]');
    expect(body).toContain('style BPO_Process fill:#f9f,stroke:#333,stroke-width:4px');
  });

  it('keeps render-artifact API responses private and uncached on every branch', () => {
    const route = source('src/pages/api/render-artifact.ts');

    expect(route).toContain("const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' }");
    expect(route.match(/headers: RESPONSE_HEADERS/g)?.length).toBeGreaterThanOrEqual(5);
    expect(route).not.toContain("'Cache-Control': 'no-store, private',");
  });
});
