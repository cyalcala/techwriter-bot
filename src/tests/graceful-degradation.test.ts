import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function functionBlock(file: string, name: string): string {
  const start = file.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = file.indexOf('\n  function ', start + 1);
  return next === -1 ? file.slice(start) : file.slice(start, next);
}

describe('graceful degradation notices', () => {
  it('treats refresh or navigation as the end of active-session content', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('const showActiveSessionResetNotice = $derived(showSuggestedPrompts)');
    expect(island).toContain('{#if showActiveSessionResetNotice}');
    expect(island).toContain('aria-label="Active session refresh notice"');
    expect(island).toContain('Refresh or navigation clears this open-session chat.');
    expect(island).toContain('Export session before leaving');
    expect(island).toContain('Import session to restore messages, artifacts, and document metadata.');
    expect(island).not.toContain('localStorage.setItem');
    expect(island).not.toContain('sessionStorage.setItem');
  });

  it('continues without document excerpts when embedding retrieval is unavailable', () => {
    const island = source('src/components/ChatIsland.svelte');
    const input = source('src/components/ChatInput.svelte');
    const doSend = functionBlock(island, 'doSend');

    expect(island).toContain('let ragRetrievalUnavailable = $state(false)');
    expect(island).toContain('{ragRetrievalUnavailable}');
    expect(input).toContain('ragRetrievalUnavailable?: boolean');
    expect(input).toContain('Document context temporarily unavailable.');
    expect(input).toContain('Continuing without uploaded document context.');
    expect(doSend).toContain('if (embedFailed) {');
    expect(doSend).toContain('ragRetrievalUnavailable = true');
    expect(doSend).toContain('} else if (chunks.length > 0) {');
    expect(doSend).toContain('} else {');
    expect(doSend).toContain('createRagRetrievalMessage({ embedFailed: false })');
    expect(doSend).not.toContain('createRagRetrievalMessage({ embedFailed })');
    expect(doSend.indexOf("fetch('/api/chat'")).toBeGreaterThan(doSend.indexOf('if (embedFailed) {'));
    expect(doSend.indexOf('DOCUMENT CONTEXT')).toBeGreaterThan(doSend.indexOf('} else if (chunks.length > 0) {'));
    expect(island).not.toContain('localStorage.setItem');
    expect(island).not.toContain('sessionStorage.setItem');
  });

  it('continues without live results when search is unavailable and shows a warning', () => {
    const chatRoute = source('src/pages/api/chat.ts');
    const island = source('src/components/ChatIsland.svelte');
    const input = source('src/components/ChatInput.svelte');

    expect(chatRoute).toContain("headers.set('x-search-unavailable', 'true')");
    expect(island).toContain('let liveSearchUnavailable = $state(false)');
    expect(island).toContain("response.headers.get('x-search-unavailable') === 'true'");
    expect(island).toContain('{liveSearchUnavailable}');
    expect(input).toContain('liveSearchUnavailable?: boolean');
    expect(input).toContain('Live search temporarily unavailable.');
    expect(input).toContain('Continuing without live results.');
    expect(island).not.toContain('localStorage.setItem');
    expect(island).not.toContain('sessionStorage.setItem');
  });
});
