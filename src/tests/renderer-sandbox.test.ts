import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('artifact iframe sandboxing', () => {
  it('sandboxes HTML and React artifact iframes', () => {
    const rendererLoader = source('src/lib/renderer-loader.ts');

    expect(rendererLoader).toContain('HTML artifact preview" sandbox=');
    expect(rendererLoader).toContain('React artifact preview" sandbox=');
  });

  it('does not load a third-party app runtime for artifact previews', () => {
    const rendererLoader = source('src/lib/renderer-loader.ts');

    expect(rendererLoader).not.toContain('@webcontainer/api');
    expect(rendererLoader).not.toContain('WebContainer');
    expect(rendererLoader).not.toContain('staticblitz');
  });

  it('does not globally preload optional external renderer assets on the landing page', () => {
    const page = source('src/pages/index.astro');

    expect(page).not.toContain('rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/mermaid');
    expect(page).not.toContain('rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/katex');
    expect(page).not.toContain('rel="preload" as="script" href="https://cdnjs.cloudflare.com/ajax/libs/prism');
    expect(page).not.toContain('rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/@hpcc-js/wasm');
    expect(page).not.toContain('rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/@terrastruct/d2-js');
    expect(page).not.toContain('rel="preload" as="style" href="https://cdn.jsdelivr.net/npm/katex');
    expect(page).not.toContain('rel="preload" as="style" href="https://cdnjs.cloudflare.com/ajax/libs/prism');
  });

  it('keeps optional renderers dynamically loaded with cross-origin attributes', () => {
    const rendererLoader = source('src/lib/renderer-loader.ts');
    const loadStyleBody = rendererLoader.match(/function loadStyle[\s\S]*?loadingStyles\.set/)?.[0] ?? '';

    expect(rendererLoader).toContain('export function preloadPopular()');
    expect(rendererLoader).toContain('requestIdleCallback');
    expect(rendererLoader).toContain("loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js')");
    expect(rendererLoader).toContain("loadStyle('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css')");
    expect(rendererLoader).toContain("script.crossOrigin = 'anonymous';");
    expect(rendererLoader).toContain("script.referrerPolicy = 'no-referrer';");
    expect(loadStyleBody).toContain("link.crossOrigin = 'anonymous';");
    expect(loadStyleBody).toContain("link.referrerPolicy = 'no-referrer';");
  });
});
