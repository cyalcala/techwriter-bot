<script lang="ts">
  import type { Artifact, ArtifactType } from '../lib/stream-parser';
  import { loadRenderer, renderCodeArtifact, renderHtmlArtifact, renderSvgArtifact, renderMermaidArtifact, renderReactArtifact, renderKatexArtifact, renderMarkmapArtifact, renderD2Artifact, renderVegaArtifact, renderGraphvizArtifact, renderPlantUMLArtifact, renderFlowchartArtifact, renderWebContainerArtifact } from '../lib/renderer-loader';

  interface Props { artifact: Artifact; progressive?: boolean; }
  let { artifact, progressive = false }: Props = $props();

  let renderedHtml = $state('');
  let isLoaded = $state(false);
  let activeTab = $state<'code' | 'preview'>('preview');
  let copied = $state(false);
  let collapsed = $state(false);
  let progressiveCode = $state('');

  const previewableTypes: ArtifactType[] = ['html', 'svg', 'mermaid', 'react', 'katex', 'markmap', 'd2', 'vega', 'graphviz', 'plantuml', 'flowchart', 'webcontainer'];

  const typeBadgeMap: Record<string, string> = {
    code: 'bg-slate-700 text-slate-100',
    mermaid: 'bg-indigo-600 text-white',
    d2: 'bg-emerald-600 text-white',
    graphviz: 'bg-purple-600 text-white',
    plantuml: 'bg-orange-600 text-white',
    katex: 'bg-cyan-600 text-white',
    markmap: 'bg-pink-600 text-white',
    vega: 'bg-teal-600 text-white',
    flowchart: 'bg-blue-600 text-white',
    html: 'bg-rose-600 text-white',
    svg: 'bg-amber-600 text-white',
    react: 'bg-sky-600 text-white',
    webcontainer: 'bg-violet-600 text-white',
  };

  const typeBadge = $derived(typeBadgeMap[artifact.type] || 'bg-gray-600 text-white');

  $effect(() => {
    const a = artifact;
    if (!a) return;
    isLoaded = false;
    renderedHtml = '';
    collapsed = false;
    progressiveCode = a.code;

    loadRenderer(a.type).then(() => {
      switch (a.type) {
        case 'code': renderedHtml = renderCodeArtifact(a.code, a.language); break;
        case 'html': renderedHtml = renderHtmlArtifact(a.code); break;
        case 'svg': renderedHtml = renderSvgArtifact(a.code); break;
        case 'mermaid': renderedHtml = renderMermaidArtifact(a.code); break;
        case 'react': renderedHtml = renderReactArtifact(a.code); break;
        case 'katex': renderedHtml = renderKatexArtifact(a.code); break;
        case 'markmap': renderedHtml = renderMarkmapArtifact(a.code); break;
        case 'd2': renderedHtml = renderD2Artifact(a.code); break;
        case 'vega': renderedHtml = renderVegaArtifact(a.code); break;
        case 'graphviz': renderedHtml = renderGraphvizArtifact(a.code); break;
        case 'plantuml': renderedHtml = renderPlantUMLArtifact(a.code); break;
        case 'flowchart': renderedHtml = renderFlowchartArtifact(a.code); break;
        case 'webcontainer': renderedHtml = renderWebContainerArtifact(a.code); break;
        default: renderedHtml = `<pre>${escapeHtml(a.code)}</pre>`;
      }
      isLoaded = true;
    }).catch(() => { renderedHtml = `<pre>${escapeHtml(a.code)}</pre>`; isLoaded = true; });
  });

  $effect(() => {
    if (progressive && artifact.type === 'code') {
      progressiveCode = artifact.code;
      if (window.Prism && isLoaded) {
        renderedHtml = renderCodeArtifact(artifact.code, artifact.language);
      }
    }
  });

  function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  async function copyCode() { try { await navigator.clipboard.writeText(artifact.code); copied = true; setTimeout(() => copied = false, 1500); } catch {} }

  function downloadArtifact() {
    const extMap: Record<string, string> = {
      code: artifact.language === 'python' ? '.py' : artifact.language === 'javascript' ? '.js' : artifact.language || '.txt',
      html: '.html', svg: '.svg', mermaid: '.mmd', react: '.jsx',
      katex: '.tex', markmap: '.md', d2: '.d2', vega: '.json',
      graphviz: '.dot', plantuml: '.puml', flowchart: '.fc.js', webcontainer: '.json',
    };
    const ext = extMap[artifact.type] || '.txt';
    const filename = (artifact.title || 'artifact').replace(/[^a-zA-Z0-9_-]/g, '_') + ext;
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const showPreview = $derived(previewableTypes.includes(artifact.type));
</script>

<div class="artifact-card rounded-xl overflow-hidden shadow-lg border border-[#d6d0c4] bg-white w-full transition-all">
  <div class="flex items-center justify-between px-4 py-2.5 bg-[#1e1e2e] text-white">
    <div class="flex items-center gap-2.5 min-w-0">
      <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md {typeBadge}">{artifact.type}</span>
      <span class="text-xs font-medium text-gray-300 truncate">{artifact.title || 'Untitled'}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      {#if showPreview}
        <button onclick={() => activeTab = 'code'} class="text-[10px] px-2.5 py-1 rounded-md transition-all {activeTab === 'code' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Code</button>
        <button onclick={() => activeTab = 'preview'} class="text-[10px] px-2.5 py-1 rounded-md transition-all {activeTab === 'preview' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Preview</button>
      {/if}
      <button onclick={copyCode} class="text-[10px] px-2.5 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all">{copied ? 'Copied!' : 'Copy'}</button>
      <button onclick={downloadArtifact} class="text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all" title="Download">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
      </button>
      <button onclick={() => collapsed = !collapsed} class="text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all" title={collapsed ? 'Expand' : 'Collapse'}>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 transition-transform {collapsed ? '' : 'rotate-180'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>
      </button>
    </div>
  </div>

  {#if !collapsed}
    <div class="p-0">
      {#if activeTab === 'code' || !showPreview}
        <div class="overflow-x-auto max-h-[600px] overflow-y-auto bg-[#0d1117]">
          {#if progressive && !isLoaded && artifact.type === 'code'}
            <pre class="m-0 rounded-none text-[13px] !bg-transparent" style="line-height:1.6"><code>{progressiveCode}</code></pre>
          {:else}
            <pre class="language-{artifact.language || 'plaintext'} m-0 rounded-none text-[13px] !bg-transparent" style="line-height:1.6"><code>{artifact.code}</code></pre>
          {/if}
        </div>
      {:else}
        {#if !isLoaded}
          <div class="p-6 text-center text-sm text-[#8c8576]">Loading renderer...</div>
        {:else}
          {#if artifact.type === 'html' || artifact.type === 'react'}
            <div class="w-full">{@html renderedHtml}</div>
          {:else if artifact.type === 'svg' || artifact.type === 'plantuml'}
            <div class="flex justify-center p-4 bg-[#fafafa]">{@html renderedHtml}</div>
          {:else}
            <div class="p-4 bg-[#fafafa]">{@html renderedHtml}</div>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</div>
