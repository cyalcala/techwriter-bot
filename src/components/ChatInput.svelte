<script lang="ts">
  interface FailoverEvent {
    timestamp: string;
    provider: string;
    reason: string;
    status?: number;
    chatPath?: string;
  }

  interface ResponseTransparency {
    provider: string;
    latencyMs: number | null;
    activeProviderCount: number | null;
    tokensIn: number | null;
    graphTokens: number | null;
    requestId: string;
    chatPath: string | null;
  }

  interface RagDocumentSummary {
    id: string;
    filename: string;
    chunkCount: number;
  }

  interface Props {
    disabled: boolean;
    isStreaming: boolean;
    inputMessage: string;
    onInputChange: (val: string) => void;
    onSend: () => void;
    onStop: () => void;
    mode: 'fast' | 'brain' | 'live';
    onModeChange: (mode: 'fast' | 'brain' | 'live') => void;
    enhancedCredits: { remaining: number; unlimited: boolean; budgetExhausted: boolean };
    onFileClick: () => void;
    isUploading: boolean;
    ragUploadedFileName?: string;
    ragUploadStatus?: string;
    ragDegraded?: boolean;
    ragUploadProgress?: { done: number; total: number } | null;
    ragDocuments?: RagDocumentSummary[];
    ragMetadataOnly?: boolean;
    ragRetrievalUnavailable?: boolean;
    onRemoveFile: () => void;
    onDeleteDocument: (documentId: string) => void;
    onReembedDocument: (documentId: string) => void;
    toolsOpen: boolean;
    onToggleTools: () => void;
    tokenDisplay: { in: number; graph?: number; cached?: boolean } | null;
    responseTransparency: ResponseTransparency | null;
    chatPath: string | null;
    failoverEvents?: FailoverEvent[];
    liveSearchUnavailable?: boolean;
    panelOpen: boolean;
    isMobile: boolean;
    primaryColor?: string;
    footerText?: string;
  }

  let {
    disabled, isStreaming, inputMessage, onInputChange, onSend, onStop,
    mode, onModeChange, enhancedCredits, onFileClick, isUploading,
    ragUploadedFileName = '', ragUploadStatus = 'idle', ragDegraded = false,
    ragUploadProgress = null, ragDocuments = [], ragMetadataOnly = false, ragRetrievalUnavailable = false, onRemoveFile, onDeleteDocument, onReembedDocument, toolsOpen, onToggleTools, tokenDisplay, responseTransparency, chatPath, failoverEvents = [], liveSearchUnavailable = false, panelOpen, isMobile,
    primaryColor = '#16a34a',
    footerText = 'AI can make mistakes. Verify important info.',
  }: Props = $props();
  let privacyOpen = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onSend(); return; }
    if (e.key === 'Enter') { e.preventDefault(); onSend(); }
  }

  function failoverTime(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'recent';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatLatency(ms: number | null): string {
    if (ms == null) return 'latency n/a';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  }

  function shortRequestId(requestId: string): string {
    return requestId ? requestId.slice(0, 8) : 'n/a';
  }

  function closePrivacyOnEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') privacyOpen = false;
  }
</script>

<svelte:window onkeydown={closePrivacyOnEscape} />

{#if !(panelOpen && isMobile)}
  <footer class="p-3 md:p-4 bg-[#faf7f2]/90 backdrop-blur-xl border-t border-stone-200/60 transition-all" style:--brand-primary={primaryColor}>
    <div class="max-w-3xl mx-auto">
      {#if ragDocuments.length > 0}
        <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-600" aria-label="Knowledge Base">
          <span class="font-semibold text-stone-500">Knowledge Base</span>
          {#each ragDocuments as document (document.id)}
            <span class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-100 px-2 py-1">
              <span class="max-w-[120px] truncate font-medium text-stone-700" title={document.filename}>{document.filename}</span>
              <span class="shrink-0 text-stone-400">{document.chunkCount} chunks</span>
              <button
                type="button"
                onclick={() => onReembedDocument(document.id)}
                class="shrink-0 rounded-md px-1 py-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
                aria-label={`Re-embed document ${document.filename}`}
                title={`Re-embed ${document.filename}`}
              >Re-embed</button>
              <button
                type="button"
                onclick={() => onDeleteDocument(document.id)}
                class="shrink-0 rounded-full p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700 transition-colors"
                aria-label={`Delete document ${document.filename}`}
                title={`Delete ${document.filename}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V5h6v2m-7 4l.5 8h7l.5-8"/></svg>
              </button>
            </span>
          {/each}
          {#if ragMetadataOnly}
            <span class="inline-flex max-w-full items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800" role="status">
              Document metadata only. Upload the source file again to use document context.
            </span>
          {/if}
          {#if ragRetrievalUnavailable}
            <span class="inline-flex max-w-full items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800" role="status">
              Document context temporarily unavailable. Continuing without uploaded document context.
            </span>
          {/if}
        </div>
      {/if}

      {#if ragUploadStatus !== 'idle' && ragUploadStatus !== 'done'}
        <div class="mb-2">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border {ragUploadStatus === 'done' ? 'bg-stone-100 border-stone-200' : ragUploadStatus === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-stone-50 border-stone-200 text-stone-500'}">
            {#if ragUploadStatus === 'uploading'}<div class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"></div>{/if}
            <span class="text-xs font-medium truncate max-w-[160px]">{ragUploadedFileName || 'Processing...'}</span>
            {#if ragDegraded}<span class="text-[10px] text-amber-600" title="Document context degraded">&#9888;</span>{/if}
            {#if ragUploadProgress && ragUploadStatus === 'uploading'}<span class="text-[10px] font-bold">{ragUploadProgress.done}/{ragUploadProgress.total}</span>{/if}
            <button onclick={onRemoveFile} class="p-0.5 rounded-full hover:bg-stone-200/50 transition-all shrink-0" aria-label="Remove file">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      {/if}

      {#if failoverEvents.length > 0}
        <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-amber-700">
          <span class="font-semibold">Failover</span>
          {#each failoverEvents.slice(0, 3) as event}
            <span class="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200/70" title={event.reason}>
              {event.provider} {failoverTime(event.timestamp)}
            </span>
          {/each}
        </div>
      {/if}

      {#if liveSearchUnavailable}
        <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-amber-800" role="status">
          <span class="inline-flex max-w-full items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1">
            Live search temporarily unavailable. Continuing without live results.
          </span>
        </div>
      {/if}

      <div class="flex gap-2 items-center">
        <button onclick={onFileClick} disabled={isUploading} class="p-2.5 hover:bg-stone-200/50 rounded-xl text-stone-400 hover:text-stone-600 transition-all disabled:opacity-30 shrink-0" title="Upload document" aria-label="Upload document">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
        </button>
        <div class="relative flex-1">
          <input
            value={inputMessage}
            oninput={(e) => onInputChange((e.target as HTMLInputElement).value)}
            onkeydown={handleKeydown}
            disabled={disabled}
            class="w-full bg-stone-100 border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300/50 text-stone-800 placeholder:text-stone-400 text-base md:text-[15px] transition-all"
            placeholder={ragUploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
            aria-label="Chat input"
          />
        </div>
        {#if isStreaming}
          <button onclick={onStop} class="bg-stone-200 hover:bg-stone-300 text-stone-500 p-2.5 rounded-xl transition-all active:scale-95 shrink-0" aria-label="Stop generating">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="2"/></svg>
          </button>
        {:else}
          <button onclick={onSend} disabled={disabled || !inputMessage.trim()} class="text-white p-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-20 shrink-0" style:background-color={primaryColor} aria-label="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
          </button>
        {/if}
      </div>

      <div
        id="privacy-notice"
        aria-hidden={!privacyOpen}
        style:grid-template-rows={privacyOpen ? '1fr' : '0fr'}
        style:opacity={privacyOpen ? '1' : '0'}
        style:margin-top={privacyOpen ? '0.75rem' : '0'}
        style:pointer-events={privacyOpen ? 'auto' : 'none'}
        class="grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:duration-0"
      >
        <div class="min-h-0 overflow-hidden">
          <section class="rounded-xl border border-stone-200/80 bg-white/75 px-3.5 py-3 text-[11px] leading-relaxed text-stone-600" aria-label="Privacy Notice">
            <div class="flex justify-between items-center gap-3">
              <strong class="text-stone-700 font-medium">Privacy Notice</strong>
              <button type="button" onclick={() => privacyOpen = false} class="text-stone-400 hover:text-stone-700 transition-colors" aria-label="Close privacy notice">Close</button>
            </div>
            <p class="mt-1.5">
              Private by default: this site does not intentionally retain your chat messages, uploaded document content,
              generated responses, or rendered artifact content in durable application storage. Your active chat remains
              in memory while this page is open.
            </p>
            <p class="mt-1.5">
              Content is processed only to provide requested features and may be handled by Cloudflare, AI providers,
              search providers, or a diagram renderer under their own terms. Limited non-content technical data may be
              retained temporarily for security and reliability. We use encrypted HTTPS transit, but no online service
              can promise absolute security. Do not submit highly sensitive personal information.
            </p>
            <p class="mt-1.5">We do not sell personal information or use it for targeted advertising.</p>
          </section>
        </div>
      </div>

      <div class="flex justify-between items-center text-[10px] md:text-[11px] text-stone-400 mt-2.5">
        <div class="flex items-center gap-2">
          <div class="flex items-center bg-stone-100 p-0.5 rounded-lg shrink-0">
            <button onclick={() => onModeChange('fast')} class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {mode === 'fast' ? 'bg-white text-stone-800 font-medium shadow-sm' : 'text-stone-400 hover:text-stone-600'}">Fast</button>
            <button onclick={() => onModeChange('brain')} class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {mode === 'brain' ? 'bg-white text-stone-800 font-medium shadow-sm' : 'text-stone-400 hover:text-stone-600'}">Brain</button>
            <button
              onclick={() => { const canUse = enhancedCredits.remaining > 0 && !enhancedCredits.budgetExhausted; if (canUse) onModeChange('live'); }}
              class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {mode === 'live' ? 'bg-stone-800 text-white font-medium' : (enhancedCredits.remaining <= 0 || enhancedCredits.budgetExhausted ? 'text-stone-300 cursor-not-allowed' : 'text-stone-400 hover:text-stone-600')}"
            >Live {enhancedCredits.remaining <= 0 ? '' : enhancedCredits.remaining}</button>
          </div>
          {#if responseTransparency}
            <span class="hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-stone-300 sm:flex" aria-label="Response details">
              <span>Provider {responseTransparency.provider}</span>
              {#if responseTransparency.activeProviderCount != null}
                <span>{responseTransparency.activeProviderCount} providers</span>
              {/if}
              <span>{formatLatency(responseTransparency.latencyMs)}</span>
              {#if responseTransparency.tokensIn != null}
                <span>{tokenDisplay?.cached ? 'cached' : `~${responseTransparency.tokensIn} tokens`}</span>
              {/if}
              {#if responseTransparency.graphTokens}
                <span>{responseTransparency.graphTokens} graph</span>
              {/if}
              {#if responseTransparency.chatPath}
                <span>{responseTransparency.chatPath}</span>
              {/if}
              {#if responseTransparency.requestId}
                <span title={`Request ${responseTransparency.requestId}`}>req {shortRequestId(responseTransparency.requestId)}</span>
              {/if}
            </span>
          {:else if tokenDisplay}
            <span class="text-[10px] text-stone-300 hidden sm:inline">{tokenDisplay.cached ? '⚡ cached' : `~${tokenDisplay.in} tokens`}{chatPath ? ` · ${chatPath}` : ''}</span>
          {/if}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="hidden sm:inline">{footerText}</span>
          <button
            type="button"
            onclick={onToggleTools}
            aria-expanded={toolsOpen}
            aria-controls="document-tools-panel"
            class="rounded-md px-1.5 py-1 text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >Tools</button>
          <button
            type="button"
            onclick={() => privacyOpen = !privacyOpen}
            aria-expanded={privacyOpen}
            aria-controls="privacy-notice"
            class="rounded-md px-1.5 py-1 text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >Privacy</button>
        </div>
      </div>
    </div>
  </footer>
{/if}
