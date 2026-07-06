<script lang="ts">
  import { onMount } from 'svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import type { Artifact, ArtifactType } from '../lib/stream-parser';
  import { exportFormatsFor, exportArtifactAs, downloadBlob } from '../lib/artifact-export';

  interface Props {
    svg: string;
    type: string;
    title: string;
    code?: string;
    onclose: () => void;
  }

  let { svg = '', code = '', type = '', title = '', onclose = () => {} }: Props = $props();

  const SWIPE_DISMISS_THRESHOLD = 96;
  const SWIPE_DISMISS_RESISTANCE = 0.7;
  const SWIPE_DISMISS_MAX_OFFSET = 180;
  const PINCH_ZOOM_MIN_SCALE = 1;
  const PINCH_ZOOM_MAX_SCALE = 3;
  const zoomPointers = new Map<number, { x: number; y: number }>();

  let visible = $state(false);
  let copied = $state(false);
  let swipeStartY = $state<number | null>(null);
  let swipeOffsetY = $state(0);
  let swipeTracking = $state(false);
  let zoomScale = $state(1);
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let hasContent = $derived(!!svg || !!code);
  let overlayArtifact = $derived<Artifact | null>(hasContent ? {
    id: `overlay-${type}-${(svg || code).length}`,
    type: (type || (svg ? 'svg' : 'code')) as ArtifactType,
    title: title || 'Artifact',
    placement: 'modal',
    code: svg || code,
  } : null);
  let zoomPercent = $derived(Math.round(zoomScale * 100));

  $effect(() => {
    if (hasContent) {
      requestAnimationFrame(() => { visible = true; });
      const prev = window.history.state?.overlayOpen;
      if (!prev) window.history.pushState({ overlayOpen: true }, '');
    } else {
      resetSwipeDismiss();
      resetPinchZoom();
      visible = false;
    }
  });

  $effect(() => {
    overlayArtifact?.id;
    resetPinchZoom();
  });

  function handlePopstate() {
    if (visible) { visible = false; onclose(); }
  }

  onMount(() => {
    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  });

  function closeOverlay() {
    resetSwipeDismiss();
    resetPinchZoom();
    visible = false;
    if (window.history.state?.overlayOpen) window.history.back();
    setTimeout(() => onclose(), 300);
  }

  function startSwipeDismiss(e: PointerEvent) {
    swipeStartY = e.clientY;
    swipeOffsetY = 0;
    swipeTracking = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }

  function trackSwipeDismiss(e: PointerEvent) {
    if (!swipeTracking || swipeStartY === null) return;
    const deltaY = Math.max(0, e.clientY - swipeStartY);
    if (deltaY > 8) e.preventDefault();
    swipeOffsetY = Math.min(SWIPE_DISMISS_MAX_OFFSET, Math.round(deltaY * SWIPE_DISMISS_RESISTANCE));
  }

  function finishSwipeDismiss(e: PointerEvent) {
    if (!swipeTracking) return;
    const deltaY = swipeStartY === null ? 0 : e.clientY - swipeStartY;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    resetSwipeDismiss();
    if (deltaY >= SWIPE_DISMISS_THRESHOLD) closeOverlay();
  }

  function cancelSwipeDismiss(e: PointerEvent) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    resetSwipeDismiss();
  }

  function resetSwipeDismiss() {
    swipeStartY = null;
    swipeOffsetY = 0;
    swipeTracking = false;
  }

  function startPinchZoom(e: PointerEvent) {
    zoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}

    if (zoomPointers.size === 2) {
      const [first, second] = Array.from(zoomPointers.values());
      pinchStartDistance = distanceBetween(first, second);
      pinchStartScale = zoomScale;
      e.preventDefault();
    }
  }

  function trackPinchZoom(e: PointerEvent) {
    if (!zoomPointers.has(e.pointerId)) return;
    zoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zoomPointers.size < 2 || pinchStartDistance <= 0) return;

    const [first, second] = Array.from(zoomPointers.values());
    const nextDistance = distanceBetween(first, second);
    zoomScale = clampZoomScale(pinchStartScale * (nextDistance / pinchStartDistance));
    e.preventDefault();
  }

  function finishPinchZoom(e: PointerEvent) {
    zoomPointers.delete(e.pointerId);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (zoomPointers.size < 2) {
      pinchStartDistance = 0;
      pinchStartScale = zoomScale;
    }
  }

  function resetPinchZoom() {
    zoomPointers.clear();
    pinchStartDistance = 0;
    pinchStartScale = 1;
    zoomScale = 1;
  }

  function distanceBetween(first: { x: number; y: number }, second: { x: number; y: number }) {
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function clampZoomScale(value: number) {
    if (!Number.isFinite(value)) return PINCH_ZOOM_MIN_SCALE;
    return Math.min(PINCH_ZOOM_MAX_SCALE, Math.max(PINCH_ZOOM_MIN_SCALE, value));
  }

  const typeBadge: Record<string, string> = {
    mermaid: 'bg-indigo-600 text-white', graphviz: 'bg-purple-600 text-white',
    d2: 'bg-emerald-600 text-white', plantuml: 'bg-orange-600 text-white',
    vega: 'bg-teal-600 text-white', flowchart: 'bg-blue-600 text-white',
    svg: 'bg-amber-600 text-white', code: 'bg-slate-700 text-slate-100',
  };

  let exporting = $state(false);
  let menuOpen = $state(false);
  const exportFormats = $derived(exportFormatsFor(type));

  function rawDownload() {
    const content = svg || code;
    const ext = svg ? '.svg' : '.txt';
    const mime = svg ? 'image/svg+xml' : 'text/plain';
    downloadBlob(content, (title || 'artifact').replace(/[^a-zA-Z0-9_-]/g, '_') + ext, mime);
  }

  async function runExport(formatId: string) {
    if (exporting) return;
    menuOpen = false;
    exporting = true;
    try {
      const handled = await exportArtifactAs(type, svg || code, (title || 'artifact').replace(/[^a-zA-Z0-9_-]/g, '_'), formatId);
      if (!handled) rawDownload();
    } catch {
      rawDownload();
    } finally {
      exporting = false;
    }
  }

  function handleDownloadClick() {
    if (exporting) return;
    if (exportFormats.length > 1) { menuOpen = !menuOpen; return; }
    rawDownload();
  }

  async function copyContent() {
    try { await navigator.clipboard.writeText(svg || code); copied = true; setTimeout(() => copied = false, 1500); } catch {}
  }
</script>

{#if hasContent}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex flex-col transition-all duration-300 {visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
    style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);"
    role="dialog"
    aria-modal="true"
    aria-label="Artifact viewer"
    tabindex="-1"
    onclick={closeOverlay}
    onkeydown={(e) => e.key === 'Escape' && closeOverlay()}
  >
    <div class="absolute inset-0 bg-stone-900/90 backdrop-blur-sm"></div>
    <div
      class="relative flex flex-col flex-1 m-2 rounded-lg bg-stone-800 overflow-hidden transition-transform {swipeTracking ? 'duration-75' : 'duration-300'}"
      style:transform={`translateY(${visible ? swipeOffsetY : 32}px)`}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative flex items-center justify-between px-4 py-3 bg-stone-800/90 shrink-0 border-b border-stone-700"
        style="touch-action: none;"
        onpointerdown={startSwipeDismiss}
        onpointermove={trackSwipeDismiss}
        onpointerup={finishSwipeDismiss}
        onpointercancel={cancelSwipeDismiss}
      >
        <div aria-hidden="true" class="absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-stone-500/70"></div>
        <button onclick={closeOverlay} class="flex items-center gap-1.5 text-stone-300 hover:text-white transition-colors" aria-label="Back to chat">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          <span class="text-sm font-medium">Chat</span>
        </button>
        <div class="flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md {typeBadge[type] || 'bg-stone-600 text-white'}">{type}</span>
          <span class="text-xs text-stone-300 truncate max-w-[120px]">{title || 'Artifact'}</span>
        </div>
        {#if svg || code}
          <button onclick={copyContent} class="text-stone-400 hover:text-white transition-colors p-1" title="Copy">
            {#if copied}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            {/if}
          </button>
        {/if}
        <div class="relative">
          {#if menuOpen}
            <button class="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onclick={() => menuOpen = false}></button>
          {/if}
          <button onclick={handleDownloadClick} disabled={exporting} aria-haspopup={exportFormats.length > 1} aria-expanded={menuOpen} class="text-stone-400 hover:text-white transition-colors p-1 disabled:opacity-40" title="Download">
            {#if exporting}
              <span class="inline-block h-5 w-5 border-2 border-stone-500 border-t-white rounded-full animate-spin"></span>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            {/if}
          </button>
          {#if menuOpen && exportFormats.length > 1}
            <div class="absolute right-0 mt-1 z-20 min-w-[168px] rounded-lg border border-stone-600 bg-stone-800 py-1 shadow-xl" role="menu">
              {#each exportFormats as fmt (fmt.id)}
                <button role="menuitem" onclick={() => runExport(fmt.id)} class="block w-full px-3 py-2 text-left text-xs text-stone-200 hover:bg-white/10 transition-colors">{fmt.label}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex-1 bg-[#faf7f2] overflow-auto relative p-2"
        role="region"
        aria-label="Pinch zoom artifact preview"
        style="touch-action: pan-x pan-y;"
        onpointerdown={startPinchZoom}
        onpointermove={trackPinchZoom}
        onpointerup={finishPinchZoom}
        onpointercancel={finishPinchZoom}
      >
        <div class="mx-auto min-w-full transition-[width] duration-150" style:width={`${zoomPercent}%`}>
          {#if overlayArtifact}
            {#key overlayArtifact.id}
              <ArtifactPanel artifact={overlayArtifact} progressive={false} />
            {/key}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
