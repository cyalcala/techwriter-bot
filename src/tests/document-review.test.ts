import { describe, expect, it } from 'vitest';
import { parseTerminologyRules, reviewDocument, summarizeOpenApiOperations } from '../lib/document-review';

describe('reviewDocument', () => {
  it('returns no findings for a structurally clean document', () => {
    expect(reviewDocument('# Title\n\n## Setup\n\n[Docs](https://example.com)')).toEqual([]);
  });

  it('reports deterministic structure findings with source lines', () => {
    const findings = reviewDocument(
      '# Title\n\n### Too deep\n\n## Repeated\n\n## Repeated\n\n[Missing]()',
    );

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'heading-level-skip', line: 3 }),
      expect.objectContaining({ rule: 'duplicate-heading', line: 7 }),
      expect.objectContaining({ rule: 'empty-link', line: 9 }),
    ]));
  });

  it('reports an unclosed fenced code block at its opening line', () => {
    expect(reviewDocument('# Title\n\n```ts\nconst open = true;')).toContainEqual(
      expect.objectContaining({ rule: 'unclosed-code-fence', line: 3 }),
    );
  });

  it('uses terminology preferences supplied for this review only', () => {
    const findings = reviewDocument('The whitelist is configured.', [
      { avoid: 'whitelist', prefer: 'allowlist' },
    ]);

    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'terminology', line: 1 }),
    );
    expect(reviewDocument('The whitelist is configured.')).toEqual([]);
  });

  it('parses bounded glossary rules for a single active review', () => {
    expect(parseTerminologyRules([
      'whitelist -> allowlist',
      'blacklist => denylist',
      'master | primary',
      'whitelist -> permitted list',
      'missing delimiter',
      ' -> preferred',
    ].join('\n'))).toEqual({
      rules: [
        { avoid: 'whitelist', prefer: 'allowlist' },
        { avoid: 'blacklist', prefer: 'denylist' },
        { avoid: 'master', prefer: 'primary' },
      ],
      ignoredLines: 2,
    });
  });

  it('applies multiple parsed glossary rules in one review', () => {
    const parsed = parseTerminologyRules('whitelist -> allowlist\nblacklist -> denylist');
    const findings = reviewDocument('Whitelist access is separate from blacklist handling.', parsed.rules);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'terminology', line: 1, message: 'Prefer "allowlist" instead of "whitelist".' }),
      expect.objectContaining({ rule: 'terminology', line: 1, message: 'Prefer "denylist" instead of "blacklist".' }),
    ]));
  });

  it('reports duplicate API endpoint references with source lines', () => {
    const findings = reviewDocument([
      '# API',
      '',
      '## Endpoints',
      '- GET /v1/releases/{id} returns one release.',
      '- POST /v1/releases creates a release.',
      '- GET /v1/releases/{id} fetches one release.',
    ].join('\n'));

    expect(findings).toContainEqual(expect.objectContaining({
      rule: 'api-endpoint-duplicate',
      line: 6,
    }));
  });

  it('reports inconsistent API path parameter names for the same endpoint shape', () => {
    const findings = reviewDocument([
      '# API',
      '',
      '- GET /v1/releases/{id} returns one release.',
      '- GET /v1/releases/{releaseId} returns one release.',
      '- PATCH /v1/releases/{releaseId} updates one release.',
    ].join('\n'));

    expect(findings).toContainEqual(expect.objectContaining({
      rule: 'api-path-parameter-name-mismatch',
      line: 4,
    }));
  });

  it('reports release-note placeholders and missing release identity', () => {
    const findings = reviewDocument([
      '# Release Notes',
      '',
      '## Added',
      '- TODO: describe the user-facing impact.',
    ].join('\n'));

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'release-notes-missing-version-or-date',
        line: 1,
      }),
      expect.objectContaining({
        rule: 'release-notes-placeholder',
        line: 4,
      }),
    ]));
  });

  it('reports breaking release-note entries without migration guidance', () => {
    const findings = reviewDocument([
      '# Release Notes v2.0.0 - 2026-06-04',
      '',
      '## Changed',
      '- Breaking: removed the legacy export format.',
    ].join('\n'));

    expect(findings).toContainEqual(expect.objectContaining({
      rule: 'release-notes-breaking-without-migration-note',
      line: 4,
    }));
  });

  it('does not apply release-note draft checks to ordinary guides', () => {
    const findings = reviewDocument([
      '# Setup Guide',
      '',
      '- TODO: replace this local setup note.',
    ].join('\n'));

    expect(findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'release-notes-placeholder' }),
    ]));
  });

  it('summarizes bounded OpenAPI YAML operations for an explicit review', () => {
    const summary = summarizeOpenApiOperations([
      'openapi: 3.1.0',
      'paths:',
      '  /v1/releases:',
      '    get:',
      '      summary: List releases',
      '    post:',
      '      summary: Create release',
      '      deprecated: true',
    ].join('\n'));

    expect(summary).toEqual({
      operations: [
        {
          method: 'GET',
          path: '/v1/releases',
          line: 4,
          summary: 'List releases',
          deprecated: false,
        },
        {
          method: 'POST',
          path: '/v1/releases',
          line: 6,
          summary: 'Create release',
          deprecated: true,
        },
      ],
      truncated: false,
    });
  });

  it('bounds OpenAPI operation summaries', () => {
    const summary = summarizeOpenApiOperations([
      'openapi: 3.1.0',
      'paths:',
      '  /v1/a:',
      '    get:',
      '  /v1/b:',
      '    post:',
    ].join('\n'), 1);

    expect(summary.operations).toHaveLength(1);
    expect(summary.truncated).toBe(true);
  });

  it('does not review structure or terminology inside fenced code blocks', () => {
    const findings = reviewDocument(
      '# Title\n\n```md\n#### Example heading\nThe whitelist is shown here.\n```\n',
      [{ avoid: 'whitelist', prefer: 'allowlist' }],
    );

    expect(findings).toEqual([]);
  });
});
