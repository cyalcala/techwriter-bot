import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('artifact iframe sandboxing', () => {
  it('sandboxes HTML and React artifact iframes', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'renderer-loader.ts'), 'utf8');

    expect(source).toContain('HTML artifact preview" sandbox=');
    expect(source).toContain('React artifact preview" sandbox=');
  });

  it('does not load a third-party app runtime for artifact previews', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'renderer-loader.ts'), 'utf8');

    expect(source).not.toContain('@webcontainer/api');
    expect(source).not.toContain('WebContainer');
    expect(source).not.toContain('staticblitz');
  });
});
