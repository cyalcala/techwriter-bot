// Regression tests for json-salvage edge cases surfaced by the 2026-07-11
// end-to-end audit (docs/E2E_AUDIT_2026-07-11.md). Before the fix, a non-object
// element appearing BEFORE the first object in a slides/blocks array — a string
// containing `]` or `{`, or a nested array — made scanObjectsFrom walk into that
// value and abort on a stray bracket, silently losing EVERY salvageable object.
// And salvageFirstObjectArray grabbed the first object-array anywhere, so a
// coordinate array like [{x,y}] could hijack a deck. Both are fixed now.
import { describe, expect, it } from 'vitest';
import { salvageObjectArray } from '../lib/json-salvage';
import { repairDeckSpec } from '../lib/deck-schema';
import { repairDocSpec } from '../lib/doc-schema';

describe('json-salvage: non-object elements before the first object', () => {
  it('recovers objects after a leading string that contains "]"', () => {
    const t = '{"title":"T","blocks":["see [1] for refs",{"type":"paragraph","text":"hello"},{"type":"paragraph","text":"tr';
    const objs = salvageObjectArray(t, 'blocks');
    expect(objs).toEqual([{ type: 'paragraph', text: 'hello' }]);
  });

  it('recovers objects after a leading string that contains "{"', () => {
    const t = '{"title":"T","blocks":["prefix { weird",{"type":"paragraph","text":"hello"},{"type":"paragraph","text":"tr';
    const objs = salvageObjectArray(t, 'blocks');
    expect(objs).toEqual([{ type: 'paragraph', text: 'hello' }]);
  });

  it('recovers objects after a leading nested array', () => {
    const t = '{"blocks":[["a","b"],{"type":"paragraph","text":"hello"},{"type":"paragraph","text":"tr';
    const objs = salvageObjectArray(t, 'blocks');
    expect(objs).toEqual([{ type: 'paragraph', text: 'hello' }]);
  });
});

describe('json-salvage: realistic truncation still works', () => {
  it('keeps complete leading document blocks and drops the truncated tail', () => {
    const t = '{"title":"T","summary":"the \\"blocks\\" [here] are","blocks":[{"type":"paragraph","text":"hello"},{"type":"paragraph","text":"tr';
    const spec = repairDocSpec(t);
    expect(spec?.title).toBe('T');
    expect(spec?.blocks).toEqual([{ type: 'paragraph', text: 'hello' }]);
  });

  it('keeps a complete deck slide whose bullet text contains "["', () => {
    const t = '{"title":"D","slides":[{"layout":"bullets","data":{"bullets":["arr[0] use"]}},{"layout":"quote","data":{"text":"tr';
    const spec = repairDeckSpec(t);
    expect(spec?.slides).toHaveLength(1);
    expect(spec?.slides[0]).toEqual({ layout: 'bullets', data: { bullets: ['arr[0] use'] } });
  });
});

describe('json-salvage: last-resort array selection', () => {
  it('skips a non-slide coordinate array and finds the real slides', () => {
    const t = '{"deckMeta":{"points":[{"x":1,"y":2},{"x":3,"y":4}]},"myslides":[{"layout":"bullets","data":{"bullets":["a real bullet"]}},{"layout":"quote","data":{"text":"tr';
    const spec = repairDeckSpec(t);
    expect(spec?.slides).toHaveLength(1);
    expect(spec?.slides[0].layout).toBe('bullets');
    expect(spec?.slides[0].data).toEqual({ bullets: ['a real bullet'] });
  });
});
