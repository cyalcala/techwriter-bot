<script lang="ts">
  import type { ArtifactQueue, ArtifactEntry } from '../lib/artifact-queue';
  import ArtifactOverlay from './ArtifactOverlay.svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import { renderSvgArtifact } from '../lib/renderer-loader';

  interface Props {
    queue: ArtifactQueue;
    isMobile: boolean;
    activeEntry: ArtifactEntry | null;
    busy?: boolean;
    onclose: () => void;
    onselect?: (entry: ArtifactEntry) => void;
    onregenerate?: (entry: ArtifactEntry) => void;
    onFixArtifact: (code: string, error: string) => void;
    artifactError: string | null;
  }

  let { queue, isMobile, activeEntry, busy = false, onclose, onselect = () => {}, onregenerate = () => {}, onFixArtifact, artifactError }: Props = $props();

  let activeIdx = $state(0);
  let allEntries = $state<ArtifactEntry[]>([]);
  let panelRendererError = $state<string | null>(null);

  $effect(() => {
    if (activeEntry) {
      const all = queue.forMessage(activeEntry.messageIdx);
      const idx = all.findIndex(e => e.artifact.id === activeEntry.artifact.id);
      activeIdx = idx >= 0 ? idx : 0;
    }
  });

  $effect(() => {
    return queue.subscribe(entries => { allEntries = entries; });
  });

  let msgEntries = $derived(activeEntry ? allEntries.filter(e => e.messageIdx === activeEntry.messageIdx) : []);
  let currentEntry = $derived(msgEntries[activeIdx] || activeEntry);
  let overlayKey = $derived(currentEntry ? `${currentEntry.artifact.id}:${currentEntry.artifact.type}:${currentEntry.artifact.code.length}` : 'none');
  let currentError = $derived(currentEntry?.error || panelRendererError || artifactError);
  let galleryEntries = $derived(allEntries);

  $effect(() => {
    overlayKey;
    panelRendererError = null;
  });

  function goNext() { if (msgEntries.length > 1) activeIdx = (activeIdx + 1) % msgEntries.length; }
  function goPrev() { if (msgEntries.length > 1) activeIdx = (activeIdx - 1 + msgEntries.length) % msgEntries.length; }

  function isActiveGalleryEntry(entry: ArtifactEntry): boolean {
    return currentEntry?.messageIdx === entry.messageIdx && currentEntry?.artifact.id === entry.artifact.id;
  }

  function selectGalleryEntry(entry: ArtifactEntry) {
    const nextEntries = allEntries.filter(e => e.messageIdx === entry.messageIdx);
    const idx = nextEntries.findIndex(e => e.artifact.id === entry.artifact.id);
    activeIdx = idx >= 0 ? idx : 0;
    panelRendererError = null;
    onselect(entry);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!activeEntry) return;
    if (e.key === 'Escape') { onclose(); return; }
    if (e.key === 'ArrowLeft' && e.ctrlKey) { goPrev(); return; }
    if (e.key === 'ArrowRight' && e.ctrlKey) { goNext(); return; }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if activeEntry}
  <div aria-live="polite" class="sr-only">Artifact panel open. {msgEntries.length} artifact{msgEntries.length !== 1 ? 's' : ''} available. Current: {currentEntry?.artifact.title || 'Untitled'}.</div>

  {#if isMobile}
    <ArtifactOverlay
      svg={currentEntry?.artifact.type === 'svg' ? currentEntry.artifact.code : ''}
      type={currentEntry?.artifact.type || 'diagram'}
      title={currentEntry?.artifact.title || 'Artifact'}
      code={currentEntry?.artifact.type !== 'svg' ? currentEntry?.artifact.code || '' : ''}
      onclose={onclose}
    />
  {:else}
    <div class="hidden md:block w-1.5 bg-stone-300 hover:bg-amber-400 cursor-col-resize shrink-0 transition-colors z-20" role="separator" aria-label="Resize panel"></div>
    <div class="hidden md:flex flex-col w-[50%] min-w-[360px] bg-[#faf7f2] overflow-hidden shadow-2xl z-10" style="resize: horizontal;">
      <div class="flex items-center justify-between gap-3 px-4 py-3 bg-stone-800 text-white shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          {#if msgEntries.length > 1}
            <div class="flex items-center gap-1">
              <button onclick={goPrev} class="p-1 rounded text-stone-400 hover:text-white transition-colors" aria-label="Previous artifact">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M12.7 15.7 7 10l5.7-5.7 1.4 1.4L9.8 10l4.3 4.3-1.4 1.4Z"/></svg>
              </button>
              <span class="text-[10px] text-stone-400 font-medium tabular-nums">{activeIdx + 1}/{msgEntries.length}</span>
              <button onclick={goNext} class="p-1 rounded text-stone-400 hover:text-white transition-colors" aria-label="Next artifact">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="m7.3 15.7-1.4-1.4 4.3-4.3-4.3-4.3 1.4-1.4L13 10l-5.7 5.7Z"/></svg>
              </button>
            </div>
            <div class="w-px h-4 bg-stone-600"></div>
          {/if}
          <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md bg-amber-500 text-stone-900">{currentEntry?.artifact.type}</span>
          <span class="text-sm font-medium text-stone-200 truncate">{currentEntry?.artifact.title || 'Artifact'}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick={() => currentEntry && onregenerate(currentEntry)} disabled={busy} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-all" aria-label="Regenerate selected artifact">Regenerate</button>
          <button onclick={async () => { try { await navigator.clipboard.writeText(currentEntry?.artifact.code || ''); } catch {} }} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Copy artifact code">Copy</button>
          <button onclick={onclose} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Close panel (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        {#if galleryEntries.length > 1}
          <aside class="hidden lg:flex w-40 shrink-0 flex-col border-r border-stone-200 bg-stone-50" aria-label="Session artifacts">
            <div class="border-b border-stone-200 px-3 py-2">
              <div class="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Session artifacts</div>
              <div class="mt-0.5 text-[10px] text-stone-400">{galleryEntries.length} item{galleryEntries.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {#each galleryEntries as entry}
                <button
                  type="button"
                  onclick={() => selectGalleryEntry(entry)}
                  aria-current={isActiveGalleryEntry(entry) ? 'true' : undefined}
                  class="group w-full rounded-md border px-2 py-2 text-left transition-colors
                    {isActiveGalleryEntry(entry) ? 'border-amber-300 bg-amber-50 text-stone-900' : entry.error ? 'border-red-100 bg-red-50 text-stone-800 hover:border-red-200' : 'border-transparent text-stone-700 hover:border-stone-200 hover:bg-white'}"
                >
                  <div class="flex items-center gap-2">
                    <span class="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded bg-stone-800 text-[8px] font-bold uppercase tracking-wide text-white">{entry.artifact.type.slice(0, 4)}</span>
                    <span class="min-w-0 flex-1 truncate text-[11px] font-semibold">{entry.artifact.title || 'Artifact'}</span>
                  </div>
                  <div class="mt-1 flex items-center gap-1 text-[10px] {entry.error ? 'text-red-500' : 'text-stone-400'}">
                    <span>Message {entry.messageIdx + 1}</span>
                    {#if entry.error}
                      <span>- issue</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          </aside>
        {/if}

        <div class="flex min-w-0 flex-1 flex-col">
          {#if msgEntries.length > 1}
            <div class="flex gap-2 overflow-x-auto px-3 py-2 bg-stone-100 border-b border-stone-200 shrink-0">
              {#each msgEntries as item, idx}
                <button onclick={() => selectGalleryEntry(item)}
                  class="shrink-0 w-20 rounded-lg overflow-hidden border-2 transition-all duration-150
                    {idx === activeIdx ? 'border-amber-400 shadow-md scale-105' : 'border-transparent hover:border-stone-300 hover:shadow-sm'}">
                  {#if item.artifact.type === 'svg'}
                    <div class="w-full h-12 bg-white overflow-hidden">{@html renderSvgArtifact(item.artifact.code)}</div>
                  {:else}
                    <div class="w-full h-12 flex items-center justify-center bg-stone-200 text-[10px] font-bold text-stone-500 uppercase">{item.artifact.type}</div>
                  {/if}
                  <div class="text-[9px] text-stone-600 truncate px-1 py-0.5 leading-tight">{item.artifact.title || 'Untitled'}</div>
                </button>
              {/each}
            </div>
          {/if}

          <div class="flex-1 overflow-auto bg-[#faf7f2]">
            {#if currentError}
              <div class="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2">
                <div class="text-xs text-red-700 truncate min-w-0"><span class="font-bold">Error:</span> {currentError}</div>
                <button onclick={() => currentEntry && onFixArtifact(currentEntry.artifact.code, currentError)} class="text-[10px] px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold shrink-0 transition-all">Fix with AI</button>
              </div>
            {/if}
            {#if currentEntry}
              {#key currentEntry.artifact.id}
                <ArtifactPanel
                  artifact={currentEntry.artifact}
                  progressive={true}
                  onrenderererror={(message) => { panelRendererError = message; }}
                />
              {/key}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
{/if}
