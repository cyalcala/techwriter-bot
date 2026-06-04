import { describe, expect, it } from 'vitest';
import { parseTerminologyRules, reviewDocument } from '../lib/document-review';

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

  it('does not review structure or terminology inside fenced code blocks', () => {
    const findings = reviewDocument(
      '# Title\n\n```md\n#### Example heading\nThe whitelist is shown here.\n```\n',
      [{ avoid: 'whitelist', prefer: 'allowlist' }],
    );

    expect(findings).toEqual([]);
  });
});
