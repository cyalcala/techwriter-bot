import { describe, expect, it } from 'vitest';
import { DECK_MAX_SLIDES, looksLikeDeckSpec, parseDeckSpec, repairDeckSpec } from '../lib/deck-schema';
import { normalizeArtifactType, validateArtifact } from '../lib/artifact-types';
import { isArtifactGenerationRequest, isDeckGenerationRequest } from '../lib/path-router';

const VALID_DECK = JSON.stringify({
  title: 'Docs Platform Pitch',
  subtitle: 'Q3 plan',
  slides: [
    { layout: 'title', data: { heading: 'Docs Platform', subheading: 'Q3 plan', kicker: 'Proposal' } },
    { layout: 'agenda', data: { heading: 'Agenda', items: ['Problem', 'Approach', 'Timeline'] } },
    { layout: 'bullets', data: { heading: 'Problem', bullets: ['Docs drift from code', 'No review gate'], icon: '📉' } },
    { layout: 'two-column', data: { heading: 'Options', leftTitle: 'Build', leftItems: ['Control'], rightTitle: 'Buy', rightItems: ['Speed'] } },
    { layout: 'stat', data: { heading: 'Impact', value: '43%', label: 'fewer support tickets' } },
    { layout: 'code', data: { heading: 'Config', language: 'yaml', code: 'docs:\n  source: ./src' } },
    { layout: 'closing', data: { heading: 'Next steps', items: ['Approve budget'] } },
  ],
});

describe('deck schema', () => {
  it('parses a clean deck spec', () => {
    const spec = repairDeckSpec(VALID_DECK);
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe('Docs Platform Pitch');
    expect(spec!.slides).toHaveLength(7);
    expect(spec!.slides[0].layout).toBe('title');
  });

  it('parses despite markdown fences, surrounding prose, and trailing commas', () => {
    const fenced = 'Here is your deck:\n```json\n' + VALID_DECK.replace('"slides":[', '"slides":[').replace(/}\]$/, '},]') + '\n```\nEnjoy!';
    expect(parseDeckSpec(fenced)).not.toBeNull();
    const spec = repairDeckSpec(fenced);
    expect(spec).not.toBeNull();
    expect(spec!.slides.length).toBeGreaterThan(0);
  });

  it('strictly enforces the slide cap by truncation', () => {
    const many = {
      title: 'Big deck',
      slides: Array.from({ length: 14 }, (_, i) => ({ layout: 'bullets', data: { heading: `S${i}`, bullets: ['a'] } })),
    };
    const spec = repairDeckSpec(JSON.stringify(many));
    expect(spec).not.toBeNull();
    expect(spec!.slides).toHaveLength(DECK_MAX_SLIDES);
    expect(DECK_MAX_SLIDES).toBe(8);
  });

  it('coerces unknown layouts to bullets and aliases known synonyms', () => {
    const spec = repairDeckSpec(JSON.stringify({
      title: 'T',
      slides: [
        { layout: 'cover', data: { heading: 'x' } },
        { layout: 'mystery-layout', data: { bullets: ['y'] } },
      ],
    }));
    expect(spec!.slides[0].layout).toBe('title');
    expect(spec!.slides[1].layout).toBe('bullets');
  });

  it('rejects unsalvageable input', () => {
    expect(repairDeckSpec('not json at all')).toBeNull();
    expect(repairDeckSpec('{"title":"x"}')).toBeNull();
    expect(repairDeckSpec('{"title":"x","slides":[]}')).toBeNull();
    expect(looksLikeDeckSpec('{"mark":"bar"}')).toBe(false);
  });

  it('defaults missing title and non-object slide data', () => {
    const spec = repairDeckSpec(JSON.stringify({ slides: [{ layout: 'bullets', data: 'oops' }] }));
    expect(spec!.title).toBe('Presentation');
    expect(spec!.slides[0].data).toEqual({});
  });
});

describe('deck artifact type registration', () => {
  it('validates deck artifacts through validateArtifact', () => {
    expect(validateArtifact('deck', VALID_DECK)).toBe(true);
    expect(validateArtifact('deck', '{"nope":true}')).toBe(false);
  });

  it('normalizes deck aliases and sniffs deck JSON in json fences', () => {
    expect(normalizeArtifactType('deck')).toBe('deck');
    expect(normalizeArtifactType('slides')).toBe('deck');
    expect(normalizeArtifactType('presentation')).toBe('deck');
    expect(normalizeArtifactType('json', VALID_DECK)).toBe('deck');
    expect(normalizeArtifactType('json', '{"mark":"bar","encoding":{}}')).toBe('vega');
  });
});

describe('deck request routing', () => {
  it('detects deck generation requests', () => {
    expect(isArtifactGenerationRequest('create a presentation about our API')).toBe(true);
    expect(isArtifactGenerationRequest('make me a pitch deck for the docs platform')).toBe(true);
    expect(isDeckGenerationRequest('create a presentation about our API')).toBe(true);
    expect(isDeckGenerationRequest('make slides for the sprint review')).toBe(true);
    expect(isDeckGenerationRequest('draw a flowchart of the login flow')).toBe(false);
  });
});

describe('deck prompt contract', () => {
  it('injects deck rules instead of diagram rules for deck requests', async () => {
    const { buildSystemPrompt } = await import('../lib/prompts');
    const base = { path: 'fast' as const, needsArtifact: true };
    const deckPrompt = buildSystemPrompt('make a presentation about x', { ...base, needsDeck: true });
    const diagramPrompt = buildSystemPrompt('draw a diagram of x', { ...base, needsDeck: false });
    expect(deckPrompt).toContain('type="deck"');
    expect(deckPrompt).toContain('NEVER more than 8');
    expect(deckPrompt).not.toContain('Mermaid flowcharts EXACT syntax');
    expect(diagramPrompt).toContain('Mermaid flowcharts EXACT syntax');
    expect(diagramPrompt).not.toContain('type="deck"');
  });
});
