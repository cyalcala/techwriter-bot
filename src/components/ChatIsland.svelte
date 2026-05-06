<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { handleFileUpload, searchDocumentChunks, formatRagContext, clearRagState, createDefaultRagState, type RagState } from '../lib/rag-client';
  import { updateActivity } from '../lib/rag-db';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData, persistSessionId, getStoredSessionId } from '../lib/cleanup';
  import { ArtifactStreamParser, detectCodeFenceFallback, type Artifact } from '../lib/stream-parser';
  import { detectAllArtifacts } from '../lib/artifact-detector';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import { preloadPopular } from '../lib/renderer-loader';
  import { createArtifactState, openSplitArtifact, closeSplitArtifact, fixArtifactError, type SplitTab } from '../lib/artifact-state';
  import { stripDisclaimers, formatMarkdown } from '../lib/markdown';
  import { estimateTokens } from '../lib/token-counter';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    sources?: { title: string; url: string }[];
    searchTier?: 'none' | 'basic' | 'enhanced';
    empty?: boolean;
  }

  let messages = $state<Message[]>([
    { role: 'assistant', content: "Hi! I'm Technical Writer. I help with writing, research, diagrams, and code. What can I create for you?" }
  ]);
  let inputMessage = $state('');
  let isLoading = $state(false);
  let isStreaming = $state(false);
  let sessionId = $state('');
  let isUploading = $state(false);
  let rag = $state<RagState>(createDefaultRagState());
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
  let searchTier = $state<'basic' | 'enhanced' | 'none'>('basic');
  let keyStatus = $state<{ groq: boolean; gemini: boolean; cerebras: boolean } | null>(null);

  let artState = $state(createArtifactState());
  let chatPath = $state<string | null>(null);
  let tokenDisplay = $state<{ in: number; graph: number; cached?: boolean } | null>(null);

  function fixArtifactErr() {
    const prompt = fixArtifactError(artState.artifactError, artState.splitArtifact);
    if (prompt) {
      messages = [...messages, { role: 'user', content: prompt }];
      artState.artifactError = null;
      doSend();
    }
  }

  async function checkKeys() {
    try {
      const res = await fetch('/api/chat');
      const data = await res.json();
      keyStatus = {
        groq: data.keys?.GROQ_API_KEY === true,
        gemini: data.keys?.GEMINI_API_KEY === true,
        cerebras: data.keys?.CEREBRAS_API_KEY === true,
      };
    } catch { keyStatus = null; }
  }

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
    checkKeys();
    preloadPopular();

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'ARTIFACT_ERROR') {
        artState.artifactError = e.data.error;
      }
      if (e.data?.source === 'artifact') {
        const { action, payload } = e.data;
        if (action === 'regenerate') { regenerate(); }
        else if (action === 'copy') { navigator.clipboard.writeText(payload || '').catch(() => {}); }
        else if (action === 'error') { artState.artifactError = payload; }
        console.log('[ArtifactBridge]', action, payload);
      }
    });

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
    rag = clearRagState();
    artState = createArtifactState();
    isLiveMode = false;
    chatPath = null;
    if (fileInput) fileInput.value = '';
  }

  function clearChat() {
    clearAllData(sessionId);
    messages = [{ role: 'assistant', content: 'Chat cleared. My memory has been wiped. What would you like to work on?' }];
    rag = clearRagState();
    artState = createArtifactState();
    chatPath = null;
    if (fileInput) fileInput.value = '';
  }

  function removeFile() {
    rag = clearRagState();
    if (fileInput) fileInput.value = '';
  }

  async function onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    isUploading = true;
    rag.uploadStatus = 'uploading';
    rag.uploadedFileName = file.name;

    const result = await handleFileUpload(
      file, sessionId,
      (p) => rag.uploadProgress = p,
      (s) => rag.uploadStatus = s,
    );

    if (result.success) {
      rag.ragDegraded = result.degraded;
      messages = [...messages, { role: 'assistant', content: result.message }];

      try {
        const vectors = await import('../lib/rag-db').then(m => m.getStoredVectors(sessionId));
        if (vectors.length > 0) {
          const chunks = vectors.map(v => ({ text: v.text, vector: v.vector }));
          await fetch('/api/rag-store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, chunks }),
          });
        }
      } catch {}
    } else {
      messages = [...messages, { role: 'assistant', content: result.message }];
    }

    isUploading = false;
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
      if (artState.splitArtifact) { const r = closeSplitArtifact(); artState.splitArtifact = r.split; artState.artifactError = r.error; return; }
      if (editingMessageIdx !== null) { cancelEdit(); return; }
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
    let msgSearchTier: 'none' | 'basic' | 'enhanced' = 'none';

    const idempotencyKey = crypto.randomUUID();

    const totalEst = messagesToSend.reduce((s, m) => s + estimateTokens(m.content || ''), 0);
    if (totalEst > 4000) {
      const oldest = messagesToSend.slice(1, -3);
      if (oldest.length > 0) {
        try {
          const res = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: oldest }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.summary) {
              const recent = messagesToSend.slice(-3);
              messagesToSend = [messagesToSend[0], { role: 'system', content: `Previous conversation summary: ${data.summary}` }, ...recent];
            }
          }
        } catch {}
      }
    }

    try {
      const hasDocument = rag.uploadStatus === 'done';

      if (hasDocument) {
        const lastUserMsg = [...messagesToSend].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) {
          const { chunks, embedFailed } = await searchDocumentChunks(sessionId, lastUserMsg.content);
          if (embedFailed) {
            rag.ragDegraded = true;
          }
          if (chunks.length > 0) {
            const ctx = formatRagContext(chunks);
            if (ctx) {
              messagesToSend = [
                { role: 'system', content: `Use these document key points. Cite as [Point 1], [Point 2], etc.\n\n${ctx}` },
                ...messagesToSend,
              ];
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
          hasDocument,
          idempotencyKey,
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
      if (responseSearchTier) msgSearchTier = responseSearchTier;

      const responseSearchRemaining = response.headers.get('x-search-remaining');
      if (responseSearchRemaining != null) {
        const remaining = responseSearchRemaining === 'unlimited' ? -1 : parseInt(responseSearchRemaining, 10);
        if (!isNaN(remaining)) {
          enhancedCredits = { ...enhancedCredits, remaining: remaining === -1 ? 3 : remaining };
        }
      }

      const pathFromServer = response.headers.get('x-chat-path');
      if (pathFromServer) chatPath = pathFromServer;

      const tokenUsageHeader = response.headers.get('x-token-usage');
      if (tokenUsageHeader) {
        try { tokenDisplay = JSON.parse(tokenUsageHeader); } catch {}
      } else {
        tokenDisplay = null;
      }

      const cachedHeader = response.headers.get('x-cached');
      if (cachedHeader === 'true' && tokenDisplay) {
        tokenDisplay.cached = true;
      }

      isStreaming = true;

      const stream = response.body;
      if (!stream) throw new Error('No response stream received');

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      messages = [...messages, { role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders, searchTier: msgSearchTier }];
      const msgIdx = messages.length - 1;

      const batcher = new TokenBatcher((batch) => {
        messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + batch };
      });

      const artifactParser = new ArtifactStreamParser(
        (artifact) => {
          artState.artifacts = [...artState.artifacts, { messageIdx: msgIdx, artifact }];
        },
        (text) => {
          batcher.push(text);
        },
      );

      let buffer = '';
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const idleTimeout = chatPath === 'fast' ? 15_000 : 30_000;

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
        }, idleTimeout);
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

      const existingArtifacts = artState.artifacts.filter(a => a.messageIdx === msgIdx);

      if (messages[msgIdx].content) {
        const result = detectAllArtifacts(messages[msgIdx].content, existingArtifacts);
        for (const fa of result.artifacts) {
          artState.artifacts = [...artState.artifacts, { messageIdx: msgIdx, artifact: fa }];
        }
        messages[msgIdx] = { ...messages[msgIdx], content: result.cleanText };
      }

      const msgArtifacts = artState.artifacts.filter(a => a.messageIdx === msgIdx);
      if (msgArtifacts.length > 0) {
        const { split, tab } = openSplitArtifact(msgIdx, msgArtifacts[0].artifact, artState.artifacts);
        artState.splitArtifact = split;
        artState.splitTab = tab;
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
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="flex h-dvh bg-[#faf7f2] text-stone-800 font-['Inter'] selection:bg-amber-200/50 overflow-hidden">
  <div class="flex flex-col flex-1 min-w-0 transition-all duration-300">
  {#if !isOnline}
    <div class="bg-amber-600 text-white text-center text-xs py-1.5 font-medium tracking-wide">
      You're offline. Reconnecting...
    </div>
  {/if}
  {#if keyStatus && (!keyStatus.groq || !keyStatus.gemini || !keyStatus.cerebras)}
    <div class="bg-red-600/80 text-white text-center text-xs py-1.5 font-medium flex items-center justify-center gap-2">
      <span>Keys missing</span>
      <span class="opacity-70">(using fallback)</span>
    </div>
  {/if}

  <header class="px-3 md:px-6 py-2.5 bg-[#faf7f2]/90 backdrop-blur-xl border-b border-stone-200/60 flex justify-between items-center z-20">
    <div class="flex items-center gap-2 md:gap-3 min-w-0">
      <div class="flex items-center gap-1.5 shrink-0">
        <div class="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-600 animate-pulse shadow-[0_0_6px_rgba(22,163,74,0.4)]"></div>
        <h1 class="text-xs md:text-sm font-semibold tracking-tight text-stone-800 whitespace-nowrap">Technical Writer</h1>
      </div>
      <span class="text-stone-300 hidden sm:inline">/</span>
      <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" rel="noopener" class="hidden sm:flex items-center gap-1 text-[10px] md:text-[11px] text-stone-400 hover:text-stone-600 transition-colors font-medium">
        <span>Made with</span>
        <span class="text-red-400 text-[10px]">&#10084;&#65039;</span>
        <span>by</span>
        <span class="border-b border-stone-300/50 hover:border-stone-400 transition-all">Cy Alcala</span>
      </a>
      <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" rel="noopener" class="sm:hidden flex items-center gap-0.5 text-[10px] text-stone-400 font-medium">
        <span class="text-red-400 text-[9px]">&#10084;</span>
        <span class="border-b border-stone-300/50">Cy Alcala</span>
      </a>
    </div>
    <div class="flex items-center gap-0.5 shrink-0">
      <button onclick={clearChat} class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="Clear">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        <span class="hidden sm:inline">Clear</span>
      </button>
      <button onclick={newChat} class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="New">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
        <span class="hidden sm:inline">New</span>
      </button>
    </div>
  </header>

  <style>
    main::-webkit-scrollbar { display: none; }
    main { -ms-overflow-style: none; scrollbar-width: none; }
    .ai-content { font-family: 'Instrument Serif', serif; font-size: 1.15rem; line-height: 1.65; }
    @media (min-width: 768px) { .ai-content { font-size: 1.25rem; } }
    .citation { font-size: 0.7em; color: #a89f91; font-weight: 600; cursor: default; }
    .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0px); }
    .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
    .msg-group:hover .msg-actions { opacity: 1; }
  </style>

  <main bind:this={chatContainer} class="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-6 w-full scroll-smooth max-w-3xl mx-auto" style="overscroll-behavior: contain;">
    {#each messages as msg, i}
      <div class="msg-group relative {msg.role === 'user' ? 'flex flex-row-reverse' : ''}">
        <div class="{msg.role === 'user' ? 'ml-auto text-right max-w-[85%] md:max-w-[70%]' : 'max-w-full'}">
          {#if msg.role === 'assistant'}
            {#if msg.empty}
              <div class="text-[#71717a] italic text-sm">No response received.</div>
            {:else}
              <div class="ai-content whitespace-pre-wrap">{@html formatMarkdown(stripDisclaimers(msg.content), msg.sources)}</div>
            {/if}
            {#if !isStreaming && msg.content && !msg.empty}
              <div class="flex items-center gap-2 mt-1.5 opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity duration-150">
                <button onclick={() => copyMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">{copiedMessageIdx === i ? 'Copied' : 'Copy'}</button>
                {#if i === messages.length - 1}
                  <button onclick={regenerate} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">Retry</button>
                {/if}
              </div>
            {/if}
            {#if msg.sources && msg.sources.length > 0 && !isStreaming}
              <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {#if msg.searchTier && msg.searchTier !== 'none'}
                  <span class="text-[11px] font-medium text-black/60">{msg.searchTier === 'enhanced' ? 'Enhanced' : 'Live'}</span>
                {/if}
                {#each msg.sources as source, si}
                  <a href={source.url} target="_blank" rel="noopener noreferrer" class="text-[11px] text-[#999] hover:text-black transition-colors underline underline-offset-2 decoration-[#d9d9d9] hover:decoration-black">
                    [{si + 1}] {source.title}
                  </a>
                {/each}
                <span class="text-[10px] text-[#bbb]">{msg.provider}{chatPath ? ` · ${chatPath}` : ''}</span>
              </div>
            {/if}
          {:else}
            {#if editingMessageIdx === i}
              <div class="w-full text-left">
                <textarea bind:value={editText} class="w-full bg-[#1a1a22] border border-white/[0.1] rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-[#e4e4e7]" rows="3"></textarea>
                <div class="flex gap-1.5 mt-2">
                  <button onclick={() => saveEdit(i)} disabled={!editText.trim()} class="text-[10px] bg-white text-black px-3 py-1 rounded-lg disabled:opacity-40 transition-all font-medium">Save</button>
                  <button onclick={cancelEdit} class="text-[10px] bg-white/[0.05] text-[#a1a1aa] px-3 py-1 rounded-lg border border-white/[0.06] transition-all">Cancel</button>
                </div>
              </div>
            {:else}
              <div class="bg-stone-100 rounded-2xl px-4 py-2.5 inline-block text-left">
                <div class="leading-relaxed text-[15px] text-[#1a1a1a]">{msg.content}</div>
              </div>
              <div class="flex items-center gap-2 mt-1 justify-end opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity duration-150">
                <button onclick={() => startEdit(i)} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">Edit</button>
                <button onclick={() => copyMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">{copiedMessageIdx === i ? 'Copied' : 'Copy'}</button>
              </div>
            {/if}
          {/if}
        </div>
      </div>
      {#if !isStreaming && !artState.splitArtifact}
        {#each artState.artifacts.filter(a => a.messageIdx === i) as { artifact }}
          <div class="flex justify-start w-full">
            <button onclick={() => { const { split, tab } = openSplitArtifact(i, artifact, artState.artifacts); artState.splitArtifact = split; artState.splitTab = tab; }} class="w-full max-w-md text-left px-4 py-2.5 rounded-xl bg-[#f1ede4]/60 hover:bg-[#e8e4db] border border-[#d6d0c4] transition-all group">
              <div class="flex items-center gap-2">
                <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md bg-purple-600 text-white">{artifact.type}</span>
                <span class="text-xs font-medium text-[#1a1a1a] truncate">{artifact.title || 'Artifact'}</span>
                <span class="text-[10px] text-[#8c8576] group-hover:text-[#1a1a1a] ml-auto shrink-0">View →</span>
              </div>
            </button>
          </div>
        {/each}
      {/if}
    {/each}
    {#if isLoading && !isStreaming}
      <div class="flex justify-start">
        <div class="bg-white border border-[#e5e1d8] text-[#8c8576] px-6 py-4 rounded-full shadow-sm animate-pulse text-sm flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full bg-[#d6d0c4] animate-bounce"></div>
          {chatPath === 'fast' ? 'Thinking...' : chatPath === 'balanced' ? 'Gathering knowledge...' : 'Searching web &amp; gathering thoughts...'}
        </div>
      </div>
    {/if}
  </main>

  <footer class="p-3 md:p-4 bg-[#faf7f2]/90 backdrop-blur-xl border-t border-stone-200/60 transition-all">
    <div class="max-w-3xl mx-auto">

      {#if rag.uploadStatus !== 'idle'}
        <div class="mb-2">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border {rag.uploadStatus === 'done' ? 'bg-stone-100 border-stone-200' : rag.uploadStatus === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-stone-50 border-stone-200 text-stone-500'}">
            {#if rag.uploadStatus === 'uploading'}<div class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"></div>{/if}
            <span class="text-xs font-medium truncate max-w-[160px]">{rag.uploadedFileName || 'Processing...'}</span>
            {#if rag.ragDegraded}<span class="text-[10px] text-amber-600" title="Document context degraded">&#9888;</span>{/if}
            {#if rag.uploadProgress && rag.uploadStatus === 'uploading'}<span class="text-[10px] font-bold">{rag.uploadProgress.done}/{rag.uploadProgress.total}</span>{/if}
            <button onclick={removeFile} class="p-0.5 rounded-full hover:bg-stone-200/50 transition-all shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 items-center">
        <input type="file" bind:this={fileInput} onchange={onFileSelected} class="hidden" accept=".txt,.md,.json,.csv" />
        <button onclick={() => fileInput.click()} disabled={isUploading} class="p-2.5 hover:bg-stone-200/50 rounded-xl text-stone-400 hover:text-stone-600 transition-all disabled:opacity-30 shrink-0" title="Upload">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
        </button>
        <div class="relative flex-1">
          <input bind:value={inputMessage} onkeydown={handleKeydown} disabled={isLoading}
            class="w-full bg-stone-100 border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-300/50 text-stone-800 placeholder:text-stone-400 text-[15px] transition-all"
            placeholder={rag.uploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
          />
        </div>
        {#if isStreaming}
          <button onclick={stopStreaming} class="bg-stone-200 hover:bg-stone-300 text-stone-500 p-2.5 rounded-xl transition-all active:scale-95 shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="2"/></svg></button>
        {:else}
          <button onclick={sendMessage} disabled={isLoading || !inputMessage.trim()} class="bg-stone-800 hover:bg-stone-700 text-white p-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-20 shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg></button>
        {/if}
      </div>

      <div class="flex justify-between items-center text-[10px] md:text-[11px] text-stone-400 mt-2.5">
        <div class="flex items-center gap-2">
          <div class="flex items-center bg-stone-100 p-0.5 rounded-lg shrink-0">
            <button onclick={() => { isThinkingMode = false; isLiveMode = false; }} class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {!isThinkingMode && !isLiveMode ? 'bg-white text-stone-800 font-medium shadow-sm' : 'text-stone-400 hover:text-stone-600'}">Fast</button>
            <button onclick={() => { isThinkingMode = true; isLiveMode = false; }} class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {isThinkingMode && !isLiveMode ? 'bg-white text-stone-800 font-medium shadow-sm' : 'text-stone-400 hover:text-stone-600'}">Brain</button>
            <button onclick={() => { const canUse = enhancedCredits.remaining > 0 && !enhancedCredits.budgetExhausted; if (canUse) { isThinkingMode = false; isLiveMode = !isLiveMode; } }}
              class="px-2 md:px-2.5 py-1 rounded-md transition-all text-[10px] {isLiveMode ? 'bg-stone-800 text-white font-medium' : (enhancedCredits.remaining <= 0 || enhancedCredits.budgetExhausted ? 'text-stone-300 cursor-not-allowed' : 'text-stone-400 hover:text-stone-600')}">
              Live {enhancedCredits.remaining <= 0 ? '' : enhancedCredits.remaining}
            </button>
          </div>
          {#if tokenDisplay}
            <span class="text-[10px] text-stone-300 hidden sm:inline">{tokenDisplay.cached ? '⚡ cached' : `~${tokenDisplay.in} tokens`}{chatPath ? ` · ${chatPath}` : ''}</span>
          {/if}
        </div>
        <span class="hidden sm:inline">AI can make mistakes. Verify important info.</span>
      </div>
    </div>
  </footer>
  </div>

  {#if artState.splitArtifact}
    <div class="hidden md:block w-1.5 bg-stone-300 hover:bg-amber-400 cursor-col-resize shrink-0 transition-colors z-20" role="separator"></div>
    <div class="w-full md:w-[50%] min-w-0 md:min-w-[360px] bg-[#faf7f2] flex flex-col overflow-hidden shadow-2xl z-10 fixed md:relative inset-0 md:inset-auto" style="resize: horizontal;">
      <!-- Mobile back bar -->
      <div class="md:hidden flex items-center justify-between px-4 py-3 bg-stone-800 text-white shrink-0 border-b border-stone-700">
        <button onclick={() => { const r = closeSplitArtifact(); artState.splitArtifact = r.split; artState.artifactError = r.error; }} class="flex items-center gap-2 text-white hover:text-amber-300 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7 7"/></svg>
          <span class="text-sm font-medium">Back to Chat</span>
        </button>
        <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md bg-amber-500 text-stone-900">{artState.splitArtifact.artifact.type}</span>
      </div>
      <!-- Desktop header -->
      <div class="hidden md:flex items-center justify-between px-4 py-2.5 bg-stone-800 text-white shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md bg-amber-500 text-stone-900">{artState.splitArtifact.artifact.type}</span>
          <span class="text-xs font-medium text-stone-300 truncate">{artState.splitArtifact.artifact.title || 'Artifact'}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick={() => artState.splitTab = 'code'} class="text-[10px] px-2.5 py-1 rounded-md {artState.splitTab === 'code' ? 'bg-white/20 text-white font-bold' : 'text-stone-400 hover:text-white'}">Code</button>
          <button onclick={() => artState.splitTab = 'preview'} class="text-[10px] px-2.5 py-1 rounded-md {artState.splitTab === 'preview' ? 'bg-white/20 text-white font-bold' : 'text-stone-400 hover:text-white'}">Preview</button>
          <button onclick={async () => { try { await navigator.clipboard.writeText(artState.splitArtifact!.artifact.code); } catch {} }} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all">Copy</button>
          <button onclick={() => { const b = new Blob([artState.splitArtifact!.artifact.code], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download=(artState.splitArtifact!.artifact.title||'artifact').replace(/[^a-zA-Z0-9_-]/g,'_'); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" title="Download">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </button>
          <button onclick={() => { const r = closeSplitArtifact(); artState.splitArtifact = r.split; artState.artifactError = r.error; }} class="text-[10px] px-2 py-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 transition-all" title="Close (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <!-- Mobile tabs -->
      <div class="md:hidden flex items-center gap-1 px-3 py-2 bg-stone-700 shrink-0">
        <button onclick={() => artState.splitTab = 'code'} class="flex-1 text-[11px] px-3 py-1.5 rounded-md text-center {artState.splitTab === 'code' ? 'bg-white/20 text-white font-bold' : 'text-stone-400'}">Code</button>
        <button onclick={() => artState.splitTab = 'preview'} class="flex-1 text-[11px] px-3 py-1.5 rounded-md text-center {artState.splitTab === 'preview' ? 'bg-white/20 text-white font-bold' : 'text-stone-400'}">Preview</button>
        <button onclick={async () => { try { await navigator.clipboard.writeText(artState.splitArtifact!.artifact.code); } catch {} }} class="text-[11px] px-3 py-1.5 rounded-md text-stone-400">Copy</button>
      </div>
      <div class="flex-1 overflow-auto bg-[#faf7f2]">
        {#if artState.artifactError}
          <div class="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2">
            <div class="text-xs text-red-700 truncate min-w-0">
              <span class="font-bold">Error:</span> {artState.artifactError}
            </div>
            <button onclick={fixArtifactErr} class="text-[10px] px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold shrink-0 transition-all">Fix with AI</button>
          </div>
        {/if}
        <ArtifactPanel artifact={artState.splitArtifact.artifact} progressive={true} />
      </div>
    </div>
  {/if}
</div>
