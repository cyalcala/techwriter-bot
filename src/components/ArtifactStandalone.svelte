<script lang="ts">
  import { onMount } from 'svelte';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import type { Artifact } from '../lib/stream-parser';
  import { normalizeArtifactType } from '../lib/artifact-types';
  import { normalizeArtifactSource } from '../lib/diagram-source-normalizer';

  let artifact = $state<Artifact | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type') || 'code';
    const code = params.get('code');
    const title = params.get('title') || 'Artifact';
    if (code) {
      const artifactType = normalizeArtifactType(type, code) || 'code';
      artifact = { id: `standalone-${Date.now().toString(36)}`, type: artifactType, title, code: normalizeArtifactSource(artifactType, code), placement: 'inline' };
    } else {
      error = 'No artifact data provided. Open from a chat conversation.';
    }
  });

  async function copyCode() {
    if (!artifact) return;
    try { await navigator.clipboard.writeText(artifact.code); copied = true; setTimeout(() => { copied = false; }, 1500); } catch {}
  }

  function downloadArtifact() {
    if (!artifact) return;
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${artifact.title || 'artifact'}.txt`; a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="min-h-dvh bg-[#faf7f2] flex flex-col">
  <header class="flex items-center justify-between px-6 py-3 bg-stone-800 text-white">
    <div class="flex items-center gap-3">
      {#if artifact}
        <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md bg-amber-500 text-stone-900">{artifact.type}</span>
        <span class="text-sm font-medium truncate">{artifact.title}</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button onclick={copyCode} class="text-[11px] px-3 py-1.5 rounded-md text-stone-300 hover:text-white hover:bg-white/10 transition-all">{copied ? 'Copied' : 'Copy'}</button>
      <button onclick={downloadArtifact} class="text-[11px] px-3 py-1.5 rounded-md text-stone-300 hover:text-white hover:bg-white/10 transition-all">Download</button>
    </div>
  </header>

  <div class="flex-1 overflow-auto p-6">
    {#if artifact}
      <ArtifactPanel {artifact} />
    {:else if error}
      <div class="max-w-lg mx-auto mt-20 text-center">
        <div class="text-stone-400 text-lg">{error}</div>
        <a href="/" class="inline-block mt-4 text-sm text-amber-600 hover:text-amber-700 underline">Back to chat</a>
      </div>
    {:else}
      <div class="max-w-lg mx-auto mt-20 text-center text-stone-400">Loading artifact...</div>
    {/if}
  </div>
</div>
