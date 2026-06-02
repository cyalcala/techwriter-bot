import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
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
});
