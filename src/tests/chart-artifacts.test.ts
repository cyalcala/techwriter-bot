import { describe, expect, it } from 'vitest';
import { looksLikeVegaSpec, normalizeArtifactType, validateArtifact } from '../lib/artifact-types';
import { isChartGenerationRequest } from '../lib/path-router';

describe('looksLikeVegaSpec', () => {
  it('detects Vega-Lite spec with $schema', () => {
    const spec = JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'bar',
      encoding: { x: { field: 'a', type: 'nominal' } },
    });
    expect(looksLikeVegaSpec(spec)).toBe(true);
  });

  it('detects spec with mark and encoding (no $schema)', () => {
    const spec = JSON.stringify({
      mark: 'line',
      encoding: { x: { field: 'date', type: 'temporal' } },
    });
    expect(looksLikeVegaSpec(spec)).toBe(true);
  });

  it('detects spec with layer array', () => {
    const spec = JSON.stringify({
      layer: [
        { mark: 'line', encoding: {} },
        { mark: 'point', encoding: {} },
      ],
    });
    expect(looksLikeVegaSpec(spec)).toBe(true);
  });

  it('detects full Vega spec with data + marks + scales', () => {
    const spec = JSON.stringify({
      data: [{ name: 'table' }],
      scales: [{ name: 'x', type: 'linear' }],
      marks: [{ type: 'rect' }],
    });
    expect(looksLikeVegaSpec(spec)).toBe(true);
  });

  it('rejects plain JSON object', () => {
    expect(looksLikeVegaSpec('{"name":"hello","value":42}')).toBe(false);
  });

  it('rejects JSON array', () => {
    expect(looksLikeVegaSpec('[1,2,3]')).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(looksLikeVegaSpec('not json')).toBe(false);
  });

  it('rejects empty object', () => {
    expect(looksLikeVegaSpec('{}')).toBe(false);
  });
});

describe('normalizeArtifactType for charts', () => {
  it('maps "vega" to vega type', () => {
    expect(normalizeArtifactType('vega')).toBe('vega');
  });

  it('maps "vega-lite" to vega type', () => {
    expect(normalizeArtifactType('vega-lite')).toBe('vega');
  });

  it('maps "vegalite" to vega type', () => {
    expect(normalizeArtifactType('vegalite')).toBe('vega');
  });

  it('promotes JSON to vega when spec has $schema', () => {
    const spec = JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'bar',
      encoding: {},
    });
    expect(normalizeArtifactType('json', spec)).toBe('vega');
  });

  it('does not promote plain JSON to vega', () => {
    expect(normalizeArtifactType('json', '{"name":"test"}')).toBeNull();
  });
});

describe('validateArtifact for vega type', () => {
  it('validates a well-formed Vega-Lite spec', () => {
    const spec = JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ a: 'A', b: 28 }] },
      mark: 'bar',
      encoding: {
        x: { field: 'a', type: 'nominal' },
        y: { field: 'b', type: 'quantitative' },
      },
    });
    expect(validateArtifact('vega', spec)).toBe(true);
  });

  it('rejects plain JSON', () => {
    expect(validateArtifact('vega', '{"hello":"world"}')).toBe(false);
  });
});

describe('isChartGenerationRequest', () => {
  it('detects "create a bar chart"', () => {
    expect(isChartGenerationRequest('create a bar chart of sales by quarter')).toBe(true);
  });

  it('detects "pie chart"', () => {
    expect(isChartGenerationRequest('show me a pie chart of market share')).toBe(true);
  });

  it('detects "visualize the data"', () => {
    expect(isChartGenerationRequest('visualize the data in a scatter plot')).toBe(true);
  });

  it('detects "line chart"', () => {
    expect(isChartGenerationRequest('make a line chart of temperature over time')).toBe(true);
  });

  it('detects "histogram"', () => {
    expect(isChartGenerationRequest('create a histogram of ages')).toBe(true);
  });

  it('detects "heatmap"', () => {
    expect(isChartGenerationRequest('draw a heatmap of correlations')).toBe(true);
  });

  it('detects "plot the data"', () => {
    expect(isChartGenerationRequest('plot the revenue data for 2025')).toBe(true);
  });

  it('does not trigger on deck requests', () => {
    expect(isChartGenerationRequest('create a slide deck about charts')).toBe(false);
  });

  it('does not trigger on plain text', () => {
    expect(isChartGenerationRequest('tell me about photosynthesis')).toBe(false);
  });

  it('detects "vega-lite"', () => {
    expect(isChartGenerationRequest('create a vega-lite visualization')).toBe(true);
  });

  it('detects "data visualization"', () => {
    expect(isChartGenerationRequest('create a data visualization of GDP')).toBe(true);
  });

  it('detects "time series"', () => {
    expect(isChartGenerationRequest('show a time series of stock prices')).toBe(true);
  });
});
