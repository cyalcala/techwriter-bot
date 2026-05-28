import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('artifact gallery jump controls', () => {
  it('renders an all-session artifact gallery in the split view', () => {
    const split = source('src/components/ArtifactSplitView.svelte');

    expect(split).toContain('galleryEntries');
    expect(split).toContain('Session artifacts');
    expect(split).toContain('selectGalleryEntry(entry)');
    expect(split).toContain('aria-current={isActiveGalleryEntry(entry) ?');
  });

  it('wires gallery selection back to the chat and scrolls the source message', () => {
    const island = source('src/components/ChatIsland.svelte');
    const messages = source('src/components/ChatMessages.svelte');

    expect(island).toContain('onselect={handleChipClick}');
    expect(island).toContain("document.getElementById(`msg-${entry.messageIdx}`)");
    expect(island).toContain("scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(messages).toContain('activeArtifactId');
    expect(messages).toContain('active={activeMessageIdx === i && activeArtifactId === entry.artifact.id}');
  });
});
