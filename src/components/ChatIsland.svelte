<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { embedChunks, chunkText, validateDocument, type EmbedProgress } from '../lib/embed-pipeline';
  import { storeVectors, getStoredVectors, updateActivity } from '../lib/rag-db';
  import { searchInWorker } from '../lib/sim-search';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData, persistSessionId, getStoredSessionId } from '../lib/cleanup';
  import { ArtifactStreamParser, detectCodeFenceFallback, type Artifact } from '../lib/stream-parser';
  import { detectAllArtifacts } from '../lib/artifact-detector';
  import ArtifactPanel from './ArtifactPanel.svelte';
  import { preloadPopular } from '../lib/renderer-loader';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    sources?: { title: string; url: string }[];
    searchTier?: 'none' | 'basic' | 'enhanced';
    empty?: boolean;
  }

  let messages = $state<Message[]>([
    { role: 'assistant', content: "Hi! I'm your Technical Writer Bot. I can help you write, research, and visualize ideas. Here's what I can create:\n\n**Diagrams** — ask me for org charts (Graphviz), flowcharts (Mermaid), cloud architecture (D2), mind maps (Markmap), UML diagrams (PlantUML)\n\n**Data** — charts and graphs (Vega-Lite), math equations (KaTeX)\n\n**Interactive apps** — React components, full web apps with live preview, multi-file projects with npm\n\n**Documents** — upload a .txt, .md, .json, or .csv and I'll analyze it, find patterns, suggest visualizations\n\nJust tell me what you need — I'll suggest the best format before creating it. What would you like to work on?" }
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
  let ragDegraded = $state(false);
  let keyStatus = $state<{ groq: boolean; gemini: boolean; cerebras: boolean } | null>(null);
  let splitArtifact = $state<{ messageIdx: number; artifact: Artifact } | null>(null);
  let splitTab = $state<'code' | 'preview'>('preview');
  let artifactError = $state<string | null>(null);

  function fixArtifactError() {
    if (!artifactError || !splitArtifact) return;
    const fixPrompt = `The following artifact has an error:\n\n\`\`\`\n${splitArtifact.artifact.code}\n\`\`\`\n\nError: ${artifactError}\n\nPlease fix this code.`;
    messages = [...messages, { role: 'user', content: fixPrompt }];
    artifactError = null;
    doSend();
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
        artifactError = e.data.error;
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
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    artifacts = [];
    isLiveMode = false;
    ragDegraded = false;
    if (fileInput) fileInput.value = '';
  }

  function clearChat() {
    clearAllData(sessionId);
    messages = [{ role: 'assistant', content: 'Chat cleared. My memory has been wiped. What would you like to work on?' }];
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    artifacts = [];
    ragDegraded = false;
    if (fileInput) fileInput.value = '';
  }

  function removeFile() {
    uploadStatus = 'idle';
    uploadedFileName = '';
    uploadProgress = null;
    ragDegraded = false;
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

      const { vectors, skipped, degraded } = await embedChunks(chunks, (p) => { uploadProgress = p; });
      ragDegraded = degraded;

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
      let modeNote = degraded ? ' (offline fallback)' : '';
      messages = [...messages, {
        role: 'assistant',
        content: `I've processed **${file.name}** — ${validChunks.length} chunks indexed${skipped > 0 ? ` (${skipped} skipped)` : ''}${modeNote}. You can now ask questions about it.`
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
      if (splitArtifact) { splitArtifact = null; return; }
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
    let msgSearchTier: 'none' | 'basic' | 'enhanced' = 'none';

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
                const extractKeyPoints = (text: string, maxLen: number = 300): string => {
                  const sentences = text.split(/[.!?]\s+/);
                  let result = '';
                  for (const s of sentences) {
                    if (s.length < 10) continue;
                    if (result.length + s.length > maxLen) break;
                    result += (result ? '. ' : '') + s;
                  }
                  return result || text.slice(0, maxLen);
                };
                const ragContext = similar.map((c: { text: string }, i: number) =>
                  `[Point ${i + 1}] ${extractKeyPoints(c.text)}`
                ).join('\n');
                const contextLen = ragContext.length;
                const cappedContext = contextLen > 2000
                  ? ragContext.slice(0, 2000) + '\n[Context truncated — ask for details on specific points]'
                  : ragContext;
                messagesToSend = [
                  { role: 'system', content: `Use these document key points to answer. Cite as [Point 1], [Point 2], etc. If info is insufficient, ask clarifying questions rather than guessing.\n\n${cappedContext}` },
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
      if (responseSearchTier) msgSearchTier = responseSearchTier;

      const responseSearchRemaining = response.headers.get('x-search-remaining');
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

      messages = [...messages, { role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders, searchTier: msgSearchTier }];
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

      if (messages[msgIdx].content) {
        const result = detectAllArtifacts(messages[msgIdx].content, existingArtifacts);
        for (const fa of result.artifacts) {
          artifacts = [...artifacts, { messageIdx: msgIdx, artifact: fa }];
        }
        messages[msgIdx] = { ...messages[msgIdx], content: result.cleanText };
      }

      const msgArtifacts = artifacts.filter(a => a.messageIdx === msgIdx);
      if (msgArtifacts.length > 1) {
        const seen = new Set<string>();
        artifacts = artifacts.filter(a => {
          if (a.messageIdx !== msgIdx) return true;
          const key = `${a.artifact.type}:${a.artifact.code.slice(0, 100)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      const dedupeArtifacts = artifacts.filter(a => a.messageIdx === msgIdx);
      if (dedupeArtifacts.length > 0) {
        splitArtifact = dedupeArtifacts[0];
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

  function stripDisclaimers(text: string): string {
    return text
      .replace(/\b(my|our) (training data|knowledge) (only goes|ended|cutoff).*?(20\d{2}|20\d{2}\.)/gi, '')
      .replace(/\bPlease note that (my|our) (knowledge|training|information).*?\.\s*/gi, '')
      .replace(/\[Pre-2023 knowledge\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function formatMarkdown(text: string | null | undefined, sources?: { title: string; url: string }[]): string {
    if (!text) return '';
    let formatted = escapeHtml(String(text));

    if (sources && sources.length > 0) {
      formatted = formatted.replace(/\[(\d+)\]/g, (match, num) => {
        const idx = parseInt(num) - 1;
        if (sources[idx]) {
          return `<sup class="citation"><a href="${sources[idx].url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sources[idx].title)}" style="color:#2563eb;text-decoration:none;font-weight:600">[${num}]</a></sup>`;
        }
        return `<sup class="citation">[${num}]</sup>`;
      });
    } else {
      formatted = formatted.replace(/\[(\d+)\]/g, '<sup class="citation">[$1]</sup>');
    }
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/^\- (.*)/gm, '<li class="ml-4 list-disc">$1</li>');
    formatted = formatted.replace(/(<li.*<\/li>)/gs, '<ul class="my-2">$1</ul>');
    formatted = formatted.replace(/\n/g, '<br />');
    return formatted;
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="flex h-dvh bg-white text-[#1a1a1a] font-['Inter'] selection:bg-black/10 overflow-hidden">
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

  <header class="px-4 md:px-6 py-3 bg-white/80 backdrop-blur-xl border-b border-black/5 flex justify-between items-center z-20">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2.5">
        <div class="w-2.5 h-2.5 rounded-full bg-black"></div>
        <h1 class="text-sm md:text-base font-semibold tracking-tight text-black">
          TechWriter
        </h1>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <button on:click={clearChat} class="text-xs text-[#6b6b6b] hover:text-black hover:bg-black/5 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5" title="Clear">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        Clear
      </button>
      <button on:click={newChat} class="text-xs text-[#6b6b6b] hover:text-black hover:bg-black/5 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5" title="New">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
        New
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
              <div class="flex items-center gap-2 mt-1.5 opacity-0 hover:opacity-100 transition-opacity duration-150">
                <button on:click={() => copyMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-[#999] hover:text-black hover:bg-black/5 transition-all">{copiedMessageIdx === i ? 'Copied' : 'Copy'}</button>
                {#if i === messages.length - 1}
                  <button on:click={regenerate} class="text-[11px] px-2 py-0.5 rounded-md text-[#999] hover:text-black hover:bg-black/5 transition-all">Retry</button>
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
                <span class="text-[10px] text-[#bbb]">{msg.provider}</span>
              </div>
            {/if}
          {:else}
            {#if editingMessageIdx === i}
              <div class="w-full text-left">
                <textarea bind:value={editText} class="w-full bg-[#1a1a22] border border-white/[0.1] rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-[#e4e4e7]" rows="3"></textarea>
                <div class="flex gap-1.5 mt-2">
                  <button on:click={() => saveEdit(i)} disabled={!editText.trim()} class="text-[10px] bg-white text-black px-3 py-1 rounded-lg disabled:opacity-40 transition-all font-medium">Save</button>
                  <button on:click={cancelEdit} class="text-[10px] bg-white/[0.05] text-[#a1a1aa] px-3 py-1 rounded-lg border border-white/[0.06] transition-all">Cancel</button>
                </div>
              </div>
            {:else}
              <div class="bg-[#f5f5f5] rounded-2xl px-4 py-2.5 inline-block text-left">
                <div class="leading-relaxed text-[15px] text-[#1a1a1a]">{msg.content}</div>
              </div>
              <div class="flex items-center gap-2 mt-1 justify-end opacity-0 hover:opacity-100 transition-opacity duration-150">
                <button on:click={() => startEdit(i)} class="text-[11px] px-2 py-0.5 rounded-md text-[#999] hover:text-black hover:bg-black/5 transition-all">Edit</button>
                <button on:click={() => copyMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-[#999] hover:text-black hover:bg-black/5 transition-all">{copiedMessageIdx === i ? 'Copied' : 'Copy'}</button>
              </div>
            {/if}
          {/if}
        </div>
      </div>
      {#if !isStreaming && !splitArtifact}
        {#each artifacts.filter(a => a.messageIdx === i) as { artifact }}
          <div class="flex justify-start w-full">
            <button on:click={() => splitArtifact = { messageIdx: i, artifact }} class="w-full max-w-md text-left px-4 py-2.5 rounded-xl bg-[#f1ede4]/60 hover:bg-[#e8e4db] border border-[#d6d0c4] transition-all group">
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
          Searching web &amp; gathering thoughts...
        </div>
      </div>
    {/if}
  </main>

  <footer class="p-3 md:p-4 bg-white/80 backdrop-blur-xl border-t border-black/5 transition-all">
    <div class="max-w-3xl mx-auto">

      {#if uploadStatus !== 'idle'}
        <div class="mb-2">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border {uploadStatus === 'done' ? 'bg-black/5 border-black/10' : uploadStatus === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-black/[0.02] border-black/5 text-[#666]'}">
            {#if uploadStatus === 'uploading'}<div class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"></div>{/if}
            <span class="text-xs font-medium truncate max-w-[160px]">{uploadedFileName || 'Processing...'}</span>
            {#if ragDegraded}<span class="text-[10px] text-amber-600">&#9889;</span>{/if}
            {#if uploadProgress && uploadStatus === 'uploading'}<span class="text-[10px] font-bold">{uploadProgress.done}/{uploadProgress.total}</span>{/if}
            <button on:click={removeFile} class="p-0.5 rounded-full hover:bg-black/10 transition-all shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 items-center">
        <input type="file" bind:this={fileInput} on:change={handleFileUpload} class="hidden" accept=".txt,.md,.json,.csv" />
        <button on:click={() => fileInput.click()} disabled={isUploading} class="p-2.5 hover:bg-black/[0.03] rounded-xl text-[#999] hover:text-black transition-all disabled:opacity-30 shrink-0" title="Upload">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
        </button>
        <div class="relative flex-1">
          <input bind:value={inputMessage} on:keydown={handleKeydown} disabled={isLoading}
            class="w-full bg-[#f5f5f5] border border-transparent rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black/20 text-[#1a1a1a] placeholder:text-[#999] text-[15px] transition-all"
            placeholder={uploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
          />
        </div>
        {#if isStreaming}
          <button on:click={stopStreaming} class="bg-black/5 hover:bg-black/10 text-black/60 p-2.5 rounded-xl transition-all active:scale-95 shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><rect x="3" y="3" width="14" height="14" rx="2"/></svg></button>
        {:else}
          <button on:click={sendMessage} disabled={isLoading || !inputMessage.trim()} class="bg-black hover:bg-black/80 text-white p-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-30 shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg></button>
        {/if}
      </div>

      <div class="flex justify-between items-center text-[11px] text-[#999] mt-2.5">
        <div class="flex items-center gap-2">
          <div class="flex items-center bg-[#f5f5f5] p-0.5 rounded-lg shrink-0">
            <button on:click={() => { isThinkingMode = false; isLiveMode = false; }} class="px-2.5 py-1 rounded-md transition-all {!isThinkingMode && !isLiveMode ? 'bg-white text-black font-medium shadow-sm' : 'text-[#999] hover:text-black'}">Fast</button>
            <button on:click={() => { isThinkingMode = true; isLiveMode = false; }} class="px-2.5 py-1 rounded-md transition-all {isThinkingMode && !isLiveMode ? 'bg-white text-black font-medium shadow-sm' : 'text-[#999] hover:text-black'}">Brain</button>
            <button on:click={() => { const canUse = enhancedCredits.remaining > 0 && !enhancedCredits.budgetExhausted; if (canUse) { isThinkingMode = false; isLiveMode = !isLiveMode; } }}
              class="px-2.5 py-1 rounded-md transition-all {isLiveMode ? 'bg-black text-white font-medium' : (enhancedCredits.remaining <= 0 || enhancedCredits.budgetExhausted ? 'text-[#ccc] cursor-not-allowed' : 'text-[#999] hover:text-black')}">
              Live {enhancedCredits.remaining <= 0 ? '' : enhancedCredits.remaining}
            </button>
          </div>
        </div>
        <span>AI can make mistakes. Verify important info.</span>
      </div>
    </div>
  </footer>
  </div>

  {#if splitArtifact}
    <div class="hidden md:block w-1.5 bg-[#d6d0c4] hover:bg-indigo-400 cursor-col-resize shrink-0 transition-colors z-20" role="separator"></div>
    <div class="w-full md:w-[50%] min-w-0 md:min-w-[360px] bg-white flex flex-col overflow-hidden shadow-2xl z-10 fixed md:relative inset-0 md:inset-auto animate-in slide-in-from-right duration-200" style="resize: horizontal;">
      <div class="flex items-center justify-between px-4 py-2.5 bg-[#1e1e2e] text-white shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <button on:click={() => splitArtifact = null} class="md:hidden text-white mr-1" title="Back to chat">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span class="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-md bg-purple-600">{splitArtifact.artifact.type}</span>
          <span class="text-xs font-medium text-gray-300 truncate">{splitArtifact.artifact.title || 'Artifact'}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button on:click={() => splitTab = 'code'} class="text-[10px] px-2.5 py-1 rounded-md {splitTab === 'code' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Code</button>
          <button on:click={() => splitTab = 'preview'} class="text-[10px] px-2.5 py-1 rounded-md {splitTab === 'preview' ? 'bg-white/20 text-white font-bold' : 'text-gray-400 hover:text-white'}">Preview</button>
          <button on:click={async () => { try { await navigator.clipboard.writeText(splitArtifact.artifact.code); } catch {} }} class="text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all">Copy</button>
          <button on:click={() => { const b = new Blob([splitArtifact.artifact.code], {type:'text/plain'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download=(splitArtifact.artifact.title||'artifact').replace(/[^a-zA-Z0-9_-]/g,'_'); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }} class="text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all" title="Download">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </button>
          <button on:click={() => splitArtifact = null} class="text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-all" title="Close (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-auto">
        {#if artifactError}
          <div class="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2">
            <div class="text-xs text-red-700 truncate min-w-0">
              <span class="font-bold">Error:</span> {artifactError}
            </div>
            <button on:click={fixArtifactError} class="text-[10px] px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold shrink-0 transition-all">Fix with AI</button>
          </div>
        {/if}
        <ArtifactPanel artifact={splitArtifact.artifact} />
      </div>
    </div>
  {/if}
</div>