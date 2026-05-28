import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiFiles = [
  'chat.ts',
  'embed.ts',
  'rag-store.ts',
  'render-artifact.ts',
  'search-credits.ts',
  'debug.ts',
  'debug-ai.ts',
  'health.ts',
  'summarize.ts',
  'version.ts',
  'tool-graph-lookup.ts',
];

describe('API route response consistency', () => {
  for (const file of apiFiles) {
    it(`${file} uses shared response helpers for JSON responses`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'pages', 'api', file), 'utf8');

      expect(source).toContain("from '../../lib/api-response'");
      expect(source).not.toMatch(/new Response\s*\(\s*JSON\.stringify/);
      expect(source).toMatch(/\b(createRequestId|jsonResponse|apiError)\b/);
    });
  }
});
