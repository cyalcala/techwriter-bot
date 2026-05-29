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
  let copiedSourceKey = $state('');
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let downloadNotice = $state('');
  let downloadNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let panelHost: HTMLDivElement | null = null;

  const SOURCE_EXTENSIONS: Record<string, string> = {
    code: '.txt',
    html: '.html',
    svg: '.svg',
    mermaid: '.mmd',
    react: '.jsx',
    katex: '.tex',
    markmap: '.md',
    d2: '.d2',
    vega: '.json',
    graphviz: '.dot',
    plantuml: '.puml',
    flowchart: '.fc.js',
  };
  const SOURCE_MIME_TYPES: Record<string, string> = {
    html: 'text/html;charset=utf-8',
    svg: 'image/svg+xml;charset=utf-8',
    vega: 'application/json;charset=utf-8',
  };
  const SVG_DOWNLOAD_TYPES = new Set(['svg', 'mermaid', 'markmap', 'd2', 'vega', 'graphviz', 'plantuml', 'flowchart']);

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
  let currentEntryKey = $derived(currentEntry ? artifactEntryKey(currentEntry) : '');
  let canDownloadRenderedSvg = $derived(currentEntry ? SVG_DOWNLOAD_TYPES.has(currentEntry.artifact.type) : false);

  $effect(() => {
    overlayKey;
    panelRendererError = null;
  });

  $effect(() => {
    return () => {
      if (copyResetTimer) clearTimeout(copyResetTimer);
      if (downloadNoticeTimer) clearTimeout(downloadNoticeTimer);
    };
  });

  function goNext() { if (msgEntries.length > 1) activeIdx = (activeIdx + 1) % msgEntries.length; }
  function goPrev() { if (msgEntries.length > 1) activeIdx = (activeIdx - 1 + msgEntries.length) % msgEntries.length; }

  function artifactEntryKey(entry: ArtifactEntry): string {
    return `${entry.messageIdx}:${entry.artifact.id}`;
  }

  async function copySource(entry: ArtifactEntry) {
    try {
      await navigator.clipboard.writeText(entry.artifact.code);
      copiedSourceKey = artifactEntryKey(entry);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        copiedSourceKey = '';
        copyResetTimer = null;
      }, 1500);
    } catch {
      copiedSourceKey = '';
    }
  }

  function downloadSource(entry: ArtifactEntry) {
    const languageExt = entry.artifact.type === 'code' && entry.artifact.language
      ? `.${entry.artifact.language.replace(/^\./, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'txt'}`
      : '';
    const extension = languageExt || SOURCE_EXTENSIONS[entry.artifact.type] || '.txt';
    const mime = SOURCE_MIME_TYPES[entry.artifact.type] || 'text/plain;charset=utf-8';
    downloadBlob(entry.artifact.code, mime, `${downloadBaseName(entry)}${extension}`);
  }

  function downloadSvg(entry: ArtifactEntry) {
    const svg = getSelectedSvgMarkup(entry);
    if (!svg) {
      showDownloadNotice('Render the preview before downloading SVG.');
      return;
    }
    downloadBlob(svg, 'image/svg+xml;charset=utf-8', `${downloadBaseName(entry)}.svg`);
  }

  async function downloadPng(entry: ArtifactEntry) {
    const svg = getSelectedSvgMarkup(entry);
    if (!svg) {
      showDownloadNotice('Render the preview before downloading PNG.');
      return;
    }

    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG image failed to load'));
        img.src = url;
      });

      const { width, height } = getSvgDimensions(svg);
      const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('PNG export failed');
      downloadBlob(png, 'image/png', `${downloadBaseName(entry)}.png`);
    } catch {
      showDownloadNotice('PNG download is unavailable for this artifact.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function getSelectedSvgMarkup(entry: ArtifactEntry): string {
    if (entry.artifact.type === 'svg') return normalizeSvgMarkup(entry.artifact.code);
    const svg = panelHost?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return '';
    return normalizeSvgMarkup(new XMLSerializer().serializeToString(svg));
  }

  function normalizeSvgMarkup(value: string): string {
    const raw = value.trim();
    const start = raw.search(/<svg[\s>]/i);
    if (start < 0) return '';
    const svg = raw.slice(start);
    const firstTag = svg.slice(0, Math.max(svg.indexOf('>') + 1, 0));
    if (/\sxmlns=/.test(firstTag)) return svg;
    return svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  function getSvgDimensions(svg: string): { width: number; height: number } {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const viewBox = (parsed.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    const width = readSvgSize(parsed.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : 0) || 1200;
    const height = readSvgSize(parsed.getAttribute('height')) || (viewBox.length === 4 ? viewBox[3] : 0) || 800;
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  function readSvgSize(value: string | null): number {
    if (!value || value.includes('%')) return 0;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function downloadBaseName(entry: ArtifactEntry): string {
    return (entry.artifact.title || entry.artifact.id || 'artifact').replace(/[^a-zA-Z0-9_-]/g, '_') || 'artifact';
  }

  function downloadBlob(content: string | Blob, type: string, filename: string) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function showDownloadNotice(message: string) {
    downloadNotice = message;
    if (downloadNoticeTimer) clearTimeout(downloadNoticeTimer);
    downloadNoticeTimer = setTimeout(() => {
      downloadNotice = '';
      downloadNoticeTimer = null;
    }, 2200);
  }

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
        <div class="flex max-w-[72%] items-center gap-1 overflow-x-auto shrink-0">
          <button onclick={() => currentEntry && onregenerate(currentEntry)} disabled={busy} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-all" aria-label="Regenerate selected artifact">Regenerate</button>
          <button onclick={() => currentEntry && copySource(currentEntry)} class="min-w-[4.75rem] whitespace-nowrap text-center text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Copy selected artifact source">{copiedSourceKey === currentEntryKey ? 'Copied' : 'Copy source'}</button>
          <button onclick={() => currentEntry && downloadSource(currentEntry)} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Download selected artifact source">Source</button>
          {#if canDownloadRenderedSvg}
            <button onclick={() => currentEntry && downloadSvg(currentEntry)} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Download selected artifact SVG">SVG</button>
            <button onclick={() => currentEntry && downloadPng(currentEntry)} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Download selected artifact PNG">PNG</button>
          {/if}
          <button onclick={onclose} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" aria-label="Close panel (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      {#if downloadNotice}
        <div class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800" aria-live="polite">{downloadNotice}</div>
      {/if}

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

          <div class="flex-1 overflow-auto bg-[#faf7f2]" bind:this={panelHost}>
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
