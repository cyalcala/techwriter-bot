<script lang="ts">
  import type { ArtifactEntry } from '../lib/artifact-queue';
  import { timeAgo } from '../lib/artifact-lifecycle';

  interface Props {
    entry: ArtifactEntry;
    active?: boolean;
    onclick: () => void;
  }

  let { entry, active = false, onclick }: Props = $props();

  const typeColors: Record<string, string> = {
    mermaid: 'bg-cyan-600 text-white', graphviz: 'bg-purple-600 text-white',
    d2: 'bg-blue-600 text-white', plantuml: 'bg-orange-600 text-white',
    vega: 'bg-pink-600 text-white', flowchart: 'bg-teal-600 text-white',
    markmap: 'bg-green-600 text-white', katex: 'bg-violet-600 text-white',
    code: 'bg-stone-600 text-white', python: 'bg-yellow-600 text-black',
    javascript: 'bg-amber-500 text-black', typescript: 'bg-blue-500 text-white',
    html: 'bg-red-500 text-white', svg: 'bg-emerald-600 text-white',
    react: 'bg-sky-500 text-white', webcontainer: 'bg-rose-600 text-white',
  };

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function startLongPress() {
    longPressTimer = setTimeout(() => {}, 500);
  }
  function cancelLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }
</script>

<button
  {onclick}
  onpointerdown={startLongPress}
  onpointerup={cancelLongPress}
  onpointerleave={cancelLongPress}
  class="w-full text-left px-4 py-3 rounded-2xl border transition-all duration-150
    {active ? 'border-amber-400 bg-amber-50/60 shadow-md scale-[1.01]' : 'border-stone-200/50 bg-white/60 hover:bg-white hover:border-stone-300 hover:shadow-sm hover:scale-[1.005]'}"
  aria-label="View artifact: {entry.artifact.title || entry.artifact.type}"
  role="article"
>
  <div class="flex items-center gap-3">
    <div class="shrink-0">
      {#if entry.artifact.type === 'svg' && entry.artifact.code}
        <div class="w-10 h-10 rounded-lg overflow-hidden bg-white border border-stone-100 shadow-sm">
          {@html entry.artifact.code}
        </div>
      {:else}
        <span class="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[9px] uppercase tracking-widest font-bold {typeColors[entry.artifact.type] || 'bg-stone-500 text-white'}">
          {entry.artifact.type.slice(0, 4)}
        </span>
      {/if}
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-[13px] font-semibold text-stone-800 truncate">{entry.artifact.title || 'Artifact'}</span>
        {#if active}
          <span class="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">Active</span>
        {/if}
      </div>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="text-[10px] text-stone-400">{timeAgo(Date.now())}</span>
        <span class="text-[10px] text-stone-300">· {entry.artifact.type}</span>
      </div>
    </div>

    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
    </svg>
  </div>
</button>
