<script lang="ts">
  import type { Artifact, ArtifactType } from '../lib/stream-parser';
  import { loadRenderer, renderCodeArtifact, renderHtmlArtifact, renderSvgArtifact, renderMermaidArtifact, renderReactArtifact } from '../lib/renderer-loader';

  interface Props {
    artifact: Artifact;
    onClose?: () => void;
  }

  let { artifact, onClose }: Props = $props();

  let renderedHtml = $state('');
  let isLoaded = $state(false);
  let activeTab = $state<'code' | 'preview'>('preview');
  let copied = $state(false);

  const previewableTypes: ArtifactType[] = ['html', 'svg', 'mermaid', 'react'];

  $effect(() => {
    const a = artifact;
    if (!a) return;

    isLoaded = false;
    renderedHtml = '';

    loadRenderer(a.type).then(() => {
      switch (a.type) {
        case 'code':
          renderedHtml = renderCodeArtifact(a.code, a.language);
          break;
        case 'html':
          renderedHtml = renderHtmlArtifact(a.code);
          break;
        case 'svg':
          renderedHtml = renderSvgArtifact(a.code);
          break;
        case 'mermaid':
          renderedHtml = renderMermaidArtifact(a.code);
          break;
        case 'react':
          renderedHtml = renderReactArtifact(a.code);
          break;
        default:
          renderedHtml = `<pre>${escapeHtml(a.code)}</pre>`;
      }
      isLoaded = true;
    }).catch(() => {
      renderedHtml = `<pre>${escapeHtml(a.code)}</pre>`;
      isLoaded = true;
    });
  });

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(artifact.code);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {}
  }

  const showPreview = $derived(previewableTypes.includes(artifact.type));
</script>

<div class="artifact-panel border border-[#d6d0c4] rounded-2xl overflow-hidden shadow-sm bg-white mt-3 transition-all">
  <div class="flex items-center justify-between px-4 py-2 bg-[#f1ede4]/80 border-b border-[#e5e1d8]">
    <div class="flex items-center gap-2">
      <span class="text-[10px] uppercase tracking-widest font-bold text-[#8c8576] opacity-60">{artifact.type}</span>
      <span class="text-xs font-medium text-[#1a1a1a] truncate max-w-[200px]">{artifact.title}</span>
    </div>
    <div class="flex items-center gap-1">
      {#if showPreview}
        <button on:click={() => activeTab = 'code'} class="text-[10px] px-2 py-0.5 rounded-md transition-all {activeTab === 'code' ? 'bg-white text-[#1a1a1a] shadow-sm font-bold' : 'text-[#8c8576]'}">Code</button>
        <button on:click={() => activeTab = 'preview'} class="text-[10px] px-2 py-0.5 rounded-md transition-all {activeTab === 'preview' ? 'bg-white text-[#1a1a1a] shadow-sm font-bold' : 'text-[#8c8576]'}">Preview</button>
      {/if}
      <button on:click={copyCode} class="text-[10px] px-2 py-0.5 rounded-md bg-[#f1ede4] hover:bg-[#e8e4db] text-[#6d675b] border border-[#d6d0c4] transition-all ml-1">
        {copied ? 'Copied!' : 'Copy code'}
      </button>
      {#if onClose}
        <button on:click={onClose} class="text-[10px] px-1.5 py-0.5 rounded-md text-[#8c8576] hover:text-[#1a1a1a] ml-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="p-0">
    {#if activeTab === 'code' || !showPreview}
      <div class="overflow-x-auto max-h-[500px] overflow-y-auto">
        <pre class="language-{artifact.language || 'plaintext'} m-0 rounded-none text-[13px]" style="line-height:1.5"><code>{artifact.code}</code></pre>
      </div>
    {:else}
      {#if !isLoaded}
        <div class="p-4 text-center text-sm text-[#8c8576] animate-pulse">Loading renderer...</div>
      {:else}
        {#if artifact.type === 'html' || artifact.type === 'react'}
          <div class="w-full">{@html renderedHtml}</div>
        {:else if artifact.type === 'svg'}
          <div class="flex justify-center p-4">{@html renderedHtml}</div>
        {:else}
          <div class="p-4">{@html renderedHtml}</div>
        {/if}
      {/if}
    {/if}
  </div>
</div>