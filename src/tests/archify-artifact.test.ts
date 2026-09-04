import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARCHIFY_STATIC_DIAGRAMS,
  parseArchifyArtifact,
  renderArchifyArtifactFrame,
  validateArchifyArtifact,
} from '../lib/archify-artifact';
import { normalizeArtifactType, validateArtifact } from '../lib/artifact-types';
import { detectAllArtifacts } from '../lib/artifact-detector';
import { ArtifactStreamParser, type Artifact } from '../lib/stream-parser';
import { isArchifyGenerationRequest } from '../lib/path-router';
import { buildSystemPrompt } from '../lib/prompts';

const architectureReference = JSON.stringify({
  schemaVersion: 1,
  diagramId: 'techwriter-architecture',
  diagramType: 'architecture',
});

describe('Archify static reference contract', () => {
  it('accepts every checked-in diagram with its exact allowlisted type', () => {
    for (const [diagramId, diagram] of Object.entries(ARCHIFY_STATIC_DIAGRAMS)) {
      const result = parseArchifyArtifact(JSON.stringify({ schemaVersion: 1, diagramId, diagramType: diagram.type }));
      expect(result).toEqual({
        ok: true,
        value: { schemaVersion: 1, diagramId, diagramType: diagram.type },
      });
    }
  });

  it('rejects paths, URLs, unknown ids, type mismatches, and oversized source', () => {
    expect(parseArchifyArtifact('{"schemaVersion":1,"diagramId":"techwriter-architecture","diagramType":"architecture","src":"https://evil.invalid"}').ok).toBe(false);
    expect(parseArchifyArtifact('{"schemaVersion":1,"diagramId":"../../private","diagramType":"architecture"}').ok).toBe(false);
    expect(parseArchifyArtifact('{"schemaVersion":1,"diagramId":"techwriter-architecture","diagramType":"workflow"}').ok).toBe(false);
    expect(parseArchifyArtifact('x'.repeat(16 * 1024 + 1))).toEqual({ ok: false, error: 'Archify references must be a small JSON object.' });
  });

  it('renders a sandboxed iframe without same-origin or external URL authority', () => {
    const html = renderArchifyArtifactFrame(architectureReference);

    expect(html).toContain('sandbox="allow-scripts allow-downloads"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('src="/diagrams/techwriter-architecture.html"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it('registers the type in the canonical artifact classifier', () => {
    expect(normalizeArtifactType('archify')).toBe('archify');
    expect(validateArchifyArtifact(architectureReference)).toBe(true);
    expect(validateArtifact('archify', architectureReference)).toBe(true);
    expect(validateArtifact('archify', '{"diagramId":"nope"}')).toBe(false);
  });
});

describe('Archify parser and routing integration', () => {
  it('detects a complete tagged Archify artifact and preserves its JSON reference', () => {
    const source = `<artifact type="archify" title="Architecture">${architectureReference}</artifact>`;
    const result = detectAllArtifacts(source, []);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({ type: 'archify', title: 'Architecture', code: architectureReference });
  });

  it('parses an Archify tag when it is split across a stream', () => {
    const artifacts: Artifact[] = [];
    const parser = new ArtifactStreamParser((artifact) => artifacts.push(artifact), () => {});
    parser.feed('<artifact type="archify" title="Architecture">{"schemaVersion":1,"diagramId":"techwriter-');
    parser.feed('architecture","diagramType":"architecture"}</artifact>');
    parser.flush();

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ type: 'archify', code: architectureReference });
  });

  it('routes only explicit target-scoped requests to the static Archify contract', () => {
    expect(isArchifyGenerationRequest('Show the Techwriter Bot provider circuit lifecycle diagram')).toBe(true);
    expect(isArchifyGenerationRequest('Create an Archify diagram for a new unrelated payment system')).toBe(false);
    expect(isArchifyGenerationRequest('Show this codebase architecture in Mermaid')).toBe(false);
  });

  it('injects the static contract ahead of generic diagram instructions', () => {
    const prompt = buildSystemPrompt('Show the Techwriter Bot architecture', {
      path: 'fast',
      needsArtifact: true,
      needsArchify: true,
    });

    expect(prompt).toContain('STATIC ARCHIFY RULES');
    expect(prompt).toContain('techwriter-architecture/architecture');
    expect(prompt).not.toContain('Mermaid flowcharts EXACT syntax');
  });
});

describe('checked-in Archify delivery outputs', () => {
  it('keeps all five static pages and receipts hardened and byte-attested', () => {
    const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    const diagramHeaders = headers.slice(headers.indexOf('/diagrams/*'));

    expect(diagramHeaders).toContain('X-Frame-Options: SAMEORIGIN');
    expect(diagramHeaders).toContain("frame-ancestors 'self'");
    expect(diagramHeaders).toContain("connect-src 'none'");

    for (const [diagramId, diagram] of Object.entries(ARCHIFY_STATIC_DIAGRAMS)) {
      const page = readFileSync(join(process.cwd(), 'public', diagram.src.replace(/^\//, '')), 'utf8');
      const receipt = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'diagrams', 'receipts', `${diagramId}.receipt.json`), 'utf8'));

      expect(page).toContain('Content-Security-Policy');
      expect(page).toContain("connect-src 'none'");
      expect(page).toContain("frame-ancestors 'self'");
      expect(page).not.toMatch(/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
      expect(page).not.toContain('"href":"https://');
      expect(receipt).toMatchObject({ diagramId, type: diagram.type, ok: true, hardening: { staticOnly: true } });
      expect(receipt.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
