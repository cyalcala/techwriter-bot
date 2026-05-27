import { describe, expect, it } from 'vitest';
import { reviewDocument } from '../lib/document-review';

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

  it('does not review structure or terminology inside fenced code blocks', () => {
    const findings = reviewDocument(
      '# Title\n\n```md\n#### Example heading\nThe whitelist is shown here.\n```\n',
      [{ avoid: 'whitelist', prefer: 'allowlist' }],
    );

    expect(findings).toEqual([]);
  });
});
