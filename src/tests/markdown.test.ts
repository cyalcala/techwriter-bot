import { describe, expect, it } from 'vitest';
import { formatMarkdown, stripDisclaimers } from '../lib/markdown';

describe('chat Markdown presentation', () => {
  it('preserves heading and table boundaries while removing disclaimers', () => {
    const source = [
      'Please note that my knowledge ended in 2024.',
      '',
      '# Political Dynasties',
      '',
      '| Term | Definition | Key features |',
      '| --- | --- | --- |',
      '| Political dynasty | A family holding office across generations. | Name recognition, networks |',
    ].join('\n');

    const cleaned = stripDisclaimers(source);

    expect(cleaned).toContain('# Political Dynasties\n\n| Term | Definition | Key features |');
    expect(cleaned).toContain('| --- | --- | --- |');
    expect(cleaned).not.toContain('Please note');
  });

  it('renders a real table instead of flattening pipe-delimited rows into prose', () => {
    const html = formatMarkdown([
      '# Political Dynasties',
      '',
      '| Term | Definition | Key features |',
      '| --- | --- | --- |',
      '| Political dynasty | A family holding office across generations. | Name recognition |',
    ].join('\n'));

    expect(html).toContain('<h1>Political Dynasties</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Term</th>');
    expect(html).toContain('<td>Political dynasty</td>');
    expect(html).not.toContain('<h1>Political Dynasties |');
  });

  it('does not rewrite indentation inside fenced code blocks', () => {
    const source = [
      'Example:',
      '',
      '```python',
      'def answer():',
      '  return "keep indentation"',
      '```',
    ].join('\n');

    expect(stripDisclaimers(source)).toContain('  return "keep indentation"');
  });
});
