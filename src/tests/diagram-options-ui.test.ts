import { describe, expect, it } from 'vitest';
import { diagramChoicePrompt, extractDiagramOptions } from '../lib/diagram-options';
import { DIAGRAM_OPTIONS } from '../lib/path-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('diagram choice payload presentation', () => {
  it('extracts valid options and removes the machine wrapper from prose', () => {
    const payload = {
      schemaVersion: 1,
      kind: 'diagram-options',
      recommended: 'architecture',
      confidence: 0.8,
      options: DIAGRAM_OPTIONS,
      prompt: 'Choose a visual angle, or use the recommended view.',
    };
    const result = extractDiagramOptions(`Overview of the topic.\n\n<diagram-options>${JSON.stringify(payload)}</diagram-options>`);

    expect(result.cleanText).toBe('Overview of the topic.');
    expect(result.cleanText).not.toContain('diagram-options');
    expect(result.cleanText).not.toContain('schemaVersion');
    expect(result.payload?.recommended).toBe('architecture');
    expect(result.payload?.options.map((option) => option.type)).toEqual([
      'architecture',
      'workflow',
      'sequence',
      'dataflow',
      'lifecycle',
    ]);
  });

  it('removes malformed choice blocks instead of leaking raw JSON into Markdown', () => {
    const result = extractDiagramOptions('A readable explanation.\n\n<diagram-options>{not valid json}</diagram-options>');

    expect(result.cleanText).toBe('A readable explanation.');
    expect(result.payload).toBeNull();
  });

  it('accepts a choice-plan object and fills missing options canonically', () => {
    const result = extractDiagramOptions('Choose a view.', {
      mode: 'choices',
      recommended: 'workflow',
      confidence: 0.62,
      options: [{ type: 'workflow', label: 'Process', description: 'The path from start to finish' }],
    });

    expect(result.payload?.recommended).toBe('workflow');
    expect(result.payload?.options[0].type).toBe('workflow');
    expect(result.payload?.options).toHaveLength(5);
  });

  it('creates an explicit follow-up prompt for the selected angle', () => {
    const prompt = diagramChoicePrompt(DIAGRAM_OPTIONS[3]);

    expect(prompt).toContain('dataflow diagram');
    expect(prompt).toContain('where information comes from and how it moves');
    expect(prompt).toContain('exactly one readable diagram artifact');
  });
});

describe('diagram choice UI wiring', () => {
  it('renders the choice card and keeps the artifact tray available', () => {
    const messages = source('src/components/ChatMessages.svelte');

    expect(messages).toContain('Choose a visual angle');
    expect(messages).toContain('Recommended');
    expect(messages).toContain('onSelectDiagramOption');
    expect(messages).toContain('Related visual');
    expect(messages).toContain('Open alongside this explanation');
  });

  it('parses the choice wrapper before artifact fallback extraction', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain("extractDiagramOptions(messages[msgIdx].content)");
    expect(island).toContain('diagramOptions: diagramOptions.payload || undefined');
    expect(island).toContain('diagramChoicePrompt(option)');
    expect(island).toContain('onSelectDiagramOption={selectDiagramOption}');
  });
});
