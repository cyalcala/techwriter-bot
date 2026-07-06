import { describe, expect, it } from 'vitest';
import { repairDocSpec, looksLikeDocSpec, docToMarkdown, DOC_MAX_BLOCKS } from '../lib/doc-schema';
import { normalizeArtifactType, validateArtifact, getDefaultArtifactTitle } from '../lib/artifact-types';
import { isArtifactGenerationRequest, isDocGenerationRequest, isDeckGenerationRequest } from '../lib/path-router';

const VALID_DOC = JSON.stringify({
  title: 'API Migration Guide',
  subtitle: 'v2 → v3',
  blocks: [
    { type: 'heading', level: 1, text: 'Overview' },
    { type: 'paragraph', text: 'This guide covers the migration.' },
    { type: 'bullets', items: ['Auth changes', 'New endpoints'] },
    { type: 'numbered', items: ['Update keys', 'Test'] },
    { type: 'code', language: 'bash', code: 'npm i api@3' },
    { type: 'quote', text: 'Migrate early.', attribution: 'Docs team' },
    { type: 'table', headers: ['Old', 'New'], rows: [['/v2/x', '/v3/x']] },
  ],
});

describe('doc schema', () => {
  it('parses and repairs a full document spec', () => {
    const spec = repairDocSpec(VALID_DOC);
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe('API Migration Guide');
    expect(spec!.subtitle).toBe('v2 → v3');
    expect(spec!.blocks).toHaveLength(7);
    expect(spec!.blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Overview' });
  });

  it('tolerates fences and prose around the JSON', () => {
    const spec = repairDocSpec('Here you go:\n```json\n' + VALID_DOC + '\n```');
    expect(spec).not.toBeNull();
    expect(spec!.blocks.length).toBe(7);
  });

  it('coerces unknown block types with text to paragraphs and drops empties', () => {
    const spec = repairDocSpec(JSON.stringify({
      title: 'T',
      blocks: [
        { type: 'mystery', text: 'salvage me' },
        { type: 'paragraph' },
        { type: 'heading', level: 9, text: 'clamped level' },
      ],
    }));
    expect(spec!.blocks[0]).toEqual({ type: 'paragraph', text: 'salvage me' });
    expect(spec!.blocks[1]).toEqual({ type: 'heading', level: 2, text: 'clamped level' });
    expect(spec!.blocks).toHaveLength(2);
  });

  it('caps block count and rejects unsalvageable input', () => {
    const many = { title: 'X', blocks: Array.from({ length: 200 }, () => ({ type: 'paragraph', text: 'p' })) };
    expect(repairDocSpec(JSON.stringify(many))!.blocks).toHaveLength(DOC_MAX_BLOCKS);
    expect(repairDocSpec('nope')).toBeNull();
    expect(repairDocSpec('{"title":"x"}')).toBeNull();
    expect(repairDocSpec('{"title":"x","blocks":[]}')).toBeNull();
  });

  it('serializes to markdown with structure preserved', () => {
    const md = docToMarkdown(repairDocSpec(VALID_DOC)!);
    expect(md).toContain('# API Migration Guide');
    expect(md).toContain('## Overview');
    expect(md).toContain('- Auth changes');
    expect(md).toContain('1. Update keys');
    expect(md).toContain('```bash');
    expect(md).toContain('> Migrate early.');
    expect(md).toContain('| Old | New |');
  });
});

describe('document artifact registration', () => {
  it('validates and titles document artifacts', () => {
    expect(validateArtifact('document', VALID_DOC)).toBe(true);
    expect(validateArtifact('document', '{"nope":1}')).toBe(false);
    expect(getDefaultArtifactTitle('document')).toBe('Document');
  });

  it('normalizes document aliases and sniffs document JSON', () => {
    expect(normalizeArtifactType('document')).toBe('document');
    expect(normalizeArtifactType('report')).toBe('document');
    expect(normalizeArtifactType('doc')).toBe('document');
    expect(normalizeArtifactType('json', VALID_DOC)).toBe('document');
  });

  it('does not misclassify deck JSON as document', () => {
    const deck = JSON.stringify({ title: 'D', slides: [{ layout: 'title', data: { heading: 'x' } }] });
    expect(normalizeArtifactType('json', deck)).toBe('deck');
  });
});

describe('document request routing', () => {
  it('detects document requests and yields to deck', () => {
    expect(isArtifactGenerationRequest('write a report on Q3 revenue')).toBe(true);
    expect(isDocGenerationRequest('write a report on Q3 revenue')).toBe(true);
    expect(isDocGenerationRequest('create a one-pager about the launch')).toBe(true);
    expect(isDocGenerationRequest('make a presentation about Q3')).toBe(false); // deck wins
    expect(isDeckGenerationRequest('make a presentation about Q3')).toBe(true);
    expect(isDocGenerationRequest('draw a flowchart')).toBe(false);
  });
});

describe('document prompt contract', () => {
  it('injects document rules only for document requests', async () => {
    const { buildSystemPrompt } = await import('../lib/prompts');
    const base = { path: 'fast' as const, needsArtifact: true };
    const docPrompt = buildSystemPrompt('write a report', { ...base, needsDoc: true });
    const deckPrompt = buildSystemPrompt('make a deck', { ...base, needsDeck: true });
    expect(docPrompt).toContain('type="document"');
    expect(docPrompt).not.toContain('type="deck"');
    expect(deckPrompt).not.toContain('type="document"');
  });
});
