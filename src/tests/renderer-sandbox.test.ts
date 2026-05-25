import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('artifact iframe sandboxing', () => {
  it('sandboxes HTML, React, and WebContainer artifact iframes', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'renderer-loader.ts'), 'utf8');

    expect(source).toContain('HTML artifact preview" sandbox=');
    expect(source).toContain('React artifact preview" sandbox=');
    expect(source).toMatch(/<iframe src="\$\{url\}"[^>]*sandbox=/);
  });

  it('loads the published WebContainer ESM entrypoint in credentialless isolation mode', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'renderer-loader.ts'), 'utf8');

    expect(source).toContain('@webcontainer/api@1.6.4/+esm');
    expect(source).toContain("coep: 'credentialless'");
    expect(source).not.toContain('webcontainer.api.min.js');
  });
});
