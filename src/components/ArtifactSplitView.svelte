<script lang="ts">
  import type { ArtifactQueue, ArtifactEntry } from '../lib/artifact-queue';
  import ArtifactOverlay from './ArtifactOverlay.svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import ChatArtifactChip from './ChatArtifactChip.svelte';
  import { renderSvgArtifact } from '../lib/renderer-loader';

  interface Props {
    queue: ArtifactQueue;
    isMobile: boolean;
    activeEntry: ArtifactEntry | null;
    onclose: () => void;
    onselect?: (entry: ArtifactEntry) => void;
    onFixArtifact: (code: string, error: string) => void;
    artifactError: string | null;
  }

  let { queue, isMobile, activeEntry, onclose, onselect = () => {}, onFixArtifact, artifactError }: Props = $props();

  let activeIdx = $state(0);
  let allEntries = $state<ArtifactEntry[]>([]);

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
  let currentError = $derived(currentEntry?.error || artifactError);
  let overlayKey = $derived(currentEntry ? `${currentEntry.artifact.id}:${currentEntry.artifact.type}:${currentEntry.artifact.code.length}` : 'none');
  let chipBases = $derived(allEntries.filter(e => !activeEntry || e.messageIdx !== activeEntry.messageIdx));

  function goNext() { if (msgEntries.length > 1) activeIdx = (activeIdx + 1) % msgEntries.length; }
  function goPrev() { if (msgEntries.length > 1) activeIdx = (activeIdx - 1 + msgEntries.length) % msgEntries.length; }

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
    {#key overlayKey}
      <ArtifactOverlay
        svg={currentEntry?.artifact.type === 'svg' ? currentEntry.artifact.code : ''}
        type={currentEntry?.artifact.type || 'diagram'}
        title={currentEntry?.artifact.title || 'Artifact'}
        code={currentEntry?.artifact.type !== 'svg' ? currentEntry?.artifact.code || '' : ''}
        onclose={onclose}
      />
    {/key}
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
          <button onclick={async () => { try { await navigator.clipboard.writeText(currentEntry?.artifact.code || ''); } catch {} }} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Copy artifact code">Copy</button>
          <button onclick={onclose} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Close panel (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {#if msgEntries.length > 1}
        <div class="flex gap-2 overflow-x-auto px-3 py-2 bg-stone-100 border-b border-stone-200 shrink-0">
          {#each msgEntries as item, idx}
            <button onclick={() => activeIdx = idx}
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
            <ArtifactPanel artifact={currentEntry.artifact} progressive={true} />
          {/key}
        {/if}
      </div>
    </div>
  {/if}

  {#if chipBases.length > 0 && !isMobile}
    <div class="hidden md:block absolute bottom-4 right-4 max-w-xs max-h-64 overflow-y-auto space-y-1 p-2 bg-white/90 backdrop-blur rounded-lg border border-stone-200 shadow-lg z-20">
      <div class="text-[10px] font-semibold text-stone-400 px-2 py-1">Other artifacts</div>
      {#each chipBases as entry}
        <ChatArtifactChip entry={entry} onclick={() => onselect(entry)} />
      {/each}
    </div>
  {/if}
{/if}
