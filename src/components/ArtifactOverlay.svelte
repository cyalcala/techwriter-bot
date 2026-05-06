<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    svg: string;
    type: string;
    title: string;
    onclose: () => void;
  }

  let { svg = '', type = '', title = '', onclose = () => {} }: Props = $props();

  let visible = $state(false);
  let isMobile = $state(false);

  $effect(() => {
    const check = () => { isMobile = window.innerWidth < 768; };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  });

  $effect(() => {
    if (isMobile && svg) {
      requestAnimationFrame(() => { visible = true; });
      const prev = window.history.state?.overlayOpen;
      if (!prev) window.history.pushState({ overlayOpen: true }, '');
    } else {
      visible = false;
    }
  });

  function handlePopstate() {
    if (visible) { visible = false; onclose(); }
  }

  onMount(() => {
    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  });

  function getZoomableDoc(svgContent: string): string {
    const escaped = svgContent.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"><style>*{margin:0;padding:0}body{background:#faf7f2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;box-sizing:border-box}svg{max-width:100%;height:auto}</style></head><body>${escaped}</body></html>`;
  }

  function closeOverlay() {
    visible = false;
    if (window.history.state?.overlayOpen) window.history.back();
    setTimeout(() => onclose(), 300);
  }

  const typeBadge: Record<string, string> = {
    mermaid: 'bg-indigo-600 text-white',
    graphviz: 'bg-purple-600 text-white',
    d2: 'bg-emerald-600 text-white',
    plantuml: 'bg-orange-600 text-white',
    vega: 'bg-teal-600 text-white',
    flowchart: 'bg-blue-600 text-white',
    svg: 'bg-amber-600 text-white',
    code: 'bg-slate-700 text-slate-100',
  };

  function downloadSVG() {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'diagram').replace(/[^a-zA-Z0-9_-]/g, '_') + '.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
</script>

{#if isMobile && svg}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex flex-col transition-all duration-300 {visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
    role="dialog"
    aria-label="Artifact viewer"
    onclick={closeOverlay}
    onkeydown={(e) => e.key === 'Escape' && closeOverlay()}
  >
    <div class="absolute inset-0 bg-stone-900/90 backdrop-blur-sm"></div>
    <div
      class="relative flex flex-col flex-1 m-2 rounded-2xl bg-stone-800 overflow-hidden transition-transform duration-300 {visible ? 'translate-y-0' : 'translate-y-8'}"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between px-4 py-3 bg-stone-800/90 shrink-0 border-b border-stone-700">
        <button onclick={closeOverlay} class="flex items-center gap-1.5 text-stone-300 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7 7"/></svg>
          <span class="text-sm font-medium">Chat</span>
        </button>
        <div class="flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md {typeBadge[type] || 'bg-stone-600 text-white'}">{type}</span>
          <span class="text-xs text-stone-300 truncate max-w-[120px]">{title || 'Diagram'}</span>
        </div>
        <button onclick={downloadSVG} class="text-stone-400 hover:text-white transition-colors p-1" title="Download SVG">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        </button>
      </div>
      <div class="flex-1 bg-[#faf7f2]">
        <iframe title={title} srcdoc={getZoomableDoc(svg)} sandbox="allow-scripts" class="w-full h-full border-none" />
      </div>
    </div>
  </div>
{/if}
