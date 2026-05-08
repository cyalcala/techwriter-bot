<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { handleFileUpload, searchDocumentChunks, formatRagContext, clearRagState, createDefaultRagState, type RagState } from '../lib/rag-client';
  import { updateActivity } from '../lib/rag-db';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData, persistSessionId, getStoredSessionId } from '../lib/cleanup';
  import { ArtifactStreamParser, type Artifact } from '../lib/stream-parser';
  import { detectAllArtifacts } from '../lib/artifact-detector';
  import { preloadPopular } from '../lib/renderer-loader';
  import { fixArtifactError } from '../lib/artifact-state';
  import { estimateTokens } from '../lib/token-counter';
  import { saveConversation, loadConversation, clearConversation, saveArtifactQueue } from '../lib/session-persist';
  import { createArtifactQueue, type ArtifactEntry } from '../lib/artifact-queue';
  import { extractArtifactTitle, generateArtifactId } from '../lib/artifact-lifecycle';
  import ChatMessages from './ChatMessages.svelte';
  import ChatInput from './ChatInput.svelte';
  import ArtifactSplitView from './ArtifactSplitView.svelte';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    sources?: { title: string; url: string }[];
    searchTier?: 'none' | 'basic' | 'enhanced';
    empty?: boolean;
  }

  let messages = $state<Message[]>([{ role: 'assistant', content: "Hi! I'm Technical Writer. I help with writing, research, diagrams, and code. What can I create for you?" }]);
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
  let abortController: AbortController | null = null;
  let isOnline = $state(true);
  let editingMessageIdx = $state<number | null>(null);
  let editText = $state('');
  let copiedMessageIdx = $state<number | null>(null);
  let keyStatus = $state<{ groq: boolean; gemini: boolean; cerebras: boolean } | null>(null);
  let chatPath = $state<string | null>(null);
  let tokenDisplay = $state<{ in: number; graph: number; cached?: boolean } | null>(null);
  let isMobile = $state(false);
  let documentTopics = $state('');

  type ChatState = 'idle' | 'loading' | 'streaming' | 'aborting';
  let chatState: ChatState = $state('idle');
  let messageQueue: Array<{ content: string; timestamp: number }> = [];
  let checkpointContent = '';
  let checkpointTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer1: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer2: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer3: ReturnType<typeof setTimeout> | null = null;
  let sseDropCount = 0;
  let sseDropWindow = 0;
  const MAX_QUEUE = 3;
  const SSE_MAX_DROPS = 3;
  const SSE_DROP_WINDOW_MS = 60_000;

  const KROKI_RENDERABLE = new Set(['mermaid', 'graphviz', 'd2', 'plantuml', 'vega', 'flowchart']);
  const artifactQueue = createArtifactQueue();
  let activeArtifactEntry = $state<ArtifactEntry | null>(null);
  let artifactError = $state<string | null>(null);

  async function resolveArtifact(art: Artifact, msgIdx: number) {
    let code = art.code;
    if (code.startsWith('```')) {
      const firstNewline = code.indexOf('\n');
      const lastBacktick = code.lastIndexOf('```');
      if (firstNewline !== -1 && lastBacktick > firstNewline) {
        code = code.slice(firstNewline + 1, lastBacktick).trim();
      }
    }
    if (art.type === 'mermaid') {
      code = code.replace(/\/>/g, '/');
      code = code.replace(/\|>/g, '|');
      code = code.replace(/&(?!amp;|lt;|gt;|quot;|#39;|#x27;)/g, '&amp;');
      code = code.replace(/\n{3,}/g, '\n\n');
    }
    if (art.type === 'graphviz') {
      code = code.replace(/\/>/g, '/');
    }
    const stableId = generateArtifactId(art.type, code);
    if (artifactQueue.entries.some(e => e.messageIdx === msgIdx && e.artifact.id === stableId)) return;
    const cleanArt = { ...art, id: stableId, code };
    const title = cleanArt.title || extractArtifactTitle(code, cleanArt.type);
    const entry: ArtifactEntry = {
      messageIdx: msgIdx,
      artifact: { ...cleanArt, title },
      ts: Date.now(),
      status: KROKI_RENDERABLE.has(cleanArt.type) ? 'generating' : 'ready',
    };
    artifactQueue.push(entry);
    if (!KROKI_RENDERABLE.has(cleanArt.type)) return;
    const pendingId = entry.artifact.id;

    async function tryKroki(attempt: number): Promise<{ ok: boolean; error?: string }> {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch('/api/render-artifact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: cleanArt.type, code }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data.svg) {
            const updated = artifactQueue.replace(
              msgIdx,
              pendingId,
              { ...cleanArt, code: data.svg, type: 'svg' as any, title, placement: 'inline' },
              { status: 'ready', error: undefined },
            );
            if (updated && activeArtifactEntry?.artifact.id === pendingId) {
              activeArtifactEntry = updated;
            }
            saveArtifactQueue(sessionId, artifactQueue.entries);
            return { ok: true };
          }
        }
        const data = await res.json().catch(() => null);
        return { ok: false, error: data?.message || data?.error || `Server renderer returned ${res.status}` };
      } catch (e) {
        console.error('[Kroki] Attempt', attempt, 'failed:', (e as Error).message);
        return { ok: false, error: (e as Error).message };
      }
    }

    let result = await tryKroki(1);
    if (!result.ok) {
      await new Promise(r => setTimeout(r, 2000));
      result = await tryKroki(2);
    }
    if (!result.ok) {
      const updated = artifactQueue.replace(
        msgIdx,
        pendingId,
        { ...cleanArt, title, placement: 'inline' },
        { status: 'ready', error: result.error ? `Server renderer unavailable: ${result.error}` : 'Server renderer unavailable; using client preview.' },
      );
      if (updated && activeArtifactEntry?.artifact.id === pendingId) activeArtifactEntry = updated;
    }
  }

  function fixArtifactErr() {
    const prompt = fixArtifactError(artifactError, activeArtifactEntry ? {
      messageIdx: activeArtifactEntry.messageIdx,
      artifacts: [activeArtifactEntry],
      activeIdx: 0,
    } : null);
    if (prompt && activeArtifactEntry) {
      messages = [...messages, { role: 'user', content: prompt }];
      artifactError = null;
      doSend();
    }
  }

  async function checkKeys() {
    try {
      const res = await fetch('/api/chat');
      const data = await res.json();
      keyStatus = { groq: data.keys?.GROQ_API_KEY === true, gemini: data.keys?.GEMINI_API_KEY === true, cerebras: data.keys?.CEREBRAS_API_KEY === true };
    } catch { keyStatus = null; }
  }

  function generateSessionId() {
    const stored = getStoredSessionId();
    if (stored) return stored;
    try { return crypto.randomUUID(); } catch (e) { return Math.random().toString(36).substring(2) + Date.now().toString(36); }
  }

  async function pollCredits() {
    try {
      const res = await fetch('/api/search-credits');
      if (res.ok) {
        const data = await res.json();
        enhancedCredits = { remaining: data.remaining === -1 ? 3 : data.remaining, total: 3, unlimited: data.unlimited || false, budgetExhausted: data.budgetExhausted || false };
      }
    } catch {}
  }

  onMount(() => {
    sessionId = generateSessionId();
    persistSessionId(sessionId);
    const restored = loadConversation(sessionId) as Message[] | null;
    if (restored?.length) messages = restored;
    runStaleCheck();
    setupCleanupCallbacks(sessionId);
    pollCredits();
    checkKeys();
    preloadPopular();
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'ARTIFACT_ERROR') artifactError = e.data.error;
      if (e.data?.source === 'artifact' && e.data?.action === 'error') artifactError = String(e.data.payload || 'Artifact render failed');
      if (e.data?.source === 'artifact' && e.data?.action === 'copy' && typeof e.data.payload === 'string') {
        navigator.clipboard?.writeText(e.data.payload).catch(() => {});
      }
    });
    isOnline = navigator.onLine;
    window.addEventListener('online', () => { isOnline = true; });
    window.addEventListener('offline', () => { isOnline = false; });
    const checkMobile = () => { isMobile = window.innerWidth < 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
  });

  let persistDebounce: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    messages; sessionId;
    if (!sessionId) return;
    if (persistDebounce) clearTimeout(persistDebounce);
    persistDebounce = setTimeout(() => { saveConversation(sessionId, messages); }, 2000);
  });

  function newChat() {
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    sessionId = generateSessionId();
    persistSessionId(sessionId);
    messages = [{ role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' }];
    rag = clearRagState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    isLiveMode = false;
    chatPath = null;
    if (fileInput) fileInput.value = '';
  }

  function clearChat() {
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    messages = [{ role: 'assistant', content: 'Chat cleared. My memory has been wiped. What would you like to work on?' }];
    rag = clearRagState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    chatPath = null;
    if (fileInput) fileInput.value = '';
  }

  function removeFile() { rag = clearRagState(); documentTopics = ''; if (fileInput) fileInput.value = ''; }

  async function onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    isUploading = true;
    rag.uploadStatus = 'uploading';
    rag.uploadedFileName = file.name;
    const result = await handleFileUpload(file, sessionId, (p) => rag.uploadProgress = p, (s) => rag.uploadStatus = s);
    if (result.success) {
      rag.ragDegraded = result.degraded;
      messages = [...messages, { role: 'assistant', content: result.message }];
      try {
        const vectors = await import('../lib/rag-db').then(m => m.getStoredVectors(sessionId));
        if (vectors.length > 0) {
          await fetch('/api/rag-store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, chunks: vectors.map(v => ({ text: v.text, vector: v.vector })) }) });
        }
      } catch {}
      try {
        const vectors2 = await import('../lib/rag-db').then(m => m.getStoredVectors(sessionId));
        if (vectors2.length >= 3) {
          const firstChunks = vectors2.slice(0, 3).map(v => v.text);
          const topicsRes = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: firstChunks.map(t => ({ role: 'user', content: t })), mode: 'topics' }) });
          if (topicsRes.ok) {
            const topicsData = await topicsRes.json();
            if (topicsData.summary) documentTopics = topicsData.summary.replace(/\n+/g, ', ').trim();
          }
        }
      } catch {}
    } else {
      messages = [...messages, { role: 'assistant', content: result.message }];
    }
    isUploading = false;
  }

  async function copyMessage(idx: number) {
    try { await navigator.clipboard.writeText(messages[idx].content); copiedMessageIdx = idx; setTimeout(() => { copiedMessageIdx = null; }, 1500); } catch {}
  }

  function startEdit(idx: number) { editingMessageIdx = idx; editText = messages[idx].content; }
  function cancelEdit() { editingMessageIdx = null; editText = ''; }

  async function saveEdit(idx: number) {
    if (!editText.trim()) return;
    messages = messages.slice(0, idx);
    messages = [...messages, { role: 'user', content: editText.trim() }];
    editingMessageIdx = null; editText = '';
    await doSend();
  }

  async function regenerate() {
    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIdx === -1) return;
    messages = messages.slice(0, messages.length - 1 - lastUserIdx + 1);
    await doSend();
  }

  function safeAbort() {
    if (chatState === 'idle') return;
    chatState = 'aborting';
    abortController?.abort(); abortController = null;
    if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
    if (timeoutTimer1) { clearTimeout(timeoutTimer1); timeoutTimer1 = null; }
    if (timeoutTimer2) { clearTimeout(timeoutTimer2); timeoutTimer2 = null; }
    if (timeoutTimer3) { clearTimeout(timeoutTimer3); timeoutTimer3 = null; }
    isStreaming = false; isLoading = false;
    requestAnimationFrame(() => { chatState = 'idle'; });
  }

  function stopStreaming() { safeAbort(); }

  function isTopicShift(newQuery: string, lastQuery: string): boolean {
    const lastWords = new Set(lastQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const newWords = newQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !lastWords.has(w));
    return newWords.length / Math.max(newQuery.split(/\s+/).length, 1) > 0.7;
  }

  function handleSSEDrop(): boolean {
    const now = Date.now();
    if (now - sseDropWindow > SSE_DROP_WINDOW_MS) { sseDropCount = 0; sseDropWindow = now; }
    sseDropCount++;
    if (sseDropCount >= SSE_MAX_DROPS) {
      messages = [...messages, { role: 'assistant', content: '*Connection unstable. Please wait a moment.*' }];
      chatState = 'idle'; isLoading = false;
      setTimeout(() => { sseDropCount = 0; }, 10_000);
      return false;
    }
    return true;
  }

  async function sendMessage() {
    if (!inputMessage.trim()) return;
    if (chatState !== 'idle') {
      if (messageQueue.length < MAX_QUEUE) {
        messageQueue.push({ content: inputMessage.trim(), timestamp: Date.now() });
        inputMessage = '';
        messages = [...messages, { role: 'assistant', content: `Message queued (${messageQueue.length}/${MAX_QUEUE}). We will process after the current response.` }];
      }
      return;
    }
    messages = [...messages, { role: 'user', content: inputMessage.trim() }];
    inputMessage = '';
    await doSend();
    while (messageQueue.length > 0 && chatState === 'idle') {
      const next = messageQueue.shift()!;
      messages = [...messages, { role: 'user', content: next.content }];
      await doSend();
    }
  }

  async function doSend() {
    safeAbort();
    chatState = 'loading';
    isLoading = true;
    abortController = new AbortController();
    if (messageQueue.length > 0) messageQueue = [];

    let messagesToSend = [...messages];
    let sourcesFromHeaders: { title: string; url: string }[] = [];
    let msgSearchTier: 'none' | 'basic' | 'enhanced' = 'none';

    const lastUserMsgQ = [...messagesToSend].reverse().find((m: any) => m.role === 'user');
    const prevUserMsgQ = [...messagesToSend].reverse().slice(1).find((m: any) => m.role === 'user');
    if (lastUserMsgQ && prevUserMsgQ && isTopicShift(lastUserMsgQ.content, prevUserMsgQ.content)) {
      messagesToSend = [messagesToSend[0], ...messagesToSend.slice(-2)];
    }

    const idempotencyKey = crypto.randomUUID();
    const totalEst = messagesToSend.reduce((s, m) => s + estimateTokens(m.content || ''), 0);

    if (totalEst > 5000) {
      messages = [...messages, { role: 'assistant', content: 'This conversation is getting long. Consider starting a new chat for optimal performance.' }];
      const summaryMsg = messagesToSend.length > 8 ? await (async () => {
        try { const res = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: messagesToSend.slice(1, -8) }) }); if (res.ok) { const d = await res.json(); return d.summary || ''; } } catch {} return '';
      })() : '';
      messagesToSend = summaryMsg ? [messagesToSend[0], { role: 'system', content: `Previous conversation summary: ${summaryMsg}` }, ...messagesToSend.slice(-8)] : [messagesToSend[0], ...messagesToSend.slice(-4)];
    } else if (totalEst > 3000) {
      const oldest = messagesToSend.slice(1, -3);
      if (oldest.length > 0) {
        try {
          const res = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: oldest }) });
          if (res.ok) { const data = await res.json(); if (data.summary) { messagesToSend = [messagesToSend[0], { role: 'system', content: `Previous conversation summary: ${data.summary}` }, ...messagesToSend.slice(-3)]; } }
        } catch {}
      }
    }

    let msgIdx = -1;
    try {
      if (documentTopics) {
        messagesToSend = [{ role: 'system', content: `DOCUMENT CONTEXT — Key topics: ${documentTopics}` }, ...messagesToSend];
      }

      const hasDocument = rag.uploadStatus === 'done';
      if (hasDocument) {
        const lastUserMsg = [...messagesToSend].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) {
          const { chunks, embedFailed } = await searchDocumentChunks(sessionId, lastUserMsg.content);
          if (embedFailed) rag.ragDegraded = true;
          if (chunks.length > 0) {
            const ctx = formatRagContext(chunks);
            if (ctx) messagesToSend = [{ role: 'system', content: `Use these document key points. Cite as [Point 1], [Point 2], etc.\n\n${ctx}` }, ...messagesToSend];
          }
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend, intent: isThinkingMode ? 'research' : 'chat-fast', sessionId, liveSearch: isLiveMode, hasDocument, idempotencyKey }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMessage = errText;
        try { errMessage = JSON.parse(errText).message || JSON.parse(errText).error || errText; } catch {}
        throw new Error(errMessage);
      }

      const providerName = response.headers.get('x-provider') || 'AI';
      const sourcesRaw = response.headers.get('x-sources');
      if (sourcesRaw) { try { sourcesFromHeaders = JSON.parse(sourcesRaw); } catch {} }
      const responseSearchTier = response.headers.get('x-search-tier') as 'basic' | 'enhanced' | 'none' | null;
      if (responseSearchTier) msgSearchTier = responseSearchTier;
      const responseSearchRemaining = response.headers.get('x-search-remaining');
      if (responseSearchRemaining != null) {
        const remaining = responseSearchRemaining === 'unlimited' ? -1 : parseInt(responseSearchRemaining, 10);
        if (!isNaN(remaining)) enhancedCredits = { ...enhancedCredits, remaining: remaining === -1 ? 3 : remaining };
      }
      const pathFromServer = response.headers.get('x-chat-path');
      if (pathFromServer) chatPath = pathFromServer;
      const tokenUsageHeader = response.headers.get('x-token-usage');
      if (tokenUsageHeader) { try { tokenDisplay = JSON.parse(tokenUsageHeader); } catch {} } else { tokenDisplay = null; }
      if (response.headers.get('x-cached') === 'true' && tokenDisplay) tokenDisplay.cached = true;

      isStreaming = true;
      chatState = 'streaming';
      const stream = response.body;
      if (!stream) throw new Error('No response stream received');
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      messages = [...messages, { role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders, searchTier: msgSearchTier }];
      msgIdx = messages.length - 1;

      checkpointContent = '';
      checkpointTimer = setInterval(() => {
        if (chatState === 'streaming' && messages[msgIdx]?.content) {
          checkpointContent = messages[msgIdx].content;
          saveConversation(sessionId, messages);
        }
      }, 500);

      timeoutTimer1 = setTimeout(() => {
        if (chatState === 'loading' || chatState === 'streaming')
          messages[msgIdx] = { ...messages[msgIdx], content: (checkpointContent || messages[msgIdx].content) + '\n\n*Still thinking...*' };
      }, 10_000);
      timeoutTimer2 = setTimeout(() => {
        if (chatState === 'loading' || chatState === 'streaming')
          messages[msgIdx] = { ...messages[msgIdx], content: (checkpointContent || messages[msgIdx].content).replace('*Still thinking...*', '') + '\n\n*Taking longer than usual. Trying backup provider...*' };
      }, 20_000);
      timeoutTimer3 = setTimeout(() => {
        if (chatState === 'loading' || chatState === 'streaming') {
          messages[msgIdx] = { ...messages[msgIdx], content: (checkpointContent || messages[msgIdx].content) + '\n\n*Response timed out. Retrying with fallback...*' };
          const saved = msgIdx;
          safeAbort();
          requestAnimationFrame(() => { messages = [...messages.slice(0, saved)]; doSend(); });
        }
      }, 30_000);

      const batcher = new TokenBatcher((batch) => { messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + batch }; });

      const artifactParser = new ArtifactStreamParser(
        (artifact) => { resolveArtifact(artifact, msgIdx); },
        (text) => { batcher.push(text); },
      );

      let buffer = '';
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const idleTimeout = chatPath === 'fast' ? 15_000 : 30_000;
      const resetIdleTimer = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => { reader.cancel().catch(() => {}); }, idleTimeout); };
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
              if (json.error) { artifactParser.feed(`\n\nError: ${json.error.message || JSON.stringify(json.error)}`); continue; }
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.response || json.content || '';
              if (content) artifactParser.feed(content);
            } catch (e) {
              if (rawData && !rawData.includes('{')) artifactParser.feed(rawData);
            }
          }
        }
        if (buffer.trim().startsWith('data:')) {
          const rawData = buffer.slice(buffer.indexOf(':') + 1).trim();
          if (rawData !== '[DONE]') {
            try { const json = JSON.parse(rawData); const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.response || json.content || ''; if (content) artifactParser.feed(content); } catch {}
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        artifactParser.flush();
        batcher.destroy();
      }

      {
        const existing = artifactQueue.forMessage(msgIdx);
        const alreadyResolved = new Set(existing.filter(e => e.artifact.type === 'svg').map(e => e.artifact.title));
        if (messages[msgIdx].content) {
          const result = detectAllArtifacts(messages[msgIdx].content, []);
          const resolvePromises: Promise<void>[] = [];
          for (const fa of result.artifacts) {
            if (!fa.type || !fa.code) continue;
            if (KROKI_RENDERABLE.has(fa.type) && alreadyResolved.has(fa.title || `${fa.type} Diagram`)) continue;
            resolvePromises.push((async () => { await resolveArtifact(fa, msgIdx); })());
          }
          await Promise.all(resolvePromises);
          messages = messages.map((m, i) => i === msgIdx ? { ...m, content: result.cleanText } : m);
        }

        const msgArtifacts = artifactQueue.forMessage(msgIdx);
        if (msgArtifacts.length > 0) {
          activeArtifactEntry = msgArtifacts[0];
        }

        await new Promise<void>(r => requestAnimationFrame(() => r()));

        const hasArtifacts = artifactQueue.entries.some(e => e.messageIdx === msgIdx);
        if (!messages[msgIdx].content && !hasArtifacts) {
          messages = messages.map((m, i) => i === msgIdx ? { ...m, content: '', empty: true, sources: sourcesFromHeaders } : m);
        }
      }

      saveArtifactQueue(sessionId, artifactQueue.entries);
      pollCredits();
      if (enhancedCredits.remaining <= 0) isLiveMode = false;
      await updateActivity(sessionId);
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      if (handleSSEDrop()) {
        console.error('[Chat]', error);
        if (checkpointContent && !abortController?.signal.aborted) {
          messages[msgIdx] = { ...messages[msgIdx], content: checkpointContent + '\n\n*[Connection interrupted. Send again to continue.]*' };
        } else {
          messages = [...messages, { role: 'assistant', content: `Connection Error: ${error.message}` }];
        }
      }
    } finally {
      if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
      if (timeoutTimer1) { clearTimeout(timeoutTimer1); timeoutTimer1 = null; }
      if (timeoutTimer2) { clearTimeout(timeoutTimer2); timeoutTimer2 = null; }
      if (timeoutTimer3) { clearTimeout(timeoutTimer3); timeoutTimer3 = null; }
      chatState = 'idle';
      isLoading = false;
      isStreaming = false;
      abortController = null;
    }
  }

  function handleChipClick(entry: ArtifactEntry) {
    activeArtifactEntry = entry;
  }

  function closeSplit() {
    activeArtifactEntry = null;
    artifactError = null;
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { closeSplit(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); newChat(); }
  }

  function setMode(mode: 'fast' | 'brain' | 'live') {
    if (mode === 'fast') { isThinkingMode = false; isLiveMode = false; }
    else if (mode === 'brain') { isThinkingMode = true; isLiveMode = false; }
    else { const can = enhancedCredits.remaining > 0 && !enhancedCredits.budgetExhausted; if (can) { isThinkingMode = false; isLiveMode = !isLiveMode; } }
  }

  function getCurrentMode(): 'fast' | 'brain' | 'live' {
    if (isLiveMode) return 'live';
    if (isThinkingMode) return 'brain';
    return 'fast';
  }

  let chatContainerEl: HTMLElement;
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="flex h-dvh bg-[#faf7f2] text-stone-800 font-['Inter'] selection:bg-amber-200/50 overflow-hidden">
  <div class="flex flex-col flex-1 min-w-0 transition-all duration-300">
    {#if !isOnline}
      <div class="bg-amber-600 text-white text-center text-xs py-1.5 font-medium tracking-wide">You're offline. Reconnecting...</div>
    {/if}
    {#if keyStatus && (!keyStatus.groq || !keyStatus.gemini || !keyStatus.cerebras)}
      <div class="bg-red-600/80 text-white text-center text-xs py-1.5 font-medium flex items-center justify-center gap-2"><span>Keys missing</span><span class="opacity-70">(using fallback)</span></div>
    {/if}

    <header class="px-3 md:px-6 py-2.5 bg-[#faf7f2]/90 backdrop-blur-xl border-b border-stone-200/60 flex justify-between items-center z-20">
      <div class="flex items-center gap-2 md:gap-3 min-w-0">
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-600 animate-pulse shadow-[0_0_6px_rgba(22,163,74,0.4)]"></div>
          <h1 class="text-xs md:text-sm font-semibold tracking-tight text-stone-800 whitespace-nowrap">Technical Writer</h1>
        </div>
        <span class="text-stone-300 hidden sm:inline">/</span>
        <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" rel="noopener" class="hidden sm:flex items-center gap-1 text-[10px] md:text-[11px] text-stone-400 hover:text-stone-600 transition-colors font-medium">
          <span>Made with</span><span class="text-red-400 text-[10px]">&#10084;&#65039;</span><span>by</span><span class="border-b border-stone-300/50 hover:border-stone-400 transition-all">Cy Alcala</span>
        </a>
        <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" rel="noopener" class="sm:hidden flex items-center gap-0.5 text-[10px] text-stone-400 font-medium shrink-0">
          <span class="text-red-400 text-[9px]">&#10084;</span><span class="border-b border-stone-300/50">Cy Alcala</span>
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
    </style>

    <ChatMessages
      messages={messages}
      queue={artifactQueue}
      isStreaming={isStreaming}
      isLoading={isLoading}
      activeMessageIdx={activeArtifactEntry?.messageIdx ?? null}
      onChipClick={handleChipClick}
      onCopyMessage={copyMessage}
      onRetryMessage={regenerate}
      onEditMessage={startEdit}
      {editingMessageIdx}
      {editText}
      onEditTextChange={(v: string) => { editText = v; }}
      onSaveEdit={saveEdit}
      onCancelEdit={cancelEdit}
      {copiedMessageIdx}
      {chatPath}
    />

    <input type="file" bind:this={fileInput} onchange={onFileSelected} class="hidden" accept=".txt,.md,.json,.csv" />

    <ChatInput
      disabled={isLoading}
      {isStreaming}
      {inputMessage}
      onInputChange={(v: string) => { inputMessage = v; }}
      onSend={sendMessage}
      onStop={stopStreaming}
      mode={getCurrentMode()}
      onModeChange={setMode}
      {enhancedCredits}
      onFileClick={() => fileInput.click()}
      {isUploading}
      ragUploadedFileName={rag.uploadedFileName}
      ragUploadStatus={rag.uploadStatus}
      ragDegraded={rag.ragDegraded}
      ragUploadProgress={rag.uploadProgress}
      onRemoveFile={removeFile}
      {tokenDisplay}
      {chatPath}
      panelOpen={!!activeArtifactEntry}
      {isMobile}
    />
  </div>

  <ArtifactSplitView
    queue={artifactQueue}
    {isMobile}
    activeEntry={activeArtifactEntry}
    onclose={closeSplit}
    onselect={handleChipClick}
    onFixArtifact={(code: string, err: string) => { artifactError = err; fixArtifactErr(); }}
    {artifactError}
  />
</div>
