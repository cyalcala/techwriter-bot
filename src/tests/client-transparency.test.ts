import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function functionBlock(file: string, name: string): string {
  const start = file.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const candidates = ['\n  function ', '\n  async function ']
    .map((pattern) => file.indexOf(pattern, start + 1))
    .filter((index) => index > start);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return next === -1 ? file.slice(start) : file.slice(start, next);
}

describe('client transparency metadata', () => {
  it('exposes the active chat provider pool count as response metadata', () => {
    const chatRoute = source('src/pages/api/chat.ts');

    expect(chatRoute).toContain("headers.set('x-active-provider-count', String(pool.length))");
    expect(chatRoute).toContain("headers.set('x-token-usage'");
    expect(chatRoute).toContain("headers.set('x-request-id', rid)");
  });

  it('wires content-free response metadata into the chat footer', () => {
    const island = source('src/components/ChatIsland.svelte');
    const input = source('src/components/ChatInput.svelte');

    expect(island).toContain('interface ResponseTransparency');
    expect(island).toContain('let responseTransparency = $state<ResponseTransparency | null>(null)');
    expect(island).toContain("headers.get('x-latency-ms')");
    expect(island).toContain("headers.get('x-active-provider-count')");
    expect(island).toContain("headers.get('x-request-id')");
    expect(island).toContain('responseTransparency = captureResponseTransparency');
    expect(island).toContain('{responseTransparency}');

    expect(input).toContain('interface ResponseTransparency');
    expect(input).toContain('responseTransparency: ResponseTransparency | null');
    expect(input).toContain('aria-label="Response details"');
    // Surfaced as a compact "provider · latency" chip with full details in the title tooltip.
    expect(input).toContain('{responseTransparency.provider}');
    expect(input).toContain('responseTransparency.activeProviderCount');
    expect(input).toContain('shortRequestId(responseTransparency.requestId)');
  });

  it('keeps transparency capture active-session only and content-free', () => {
    const island = source('src/components/ChatIsland.svelte');
    const capture = functionBlock(island, 'captureResponseTransparency');

    expect(capture).not.toContain('localStorage');
    expect(capture).not.toContain('sessionStorage');
    expect(capture).not.toContain('indexedDB');
    expect(capture).not.toContain('fetch(');
    expect(capture).not.toContain('messages');
    expect(capture).not.toContain('content');
  });
});
