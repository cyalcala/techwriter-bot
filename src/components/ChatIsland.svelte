<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { embedChunks, chunkText, validateDocument, type EmbedProgress } from '../lib/embed-pipeline';
  import { storeVectors, getStoredVectors, updateActivity } from '../lib/rag-db';
  import { searchInWorker } from '../lib/sim-search';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData, persistSessionId, getStoredSessionId } from '../lib/cleanup';
  import { ArtifactStreamParser, detectCodeFenceFallback, type Artifact } from '../lib/stream-parser';
  import ArtifactPanel from './ArtifactPanel.svelte';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    sources?: { title: string; url: string }[];
    empty?: boolean;
  }

  let messages = $state<Message[]>([
    { role: 'assistant', content: 'Hi! I am your Technical Writer Bot. Upload a document (txt, md, json, csv) to my sandbox memory, and I can help you draft, edit, or analyze it.' }
  ]);
  let inputMessage = $state('');
  let isLoading = $state(false);
  let isStreaming = $state(false);
  let sessionId = $state('');
  let isUploading = $state(false);
  let uploadStatus = $state<'idle' | 'uploading' | 'done' | 'error'>('idle');
  let uploadProgress = $state<EmbedProgress | null>(null);
  let uploadedFileName = $state('');
  let fileInput: HTMLInputElement;
  let isThinkingMode = $state(false);
  let isLiveMode = $state(false);
  let enhancedCredits = $state({ remaining: 3, total: 3, unlimited: false, budgetExhausted: false });
  let chatContainer: HTMLElement;
  let abortController: AbortController | null = null;
  let isOnline = $state(true);
  let editingMessageIdx = $state<number | null>(null);
  let editText = $state('');
  let copiedMessageIdx = $state<number | null>(null);
  let artifacts = $state<{ messageIdx: number; artifact: Artifact }[]>([]);
  let searchTier = $state<'basic' | 'enhanced' | 'none'>('basic');

  function generateSessionId() {
    const stored = getStoredSessionId();
    if (stored) return stored;
    try { return crypto.randomUUID(); } catch (e) {
      return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
  }

  async function pollCredits() {
    try {
      const res = await fetch('/api/search-credits');
      if (res.ok) {
        const data = await res.json();
        enhancedCredits = {
          remaining: data.remaining === -1 ? 3 : data.remaining,
          total: 3,
          unlimited: data.unlimited || false,
          budgetExhausted: data.budgetExhausted || false,
        };
      }
    } catch {}
  }

  onMount(() => {
    sessionId = generateSessionId();
    persistSessionId(sessionId);
    runStaleCheck();
    setupCleanupCallbacks(sessionId);
    pollCredits();

    isOnline = navigator.onLine;
    window.addEventListener('online', () => { isOnline = true; });
    window.addEventListener('offline', () => { isOnline = false; });
  });

  $effect(() => {
    messages;
    if (chatContainer) {
      requestAnimationFrame(() => {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
      });
    }
  });

  function newChat() {
    clearAllData(sessionId);
    sessionId = generateSessionId();
    persistSessionId(sessionId);
    messages = [{ role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' }];
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    artifacts = [];
    isLiveMode = false;
    if (fileInput) fileInput.value = '';
  }

  function clearChat() {
    clearAllData(sessionId);
    messages = [{ role: 'assistant', content: 'Chat cleared. My memory has been wiped. What would you like to work on?' }];
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    artifacts = [];
    if (fileInput) fileInput.value = '';
  }

  function removeFile() {
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    if (fileInput) fileInput.value = '';
  }

  async function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const validationError = validateDocument(file);
    if (validationError) {
      messages = [...messages, { role: 'assistant', content: `Upload error: ${validationError}` }];
      return;
    }

    isUploading = true;
    uploadStatus = 'uploading';
    uploadedFileName = file.name;
    uploadProgress = { done: 0, total: 0, skipped: 0, stage: 'idle' };

    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('File is empty.');

      const chunks = chunkText(text, 500, 100, 100);
      uploadProgress = { done: 0, total: chunks.length, skipped: 0, stage: 'embedding' };

      const { vectors, skipped } = await embedChunks(chunks, (p) => { uploadProgress = p; });

      const validChunks: { text: string; vector: number[] }[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (vectors[i] && vectors[i].length > 0) {
          validChunks.push({ text: chunks[i], vector: vectors[i] });
        }
      }

      if (validChunks.length === 0) throw new Error('Failed to generate embeddings for this document.');

      await storeVectors(sessionId, validChunks);
      await updateActivity(sessionId);

      uploadStatus = 'done';
      uploadProgress = { done: chunks.length, total: chunks.length, skipped, stage: 'done' };
      messages = [...messages, {
        role: 'assistant',
        content: `I've processed **${file.name}** — ${validChunks.length} chunks indexed${skipped > 0 ? ` (${skipped} skipped)` : ''}. You can now ask questions about it.`
      }];
    } catch (err: any) {
      console.error('[Upload]', err);
      uploadStatus = 'error';
      uploadProgress = null;
      messages = [...messages, { role: 'assistant', content: `Upload failed: ${err.message}` }];
    } finally {
      isUploading = false;
    }
  }

  async function copyMessage(idx: number) {
    try {
      await navigator.clipboard.writeText(messages[idx].content);
      copiedMessageIdx = idx;
      setTimeout(() => { copiedMessageIdx = null; }, 1500);
    } catch {}
  }

  function startEdit(idx: number) {
    editingMessageIdx = idx;
    editText = messages[idx].content;
  }

  function cancelEdit() {
    editingMessageIdx = null;
    editText = '';
  }

  async function saveEdit(idx: number) {
    if (!editText.trim()) return;
    messages = messages.slice(0, idx);
    messages = [...messages, { role: 'user', content: editText.trim() }];
    editingMessageIdx = null;
    editText = '';
    await doSend();
  }

  async function regenerate() {
    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIdx === -1) return;
    const origIdx = messages.length - 1 - lastUserIdx;
    messages = messages.slice(0, origIdx + 1);
    await doSend();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editingMessageIdx !== null) {
        cancelEdit();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      newChat();
    }
  }

  async function sendMessage() {
    if (!inputMessage.trim() || isLoading) return;
    messages = [...messages, { role: 'user', content: inputMessage.trim() }];
    inputMessage = '';
    await doSend();
  }

  function stopStreaming() {
    if (abortController) {
      abortController.abort();
      abortController = null;
      isLoading = false;
      isStreaming = false;
    }
  }

  async function doSend() {
    isLoading = true;
    abortController = new AbortController();

    let messagesToSend = [...messages];
    let sourcesFromHeaders: { title: string; url: string }[] = [];

    try {
      if (uploadStatus === 'done') {
        const lastUserMsg = [...messagesToSend].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) {
          const qEmbedRes = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: [lastUserMsg.content] }),
          });

          if (qEmbedRes.ok) {
            const qEmbData = await qEmbedRes.json();
            const queryVec = qEmbData.vectors?.[0];
            if (queryVec && queryVec.length > 0) {
              const storedVectors = await getStoredVectors(sessionId);
              const similar = await searchInWorker(storedVectors, queryVec, 3, 0.3);
              if (similar.length > 0) {
                const ragContext = similar.map((c: { text: string }, i: number) => `[Doc Chunk ${i + 1}] ${c.text}`).join('\n\n');
                messagesToSend = [
                  { role: 'system', content: `You are a helpful technical writing assistant. Use the document excerpts below to answer the user's question precisely. Cite chunks as [Doc Chunk 1], etc.\n\nDocument excerpts:\n${ragContext}` },
                  ...messagesToSend,
                ];
              }
            }
          }
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesToSend,
          intent: isThinkingMode ? 'research' : 'chat-fast',
          sessionId,
          liveSearch: isLiveMode,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMessage = errText;
        try { const errJson = JSON.parse(errText); errMessage = errJson.message || errJson.error || errText; } catch (e) {}
        throw new Error(errMessage);
      }

      const providerName = response.headers.get('x-provider') || 'AI';
      const sourcesRaw = response.headers.get('x-sources');
      if (sourcesRaw) { try { sourcesFromHeaders = JSON.parse(sourcesRaw); } catch (e) {} }

      const responseSearchTier = response.headers.get('x-search-tier') as 'basic' | 'enhanced' | 'none' | null;
      const responseSearchRemaining = response.headers.get('x-search-remaining');

      if (responseSearchTier) searchTier = responseSearchTier;
      if (responseSearchRemaining != null) {
        const remaining = responseSearchRemaining === 'unlimited' ? -1 : parseInt(responseSearchRemaining, 10);
        if (!isNaN(remaining)) {
          enhancedCredits = { ...enhancedCredits, remaining: remaining === -1 ? 3 : remaining };
        }
      }

      isStreaming = true;

      const stream = response.body;
      if (!stream) throw new Error('No response stream received');

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      messages = [...messages, { role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders }];
      const msgIdx = messages.length - 1;

      const batcher = new TokenBatcher((batch) => {
        messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + batch };
      });

      const artifactParser = new ArtifactStreamParser(
        (artifact) => {
          artifacts = [...artifacts, { messageIdx: msgIdx, artifact }];
        },
        (text) => {
          batcher.push(text);
        },
      );

      let buffer = '';
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
        }, 30_000);
      };

      resetIdleTimer();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetIdleTimer();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const rawData = trimmed.slice(trimmed.indexOf(':') + 1).trim();
            if (rawData === '[DONE]') continue;

            try {
              const json = JSON.parse(rawData);
              if (json.error) {
                const errorMsg = `\n\nError: ${json.error.message || JSON.stringify(json.error)}`;
                artifactParser.feed(errorMsg);
                continue;
              }
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.response || json.content || '';
              if (content) {
                artifactParser.feed(content);
              }
            } catch (e) {
              if (rawData && !rawData.includes('{')) {
                artifactParser.feed(rawData);
              }
            }
          }
        }

        if (buffer.trim().startsWith('data:')) {
          const rawData = buffer.slice(buffer.indexOf(':') + 1).trim();
          if (rawData !== '[DONE]') {
            try {
              const json = JSON.parse(rawData);
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.response || json.content || '';
              if (content) artifactParser.feed(content);
            } catch (e) {}
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        artifactParser.flush();
        batcher.destroy();
      }

      const existingArtifacts = artifacts.filter(a => a.messageIdx === msgIdx);
      console.debug('[Artifact]', { streamDetected: existingArtifacts.length, messageIdx: msgIdx, contentLen: messages[msgIdx]?.content?.length || 0 });
      if (existingArtifacts.length === 0 && messages[msgIdx].content) {
        const fallbackArtifacts = detectCodeFenceFallback(messages[msgIdx].content);
        console.debug('[Artifact Fallback]', { found: fallbackArtifacts.length, types: fallbackArtifacts.map(a => a.type) });
        for (const fa of fallbackArtifacts) {
          artifacts = [...artifacts, { messageIdx: msgIdx, artifact: fa }];
        }
      }

      if (!messages[msgIdx].content) {
        messages[msgIdx] = { ...messages[msgIdx], content: '', empty: true, sources: sourcesFromHeaders };
      }

      pollCredits();
      if (enhancedCredits.remaining <= 0) isLiveMode = false;
      await updateActivity(sessionId);
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      console.error('[Chat]', error);
      messages = [...messages, { role: 'assistant', content: `Connection Error: ${error.message}` }];
    } finally {
      isLoading = false;
      isStreaming = false;
      abortController = null;
    }
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatMarkdown(text: string | null | undefined): string {
    if (!text) return '';
    let formatted = escapeHtml(String(text));
    formatted = formatted.replace(/\[(\d+)\]/g, '<sup class="citation">[$1]</sup>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/^\- (.*)/gm, '<li class="ml-4 list-disc">$1</li>');
    formatted = formatted.replace(/(<li.*<\/li>)/gs, '<ul class="my-2">$1</ul>');
    formatted = formatted.replace(/\n/g, '<br />');
    return formatted;
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="flex flex-col h-dvh bg-[#fcfaf6] text-[#2e2e2e] font-['Outfit'] selection:bg-[#e8e4db] overflow-hidden">
  {#if !isOnline}
    <div class="bg-amber-500 text-white text-center text-xs py-1.5 font-medium">
      You're offline. Reconnecting...
    </div>
  {/if}

  <header class="p-3 md:p-4 bg-[#f1ede4]/90 backdrop-blur-md border-b border-[#e5e1d8] flex justify-between items-center shadow-sm z-20 pt-safe">
    <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-600 shadow-[0_0_8px_rgba(22,163,74,0.5)]"></div>
        <h1 class="text-sm md:text-lg font-bold tracking-tight text-[#1a1a1a]">
          Technical Writer <span class="hidden md:inline text-gray-400 font-normal mx-2">/</span>
          <span class="md:hidden text-[#8c8576] font-normal">Bot</span>
        </h1>
      </div>
      <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" rel="noopener" class="text-[8px] md:text-[10px] text-[#8c8576] hover:text-[#1a1a1a] transition-colors flex items-center gap-1 font-medium group">
        <span class="opacity-50">made with</span>
        <span class="text-red-500 text-[10px] group-hover:scale-125 transition-transform duration-300">&#10084;&#65039;</span>
        <span class="opacity-50">by</span>
        <span class="border-b border-transparent group-hover:border-[#8c8576] transition-all">Cy Alcala</span>
      </a>
    </div>
    <div class="flex items-center gap-1 md:gap-2">
      <button on:click={clearChat} class="text-[10px] md:text-xs bg-white/50 hover:bg-white text-[#6d675b] px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl transition-all flex items-center gap-1.5 border border-[#d6d0c4] shadow-sm active:scale-95" title="Clear chat & memory">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span class="hidden md:inline">Clear</span>
      </button>
      <button on:click={newChat} class="text-[10px] md:text-xs bg-white/50 hover:bg-white text-[#6d675b] px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl transition-all flex items-center gap-1.5 border border-[#d6d0c4] shadow-sm active:scale-95" title="New session">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
        </svg>
        <span class="hidden md:inline">New Chat</span>
        <span class="md:hidden">New</span>
      </button>
    </div>
  </header>

  <style>
    main::-webkit-scrollbar { display: none; }
    main { -ms-overflow-style: none; scrollbar-width: none; }
    .ai-content { font-family: 'Instrument Serif', serif; font-size: 1.25rem; line-height: 1.6; }
    @media (max-width: 768px) { .ai-content { font-size: 1.15rem; } }
    .citation { font-size: 0.7em; color: #8c8576; font-weight: 600; cursor: default; }
    .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0px); }
    .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
    .msg-group:hover .msg-actions { opacity: 1; }
  </style>

  <main bind:this={chatContainer} class="flex-1 overflow-y-auto px-3 py-4 md:p-8 space-y-4 md:space-y-6 max-w-4xl mx-auto w-full scroll-smooth">
    {#each messages as msg, i}
      <div class="flex msg-group {msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div class="max-w-[92%] md:max-w-[85%] rounded-3xl p-4 md:p-6 shadow-sm border {msg.role === 'user' ? 'bg-[#e8e4db] border-[#d6d0c4] text-[#1a1a1a] rounded-tr-none' : 'bg-white border-[#e5e1d8] text-[#2e2e2e] rounded-tl-none'}">
          {#if msg.role === 'assistant'}
            {#if msg.empty}
              <div class="ai-content italic text-[#8c8576]">No response received.</div>
              <button on:click={regenerate} class="mt-2 text-[10px] md:text-xs bg-[#f1ede4] hover:bg-[#e8e4db] text-[#6d675b] px-3 py-1 rounded-lg transition-all border border-[#d6d0c4] active:scale-95">Retry</button>
            {:else}
              <div class="ai-content whitespace-pre-wrap">{@html formatMarkdown(msg.content)}</div>
            {/if}
            {#if !isStreaming}
              {#each artifacts.filter(a => a.messageIdx === i) as { artifact }}
                <ArtifactPanel {artifact} />
              {/each}
            {/if}
            {#if msg.sources && msg.sources.length > 0 && !isStreaming}
              <div class="mt-3 pt-3 border-t border-[#e5e1d8]">
                <span class="text-[8px] uppercase tracking-widest font-bold text-[#8c8576] opacity-50">Sources</span>
                <div class="mt-1 space-y-0.5">
                  {#each msg.sources as source, si}
                    <a href={source.url} target="_blank" rel="noopener noreferrer" class="block text-[10px] md:text-[11px] text-[#6d675b] hover:text-[#1a1a1a] transition-colors truncate">
                      <span class="font-bold">[{si + 1}]</span> {source.title}
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
            {#if msg.provider && !isStreaming}
              <div class="mt-4 pt-3 border-t border-[#e5e1d8] flex items-center gap-2">
                {#if msg.provider === 'cloudflare-llama'}
                  <span class="text-[8px] uppercase tracking-widest font-bold text-amber-600 opacity-50">&#9889; Fallback Engine</span>
                {:else}
                  <span class="text-[8px] uppercase tracking-widest font-bold text-[#8c8576] opacity-40">Engine: {msg.provider}</span>
                {/if}
              </div>
            {/if}
            {#if !isStreaming && msg.content && !msg.empty}
              <div class="msg-actions opacity-0 transition-opacity duration-200 mt-2 flex items-center gap-1">
                <button on:click={() => copyMessage(i)} class="text-[10px] px-2 py-0.5 rounded-md bg-[#f1ede4] hover:bg-[#e8e4db] text-[#6d675b] border border-[#d6d0c4] transition-all active:scale-95" title="Copy response">
                  {copiedMessageIdx === i ? 'Copied!' : 'Copy'}
                </button>
                {#if i === messages.length - 1 || (i < messages.length - 1 && messages[i + 1]?.role === 'user')}
                  {#if i === messages.length - 1}
                    <button on:click={regenerate} class="text-[10px] px-2 py-0.5 rounded-md bg-[#f1ede4] hover:bg-[#e8e4db] text-[#6d675b] border border-[#d6d0c4] transition-all active:scale-95" title="Regenerate response">
                      Regenerate
                    </button>
                  {/if}
                {/if}
              </div>
            {/if}
          {:else}
            {#if editingMessageIdx === i}
              <div class="w-full">
                <textarea bind:value={editText} class="w-full bg-white border border-[#d6d0c4] rounded-xl p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#8c8576]/20" rows="3" on:keydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}></textarea>
                <div class="flex gap-1 mt-1.5">
                  <button on:click={() => saveEdit(i)} disabled={!editText.trim()} class="text-[10px] bg-black text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-all">Save</button>
                  <button on:click={cancelEdit} class="text-[10px] bg-[#f1ede4] text-[#6d675b] px-3 py-1 rounded-lg border border-[#d6d0c4] transition-all">Cancel</button>
                </div>
              </div>
            {:else}
              <div class="leading-relaxed whitespace-pre-wrap font-['Inter'] text-sm md:text-base">{msg.content}</div>
              {#if !isLoading}
                <div class="msg-actions opacity-0 transition-opacity duration-200 mt-1 flex items-center gap-1">
                  <button on:click={() => startEdit(i)} class="text-[10px] px-2 py-0.5 rounded-md bg-[#e8e4db]/50 hover:bg-[#e8e4db] text-[#8c8576] border border-[#d6d0c4]/50 transition-all active:scale-95" title="Edit message">
                    Edit
                  </button>
                  <button on:click={() => copyMessage(i)} class="text-[10px] px-2 py-0.5 rounded-md bg-[#e8e4db]/50 hover:bg-[#e8e4db] text-[#8c8576] border border-[#d6d0c4]/50 transition-all active:scale-95" title="Copy message">
                    {copiedMessageIdx === i ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    {/each}
    {#if isLoading && !isStreaming}
      <div class="flex justify-start">
        <div class="bg-white border border-[#e5e1d8] text-[#8c8576] px-6 py-4 rounded-full shadow-sm animate-pulse text-sm flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full bg-[#d6d0c4] animate-bounce"></div>
          Searching web &amp; gathering thoughts...
        </div>
      </div>
    {/if}
  </main>

  <footer class="p-2 md:p-6 bg-[#f1ede4]/70 backdrop-blur-sm border-t border-[#e5e1d8] transition-all pb-safe">
    <div class="max-w-4xl mx-auto">

      {#if uploadStatus !== 'idle'}
        <div class="mb-2 transition-all duration-300">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-sm {uploadStatus === 'done' ? 'bg-green-50 border-green-200 text-green-700' : uploadStatus === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-[#e8e4db]/60 border-[#d6d0c4] text-[#6d675b]'}">
            {#if uploadStatus === 'uploading'}
              <div class="w-3.5 h-3.5 border-2 border-[#8c8576] border-t-transparent rounded-full animate-spin shrink-0"></div>
            {:else if uploadStatus === 'done'}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            {:else if uploadStatus === 'error'}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span class="text-xs font-medium truncate max-w-[120px] md:max-w-[200px]">{uploadedFileName || 'Processing...'}</span>
            {#if uploadProgress && uploadStatus === 'uploading'}
              <span class="text-[10px] font-bold shrink-0">{uploadProgress.done}/{uploadProgress.total}{uploadProgress.skipped > 0 ? ` (${uploadProgress.skipped} skip)` : ''}</span>
            {/if}
            <button on:click={removeFile} class="ml-1 p-0.5 rounded-full hover:bg-black/10 transition-all shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 md:gap-3 items-center">
        <input type="file" bind:this={fileInput} on:change={handleFileUpload} class="hidden" accept=".txt,.md,.json,.csv" />
        <button
          on:click={() => fileInput.click()}
          disabled={isUploading}
          class="p-2.5 md:p-4 bg-white hover:bg-[#fcfaf6] border border-[#d6d0c4] rounded-xl md:rounded-2xl text-[#8c8576] transition-all shadow-sm disabled:opacity-50 shrink-0"
          title={uploadStatus === 'done' ? 'Replace document' : 'Upload document (txt, md, json, csv)'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <div class="relative flex-1">
          <input
            bind:value={inputMessage}
            on:keydown={handleKeydown}
            disabled={isLoading}
            class="w-full bg-white/80 border border-[#d6d0c4] rounded-xl md:rounded-2xl p-2.5 md:p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#8c8576]/20 text-[#1a1a1a] placeholder:text-[#a39e91] text-sm md:text-lg"
            placeholder={uploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
          />
        </div>

        {#if isStreaming}
        <button
          on:click={stopStreaming}
          class="bg-red-600 hover:bg-red-700 text-white p-2.5 md:px-8 md:py-4 rounded-xl md:rounded-2xl transition-all shadow-md active:scale-95 shrink-0 flex items-center justify-center"
          title="Stop generating"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <rect x="3" y="3" width="14" height="14" rx="2" />
          </svg>
          <span class="hidden md:inline text-sm md:text-base font-bold tracking-wide ml-1">Stop</span>
        </button>
      {:else}
        <button
          on:click={sendMessage}
          disabled={isLoading || !inputMessage.trim()}
          class="bg-black hover:bg-gray-800 text-white p-2.5 md:px-8 md:py-4 rounded-xl md:rounded-2xl transition-all shadow-md active:scale-95 disabled:opacity-50 shrink-0 flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 md:hidden" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
          <span class="hidden md:inline text-sm md:text-base font-bold tracking-wide">Send</span>
        </button>
      {/if}
      </div>

      <div class="flex justify-between items-center gap-1 text-[9px] md:text-[11px] text-[#8c8576] mt-2">
        <div class="flex items-center gap-1 md:gap-2">
          <div class="flex items-center bg-[#e8e4db]/50 p-0.5 rounded-md md:rounded-lg border border-[#d6d0c4] shadow-inner shrink-0">
            <button on:click={() => { isThinkingMode = false; isLiveMode = false; }} class="px-1.5 md:px-4 py-1 rounded-sm md:rounded-md transition-all {!isThinkingMode && !isLiveMode ? 'bg-white text-[#1a1a1a] shadow-sm font-bold' : 'text-[#8c8576]'} text-[9px] md:text-xs">Fast</button>
            <button on:click={() => { isThinkingMode = true; isLiveMode = false; }} class="px-1.5 md:px-4 py-1 rounded-sm md:rounded-md transition-all {isThinkingMode && !isLiveMode ? 'bg-black text-white shadow-sm font-bold' : 'text-[#8c8576]'} text-[9px] md:text-xs">Brain</button>
            <button
              on:click={() => {
                const canUse = enhancedCredits.remaining > 0 && !enhancedCredits.budgetExhausted;
                if (canUse) { isThinkingMode = false; isLiveMode = !isLiveMode; }
              }}
              class="px-1.5 md:px-4 py-1 rounded-sm md:rounded-md transition-all text-[9px] md:text-xs {isLiveMode ? 'bg-green-600 text-white shadow-sm font-bold' : (enhancedCredits.remaining <= 0 || enhancedCredits.budgetExhausted ? 'text-[#c4bfb4] cursor-not-allowed' : 'text-[#8c8576] hover:text-green-600')}"
              title={enhancedCredits.budgetExhausted ? 'Monthly pool exhausted. Resets 1st.' : enhancedCredits.remaining <= 0 ? 'Resets tomorrow. Basic search active.' : 'Click for enhanced web search'}
            >
              Live
              <span class="ml-1 text-[7px] md:text-[8px] opacity-70">
                {enhancedCredits.remaining <= 0 ? '0 left' : `${enhancedCredits.remaining} left`}
              </span>
            </button>
          </div>
          <span class="hidden sm:inline opacity-40">|</span>
          <span class="hidden sm:inline font-mono opacity-60 text-[8px] md:text-[10px]">SESS:{sessionId.slice(0, 6)}</span>
        </div>
        <div class="text-[7px] md:text-[8px] opacity-50 text-center flex-1 mx-2">
          This AI can make mistakes. Verify important info.
        </div>
        <div class="flex items-center gap-1 text-green-600 font-bold uppercase tracking-tighter text-[7px] md:text-[8px] shrink-0">
          <span class="hidden md:inline bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100">Cloudflare Secured</span>
        </div>
      </div>
    </div>
  </footer>
</div>