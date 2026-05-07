<script lang="ts">
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
    ragUploadProgress?: { done: number; total: number };
    onRemoveFile: () => void;
    tokenDisplay: { in: number; cached?: boolean } | null;
    chatPath: string | null;
    panelOpen: boolean;
    isMobile: boolean;
  }

  let {
    disabled, isStreaming, inputMessage, onInputChange, onSend, onStop,
    mode, onModeChange, enhancedCredits, onFileClick, isUploading,
    ragUploadedFileName = '', ragUploadStatus = 'idle', ragDegraded = false,
    ragUploadProgress = null, onRemoveFile, tokenDisplay, chatPath, panelOpen, isMobile,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onSend(); return; }
    if (e.key === 'Enter') { e.preventDefault(); onSend(); }
  }
</script>

{#if !(panelOpen && isMobile)}
  <footer class="p-3 md:p-4 bg-[#faf7f2]/90 backdrop-blur-xl border-t border-stone-200/60 transition-all">
    <div class="max-w-3xl mx-auto">
      {#if ragUploadStatus !== 'idle'}
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
            class="w-full bg-stone-100 border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300/50 text-stone-800 placeholder:text-stone-400 text-[15px] transition-all"
            placeholder={ragUploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
            aria-label="Chat input"
          />
        </div>
        {#if isStreaming}
          <button onclick={onStop} class="bg-stone-200 hover:bg-stone-300 text-stone-500 p-2.5 rounded-xl transition-all active:scale-95 shrink-0" aria-label="Stop generating">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="2"/></svg>
          </button>
        {:else}
          <button onclick={onSend} disabled={disabled || !inputMessage.trim()} class="bg-stone-800 hover:bg-stone-700 text-white p-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-20 shrink-0" aria-label="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
          </button>
        {/if}
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
          {#if tokenDisplay}
            <span class="text-[10px] text-stone-300 hidden sm:inline">{tokenDisplay.cached ? '⚡ cached' : `~${tokenDisplay.in} tokens`}{chatPath ? ` · ${chatPath}` : ''}</span>
          {/if}
        </div>
        <span class="hidden sm:inline">AI can make mistakes. Verify important info.</span>
      </div>
    </div>
  </footer>
{/if}
