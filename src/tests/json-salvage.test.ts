import { describe, expect, it } from 'vitest';
import { salvageObjectArray, salvageStringField } from '../lib/json-salvage';
import { repairDeckSpec } from '../lib/deck-schema';
import { repairDocSpec } from '../lib/doc-schema';

// Mimics an LLM deck response cut off by the token limit mid-third-slide,
// with `title` emitted as an object (a real failure observed in production).
const TRUNCATED_DECK = '{"title":{"heading":"API Docs","subheading":"x","kicker":"y"},"slides":['
  + '{"layout":"title","data":{"heading":"API Docs","subheading":"Improving DX"}},'
  + '{"layout":"bullets","data":{"heading":"Why","bullets":["clarity","consistency"]}},'
  + '{"layout":"stat","data":{"value":"99%';

const TRUNCATED_DOC = '{"title":"Migration Guide","blocks":['
  + '{"type":"heading","level":1,"text":"Overview"},'
  + '{"type":"paragraph","text":"This is the intro."},'
  + '{"type":"bullets","items":["one","two"]},'
  + '{"type":"paragraph","text":"cut off here';

describe('salvageObjectArray', () => {
  it('recovers complete objects and drops the incomplete trailing one', () => {
    const objs = salvageObjectArray(TRUNCATED_DECK, 'slides');
    expect(objs).toHaveLength(2);
    expect(objs[0].layout).toBe('title');
    expect(objs[1].layout).toBe('bullets');
  });

  it('handles strings containing braces without miscounting depth', () => {
    const text = '{"items":[{"t":"a } b { c"},{"t":"plain"}]}';
    const objs = salvageObjectArray(text, 'items');
    expect(objs).toHaveLength(2);
    expect(objs[0].t).toBe('a } b { c');
  });

  it('returns empty when the key or array is absent', () => {
    expect(salvageObjectArray('{"other":1}', 'slides')).toEqual([]);
  });
});

describe('salvageStringField', () => {
  it('extracts a top-level string field', () => {
    expect(salvageStringField('{"title":"Hello \\"World\\"","x":1}', 'title')).toBe('Hello "World"');
    expect(salvageStringField('{"title":{"heading":"x"}}', 'title')).toBeUndefined();
  });
});

describe('truncated-artifact recovery', () => {
  it('renders a partial deck from truncated JSON instead of erroring', () => {
    const spec = repairDeckSpec(TRUNCATED_DECK);
    expect(spec).not.toBeNull();
    expect(spec!.slides.length).toBe(2);
    expect(typeof spec!.title).toBe('string');
  });

  it('renders a partial document from truncated JSON', () => {
    const spec = repairDocSpec(TRUNCATED_DOC);
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe('Migration Guide');
    expect(spec!.blocks.length).toBe(3); // heading, paragraph, bullets; truncated paragraph dropped
  });
});
