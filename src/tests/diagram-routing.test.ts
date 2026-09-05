import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_OPTIONS,
  inferDiagramPlan,
  isAutomaticDiagramGenerationRequest,
  isDiagramGenerationRequest,
  shouldOfferDiagramChoices,
  toDiagramChoicePayload,
} from '../lib/path-router';
import { buildSystemPrompt } from '../lib/prompts';

describe('automatic diagram routing', () => {
  it('selects architecture for a clear structural question', () => {
    const plan = inferDiagramPlan('Show me the architecture of this app');

    expect(plan.mode).toBe('automatic');
    expect(plan.recommended).toBe('architecture');
    expect(plan.confidence).toBeGreaterThanOrEqual(0.8);
    expect(plan.options.map((option) => option.type)).toEqual([
      'architecture',
      'workflow',
      'sequence',
      'dataflow',
      'lifecycle',
    ]);
    expect(plan.archifyEligible).toBe(true);
  });

  it('selects lifecycle for state and recovery language', () => {
    const plan = inferDiagramPlan('Explain the provider retry lifecycle from open to recovery');

    expect(plan.mode).toBe('automatic');
    expect(plan.recommended).toBe('lifecycle');
    expect(isAutomaticDiagramGenerationRequest('Explain the provider retry lifecycle from open to recovery')).toBe(true);
  });

  it('automatically visualizes a substantive conceptual topic without a diagram command', () => {
    const plan = inferDiagramPlan('Discuss political dynasties');

    expect(plan.mode).toBe('automatic');
    expect(plan.recommended).toBe('architecture');
    expect(plan.rationale).toContain('architecture');
  });

  it('returns a recommended view plus all optional angles for an underspecified diagram request', () => {
    const plan = inferDiagramPlan('Create a diagram about this topic');
    const payload = toDiagramChoicePayload(plan);

    expect(plan.mode).toBe('choices');
    expect(plan.recommended).toBe('architecture');
    expect(shouldOfferDiagramChoices('Create a diagram about this topic')).toBe(true);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      kind: 'diagram-options',
      recommended: 'architecture',
      prompt: 'Choose a visual angle, or use the recommended view.',
    });
    expect(payload?.options).toEqual(DIAGRAM_OPTIONS);
  });

  it('exposes choices when two explicit views are equally plausible', () => {
    const plan = inferDiagramPlan('Show an architecture or workflow diagram for this app');

    expect(plan.mode).toBe('choices');
    expect(plan.recommended).toBe('architecture');
    expect(plan.options.map((option) => option.type).slice(0, 2)).toEqual(['architecture', 'workflow']);
  });

  it('does not convert code, document, chart, or ordinary chat requests into diagram intent', () => {
    expect(isDiagramGenerationRequest('Write a TypeScript function that formats dates')).toBe(false);
    expect(isDiagramGenerationRequest('Create a report about political dynasties')).toBe(false);
    expect(isDiagramGenerationRequest('Create a bar chart from these values')).toBe(false);
    expect(isDiagramGenerationRequest('What is the capital of France?')).toBe(false);
  });

  it('keeps unrelated custom diagram topics on the generic route', () => {
    const plan = inferDiagramPlan('Create a Mermaid workflow diagram for a payment system');

    expect(plan.mode).toBe('automatic');
    expect(plan.recommended).toBe('workflow');
    expect(plan.archifyEligible).toBe(false);
  });
});

describe('diagram prompt contract', () => {
  it('asks for normal prose plus one artifact on the automatic path', () => {
    const plan = inferDiagramPlan('Discuss political dynasties');
    const prompt = buildSystemPrompt('Discuss political dynasties', {
      path: 'balanced',
      needsArtifact: false,
      needsVisualExplanation: true,
      diagramPlan: plan,
    });

    expect(prompt).toContain('VISUAL EXPLANATION RULES');
    expect(prompt).toContain('Answer the user normally first');
    expect(prompt).toContain('exactly ONE diagram artifact');
    expect(prompt).toContain('"recommended":"architecture"');
    expect(prompt).not.toContain('as your entire response');
  });

  it('asks for a compact option payload when the visual angle is uncertain', () => {
    const plan = inferDiagramPlan('Create a diagram about this topic');
    const prompt = buildSystemPrompt('Create a diagram about this topic', {
      path: 'balanced',
      needsArtifact: false,
      diagramPlan: plan,
    });

    expect(prompt).toContain('VISUAL CHOICE RULES');
    expect(prompt).toContain('<diagram-options>JSON</diagram-options>');
    expect(prompt).toContain('SERVER DIAGRAM OPTIONS');
    expect(prompt).toContain('"kind":"diagram-options"');
    expect(prompt).toContain('"recommended":"architecture"');
    expect(prompt).toContain('"type":"lifecycle"');
  });

  it('keeps explicit Archify output constrained to the static reference contract', () => {
    const prompt = buildSystemPrompt('Show the Techwriter Bot architecture diagram', {
      path: 'fast',
      needsArtifact: true,
      needsArchify: true,
    });

    expect(prompt).toContain('STATIC ARCHIFY RULES');
    expect(prompt).toContain('concise explanation');
    expect(prompt).toContain('techwriter-architecture/architecture');
    expect(prompt).not.toContain('VISUAL CHOICE RULES');
  });

  it('keeps chart, deck, and document contracts ahead of visual suggestions', () => {
    const plan = inferDiagramPlan('Create a workflow diagram for the presentation');
    const prompt = buildSystemPrompt('Create a workflow diagram for the presentation', {
      path: 'fast',
      needsArtifact: true,
      needsDeck: true,
      diagramPlan: plan,
    });

    expect(prompt).toContain('PRESENTATION RULES');
    expect(prompt).not.toContain('VISUAL EXPLANATION RULES');
  });
});
