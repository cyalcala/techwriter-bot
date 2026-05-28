import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatArtifactRendererError, getArtifactRecoveryHint } from '../lib/artifact-error-boundary';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('artifact renderer error boundaries', () => {
  it('renders a type-specific, escaped inline failure view', () => {
    const html = formatArtifactRendererError('mermaid', 'Bad <syntax>', '<script>alert(1)</script>\ngraph TD');

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-artifact-error-type="mermaid"');
    expect(html).toContain('Mermaid renderer unavailable');
    expect(html).toContain('Check the diagram syntax');
    expect(html).toContain('Bad &lt;syntax&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('gives HTML and React artifacts their own recovery guidance', () => {
    expect(getArtifactRecoveryHint('html')).toContain('sandboxed HTML');
    expect(getArtifactRecoveryHint('react')).toContain('App component');
    expect(getArtifactRecoveryHint('katex')).toContain('LaTeX');
  });

  it('surfaces renderer failures to the split-view repair controls', () => {
    const panel = source('src/components/ArtifactPanel.svelte');
    const split = source('src/components/ArtifactSplitView.svelte');
    const loader = source('src/lib/renderer-loader.ts');

    expect(panel).toContain('onrenderererror');
    expect(panel).toContain('Retry renderer');
    expect(panel).toContain('View code');
    expect(panel).toContain('renderNonce');
    expect(split).toContain('panelRendererError');
    expect(split).toContain('onrenderererror={(message)');
    expect(loader).toContain("from './artifact-error-boundary'");
  });
});
