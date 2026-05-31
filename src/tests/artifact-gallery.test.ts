import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactRegenerationPrompt } from '../lib/artifact-repair';
import type { ArtifactEntry } from '../lib/artifact-queue';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('artifact gallery jump controls', () => {
  const entry: ArtifactEntry = {
    messageIdx: 4,
    ts: 100,
    artifact: {
      id: 'mermaid-checkout',
      type: 'mermaid',
      title: 'Checkout Flow',
      placement: 'inline',
      code: 'graph TD\nA-->B',
    },
  };

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

  it('creates a bounded prompt for regenerating the selected artifact', () => {
    const prompt = createArtifactRegenerationPrompt(entry);

    expect(prompt).toContain('Regenerate this mermaid artifact');
    expect(prompt).toContain('Replace the current artifact in this open session');
    expect(prompt).toContain('```mermaid\ngraph TD\nA-->B\n```');
    expect(prompt).not.toContain('durable');
  });

  it('wires selected-artifact regenerate through the split view and queue replacement state', () => {
    const island = source('src/components/ChatIsland.svelte');
    const split = source('src/components/ArtifactSplitView.svelte');

    expect(split).toContain('onregenerate?: (entry: ArtifactEntry) => void');
    expect(split).toContain('Regenerate selected artifact');
    expect(split).toContain('onclick={() => currentEntry && onregenerate(currentEntry)}');
    expect(island).toContain('function regenerateArtifactEntry(entry: ArtifactEntry)');
    expect(island).toContain('createArtifactRegenerationPrompt(entry)');
    expect(island).toContain("artifactQueue.replace(entry.messageIdx, entry.artifact.id, entry.artifact, { status: 'updating', error: null })");
    expect(island).toContain('onregenerate={regenerateArtifactEntry}');
  });

  it('copies source from the selected gallery artifact with visible feedback', () => {
    const split = source('src/components/ArtifactSplitView.svelte');

    expect(split).toContain('function copySource(entry: ArtifactEntry)');
    expect(split).toContain('navigator.clipboard.writeText(entry.artifact.code)');
    expect(split).toContain('Copy selected artifact source');
    expect(split).toContain("copiedSourceKey === currentEntryKey ? 'Copied' : 'Copy source'");
    expect(split).toContain('copyResetTimer');
  });

  it('offers separate source, SVG, and PNG downloads for the selected artifact', () => {
    const split = source('src/components/ArtifactSplitView.svelte');

    expect(split).toContain('function downloadSource(entry: ArtifactEntry)');
    expect(split).toContain('function downloadSvg(entry: ArtifactEntry)');
    expect(split).toContain('async function downloadPng(entry: ArtifactEntry)');
    expect(split).toContain('function getSelectedSvgMarkup(entry: ArtifactEntry)');
    expect(split).toContain("querySelector('svg')");
    expect(split).toContain('new XMLSerializer().serializeToString(svg)');
    expect(split).toContain('canvas.toBlob');
    expect(split).toContain('aria-label="Download selected artifact source"');
    expect(split).toContain('aria-label="Download selected artifact SVG"');
    expect(split).toContain('aria-label="Download selected artifact PNG"');
    expect(split).toContain('bind:this={panelHost}');
  });

  it('debounces artifact DOM subscriptions and names the slow-provider switch', () => {
    const island = source('src/components/ChatIsland.svelte');
    const messages = source('src/components/ChatMessages.svelte');
    const split = source('src/components/ArtifactSplitView.svelte');

    expect(island).toContain('const STREAM_SLOW_SWITCH_MS = 30_000');
    expect(island).toContain('Provider slow, switching...');
    expect(messages).toContain('queue.subscribeDebounced');
    expect(split).toContain('queue.subscribeDebounced');
  });
});
