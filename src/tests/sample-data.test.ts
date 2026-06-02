import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('sample onboarding data', () => {
  it('provides safe dummy documentation files for active-session seeding', async () => {
    const { SAMPLE_DATA_DOCUMENTS, createSampleDataFiles } = await import('../lib/sample-data');

    expect(SAMPLE_DATA_DOCUMENTS).toHaveLength(2);
    expect(SAMPLE_DATA_DOCUMENTS.map((doc: { filename: string }) => doc.filename)).toEqual([
      'sample-openapi.md',
      'sample-release-process.md',
    ]);
    expect(SAMPLE_DATA_DOCUMENTS.map((doc: { text: string }) => doc.text).join('\n')).toContain('Acme Sample API');
    expect(SAMPLE_DATA_DOCUMENTS.map((doc: { text: string }) => doc.text).join('\n')).not.toContain('private');

    const files = createSampleDataFiles();
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('sample-openapi.md');
  });

  it('wires a user-invoked sample data action through the active upload path', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('createSampleDataFiles');
    expect(island).toContain('loadSampleData');
    expect(island).toContain('Try sample data');
    expect(island).toContain('processFileUpload(file)');
    expect(island).not.toContain('localStorage.setItem');
    expect(island).not.toContain('sessionStorage.setItem');
  });
});
