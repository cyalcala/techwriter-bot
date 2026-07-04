<script lang="ts">
  import type { Artifact, ArtifactType } from '../lib/stream-parser';
  import { loadRenderer, renderCodeArtifact, renderHtmlArtifact, renderSvgArtifact, renderMermaidArtifact, renderReactArtifact, renderKatexArtifact, renderMarkmapArtifact, renderD2Artifact, renderVegaArtifact, renderGraphvizArtifact, renderPlantUMLArtifact, renderFlowchartArtifact, renderGenericKrokiArtifact } from '../lib/renderer-loader';
  import { PREVIEWABLE_ARTIFACT_TYPES } from '../lib/artifact-types';
  import { formatArtifactRendererError } from '../lib/artifact-error-boundary';
  import { KROKI_RENDERABLE } from '../lib/kroki-renderer';

  interface Props { artifact: Artifact; progressive?: boolean; onrenderererror?: (message: string) => void; }
  let { artifact, progressive = false, onrenderererror = () => {} }: Props = $props();

  let renderedHtml = $state('');
  let isLoaded = $state(false);
  let activeTab = $state<'code' | 'preview'>('preview');
  let copied = $state(false);
  let collapsed = $state(false);
  let progressiveCode = $state('');
  let fading = $state(false);
  let prevId = $state('');
  let loadError = $state('');
  let renderNonce = $state(0);

  $effect(() => {
    if (artifact.id !== prevId && prevId) {
      fading = true;
      setTimeout(() => { fading = false; prevId = artifact.id; }, 150);
    } else {
      prevId = artifact.id;
    }
  });

  const previewableTypes: readonly ArtifactType[] = PREVIEWABLE_ARTIFACT_TYPES;

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
  };

  const typeBadge = $derived(typeBadgeMap[artifact.type] || 'bg-gray-600 text-white');

  $effect(() => {
    const a = artifact;
    if (!a) return;
    renderNonce;
    let cancelled = false;
    isLoaded = false;
    renderedHtml = '';
    loadError = '';
    collapsed = false;
    progressiveCode = a.code;

    const fail = (message: string) => {
      if (cancelled) return;
      loadError = message;
      renderedHtml = formatArtifactRendererError(a.type, message, a.code);
      onrenderererror(`${a.type}: ${message}`);
      isLoaded = true;
    };

    const renderTimeout = setTimeout(() => {
      if (!isLoaded) fail('Renderer took too long to load. Retry the renderer or view the source.');
    }, 15_000);

    loadRenderer(a.type).then(() => {
      if (cancelled) return;
      clearTimeout(renderTimeout);
      try {
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
          default: 
            if (KROKI_RENDERABLE.has(a.type)) {
              renderedHtml = renderGenericKrokiArtifact(a.type, a.code);
            } else {
              renderedHtml = `<pre>${escapeHtml(a.code)}</pre>`;
            }
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      isLoaded = true;
    }).catch((error) => {
      clearTimeout(renderTimeout);
      fail(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
      clearTimeout(renderTimeout);
    };
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

  function showPreviewTab() {
    if (activeTab !== 'preview') {
      activeTab = 'preview';
      renderNonce += 1;
      return;
    }
    activeTab = 'preview';
  }

  function retryRenderer() {
    loadError = '';
    activeTab = 'preview';
    renderNonce += 1;
  }

  function downloadArtifact() {
    const extMap: Record<string, string> = {
      code: artifact.language === 'python' ? '.py' : artifact.language === 'javascript' ? '.js' : artifact.language ? `.${artifact.language.replace(/^\./, '')}` : '.txt',
      html: '.html', svg: '.svg', mermaid: '.mmd', react: '.jsx',
      katex: '.tex', markmap: '.md', d2: '.d2', vega: '.json',
      graphviz: '.dot', plantuml: '.puml', flowchart: '.fc.js',
    };
    const ext = extMap[artifact.type] || '.txt';
    const filename = (artifact.title || 'artifact').replace(/[^a-zA-Z0-9_-]/g, '_') + ext;
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const showPreview = $derived(previewableTypes.includes(artifact.type) || KROKI_RENDERABLE.has(artifact.type));

</script>

<div class="artifact-card rounded-lg overflow-hidden shadow-md border border-stone-200 bg-white w-full transition-all">
  <div class="artifact-toolbar flex items-center justify-between gap-2 px-3 md:px-4 py-2.5 bg-[#1e1e2e] text-white">
    <div class="flex items-center gap-2.5 min-w-0">
      <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md {typeBadge}">{artifact.type}</span>
      <span class="text-xs font-medium text-gray-300 truncate">{artifact.title || 'Untitled'}</span>
    </div>
    <div class="artifact-actions flex items-center gap-1.5 shrink-0">
      {#if showPreview}
        <button onclick={() => activeTab = 'code'} class="text-[10px] px-2.5 py-1 rounded-md transition-all {activeTab === 'code' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Code</button>
        <button onclick={showPreviewTab} class="text-[10px] px-2.5 py-1 rounded-md transition-all {activeTab === 'preview' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Preview</button>
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
    <div class="p-0 transition-opacity duration-150 {fading ? 'opacity-0' : 'opacity-100'}">
      {#if activeTab === 'code' || !showPreview}
        <div class="artifact-code-scroll overflow-x-auto max-h-[600px] overflow-y-auto bg-[#0d1117]">
          {#if progressive && !isLoaded && artifact.type === 'code'}
            <pre class="m-0 rounded-none text-[13px] !bg-transparent" style="line-height:1.6"><code>{progressiveCode}</code></pre>
          {:else}
            <pre class="language-{artifact.language || 'plaintext'} m-0 rounded-none text-[13px] !bg-transparent" style="line-height:1.6"><code>{artifact.code}</code></pre>
          {/if}
        </div>
      {:else}
        {#if !isLoaded}
          <div class="p-6 text-center text-sm text-[#8c8576]" aria-live="polite">Loading renderer...</div>
        {:else}
          {#if loadError}
            <div class="artifact-recovery" aria-live="polite">
              <span>Renderer failed for this {artifact.type} artifact.</span>
              <button type="button" onclick={retryRenderer}>Retry renderer</button>
              <button type="button" onclick={() => activeTab = 'code'}>View code</button>
            </div>
          {/if}
          {#if artifact.type === 'html' || artifact.type === 'react'}
            <div class="artifact-preview-shell artifact-preview-frame w-full">{@html renderedHtml}</div>
          {:else if artifact.type === 'svg' || artifact.type === 'plantuml'}
            <div class="artifact-preview-shell flex justify-center p-3 md:p-4 bg-[#fafafa]">{@html renderedHtml}</div>
          {:else}
            <div class="artifact-preview-shell p-3 md:p-4 bg-[#fafafa]">{@html renderedHtml}</div>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .artifact-toolbar {
    min-width: 0;
  }

  .artifact-actions {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .artifact-actions::-webkit-scrollbar {
    display: none;
  }

  .artifact-preview-shell {
    min-height: 160px;
    max-width: 100%;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }

  .artifact-preview-frame {
    padding: 0;
  }

  .artifact-code-scroll pre {
    min-width: 0;
  }

  :global(.artifact-frame) {
    display: block;
    width: 100%;
    min-height: clamp(280px, 55vh, 680px);
    border: 1px solid #e5e1d8;
    border-radius: 8px;
    background: #fff;
  }

  :global(.artifact-frame-html) {
    min-height: clamp(240px, 48vh, 620px);
  }

  :global(.artifact-svg-host),
  :global(.artifact-server-svg) {
    width: 100%;
    max-width: 100%;
    overflow: auto;
  }

  :global(.artifact-svg-host svg),
  :global(.artifact-preview-shell > svg) {
    max-width: 100%;
    height: auto;
  }

  :global(.artifact-server-svg svg),
  :global(.artifact-flowchart-host svg) {
    flex: 0 0 auto;
    max-width: none;
    height: auto;
  }

  :global(.artifact-server-svg) {
    justify-content: flex-start;
  }

  :global(.artifact-error) {
    display: grid;
    gap: 8px;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    line-height: 1.4;
  }

  :global(.artifact-error-hint) {
    color: #7f1d1d;
  }

  :global(.artifact-error pre) {
    max-height: 280px;
    overflow: auto;
    color: #44403c;
    background: #fff7ed;
    border-radius: 6px;
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .artifact-recovery {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    color: #7f1d1d;
    background: #fff7ed;
    border-bottom: 1px solid #fed7aa;
    padding: 8px 12px;
    font-size: 12px;
  }

  .artifact-recovery button {
    border: 1px solid #fdba74;
    border-radius: 6px;
    background: #fff;
    color: #9a3412;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 8px;
  }

  @media (max-width: 520px) {
    .artifact-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .artifact-actions {
      width: 100%;
    }
  }
</style>
