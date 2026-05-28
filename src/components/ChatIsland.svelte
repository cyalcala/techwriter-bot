<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { handleFileUpload, searchDocumentChunks, formatRagContext, clearRagState, createDefaultRagState, type RagState } from '../lib/rag-client';
  import { getStoredVectors, updateActivity } from '../lib/rag-db';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData } from '../lib/cleanup';
  import { ArtifactStreamParser, type Artifact } from '../lib/stream-parser';
  import { detectAllArtifacts } from '../lib/artifact-detector';
  import { preloadPopular } from '../lib/renderer-loader';
  import { fixArtifactError } from '../lib/artifact-state';
  import { estimateTokens } from '../lib/token-counter';
  import { clearConversation } from '../lib/session-persist';
  import { createArtifactQueue, type ArtifactEntry } from '../lib/artifact-queue';
  import { extractArtifactTitle } from '../lib/artifact-lifecycle';
  import { createArtifactRepairTarget, planArtifactRepairReplacement, type ArtifactRepairTarget } from '../lib/artifact-repair';
  import { createLiveOutageState, hasVisibleLiveResponse, type LiveOutageState } from '../lib/session-continuity';
  import { reviewDocument, type DocumentFinding, type TerminologyRule } from '../lib/document-review';
  import ChatMessages from './ChatMessages.svelte';
  import ChatInput from './ChatInput.svelte';
  import DocumentToolsPanel from './DocumentToolsPanel.svelte';
  import ArtifactSplitView from './ArtifactSplitView.svelte';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    sources?: { title: string; url: string }[];
    searchTier?: 'none' | 'basic' | 'enhanced';
    empty?: boolean;
    liveResponse?: boolean;
  }

  interface FailoverEvent {
    timestamp: string;
    provider: string;
    reason: string;
    status?: number;
    chatPath?: string;
  }

  interface GraphLookupResult {
    available: boolean;
    context: string;
    nodeCount: number;
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
  let chatPath = $state<string | null>(null);
  let tokenDisplay = $state<{ in: number; graph: number; cached?: boolean } | null>(null);
  let failoverEvents = $state<FailoverEvent[]>([]);
  let liveOutage = $state<LiveOutageState | null>(null);
  let isMobile = $state(false);
  let documentTopics = $state('');
  let toolsOpen = $state(false);
  let toolDocument = $state<{ name: string; text: string } | null>(null);
  let toolFindings = $state<DocumentFinding[]>([]);
  let toolReviewRun = $state(false);
  let toolGraphResult = $state<GraphLookupResult | null>(null);
  let toolGraphLoading = $state(false);
  let toolGraphError = $state('');

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

  const KROKI_SERVER_ONLY = new Set(['d2', 'graphviz', 'plantuml']);
  const renderedHashes = new Set<string>();

  const artifactQueue = createArtifactQueue();
  let activeArtifactEntry = $state<ArtifactEntry | null>(null);
  let artifactError = $state<string | null>(null);
  let pendingArtifactRepair = $state<ArtifactRepairTarget | null>(null);

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
      if (/^\s*(graph|flowchart)\b/im.test(code)) {
        code = code.replace(/^\s*note\s+(?:right\s+of|left\s+of|over)\s+.*$/gim, '');
        const parts = code.split(/\n(?=\s*(graph|flowchart)\b)/i);
        if (parts.length > 1) code = parts[0].trim();
      }
    }

    const cleanArt = { ...art, code };
    const repairTarget = pendingArtifactRepair;
    const codeFingerprint = `${cleanArt.type}:${code.slice(0, 200)}:${code.length}`;
    if (!repairTarget && renderedHashes.has(codeFingerprint)) return;
    renderedHashes.add(codeFingerprint);
    const title = cleanArt.title || extractArtifactTitle(code, cleanArt.type);
    const queueArtifact = { ...cleanArt, title };
    let entry: ArtifactEntry = { messageIdx: msgIdx, artifact: queueArtifact, ts: Date.now() };

    if (repairTarget) {
      const repairPlan = planArtifactRepairReplacement(repairTarget, queueArtifact);
      const updatedRepair = artifactQueue.replace(repairPlan.messageIdx, repairPlan.artifactId, repairPlan.artifact, repairPlan.meta);
      if (updatedRepair) {
        entry = updatedRepair;
        activeArtifactEntry = updatedRepair;
      } else {
        artifactQueue.push(entry);
      }
      pendingArtifactRepair = null;
      artifactError = null;
    } else {
      artifactQueue.push(entry);
    }
    // Only use Kroki for types that have NO client-side renderer
    if (!KROKI_SERVER_ONLY.has(cleanArt.type)) return;
    const pendingId = entry.artifact.id;
    const pendingMessageIdx = entry.messageIdx;

    // One-shot server render — no retry cascade, no auto AI re-prompt
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
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
          artifactQueue.replace(pendingMessageIdx, pendingId, { ...cleanArt, code: data.svg, type: 'svg' as any, title, placement: 'inline' }, { status: 'ready', error: null });
          const updated = artifactQueue.entries.find(e => e.messageIdx === pendingMessageIdx && e.artifact.id === pendingId);
          if (updated && activeArtifactEntry?.artifact.id === pendingId) {
            activeArtifactEntry = updated;
          }
          return;
        }
      }

      // On any error (400 syntax, 502 server, etc.) — store error on entry, don't auto-retry
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.message || errData.error || `Server returned ${res.status}`;
      artifactQueue.replace(pendingMessageIdx, pendingId, { ...cleanArt, title }, { error: errMsg, status: 'error' });
      // Keep the raw diagram code visible — user can click "Fix with AI" manually
    } catch (e) {
      const errMsg = (e as Error).name === 'AbortError' ? 'Render timed out (15s)' : (e as Error).message;
      artifactQueue.replace(pendingMessageIdx, pendingId, { ...cleanArt, title }, { error: errMsg, status: 'error' });
    }
  }

  function fixArtifactErr() {
    const prompt = fixArtifactError(artifactError, activeArtifactEntry ? {
      messageIdx: activeArtifactEntry.messageIdx,
      artifacts: [activeArtifactEntry],
      activeIdx: 0,
    } : null);
    if (prompt && activeArtifactEntry) {
      pendingArtifactRepair = createArtifactRepairTarget(activeArtifactEntry);
      messages = [...messages, { role: 'user', content: prompt }];
      artifactError = null;
      doSend();
    }
  }

  function generateSessionId() {
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
    runStaleCheck();
    setupCleanupCallbacks(sessionId);
    pollCredits();
    preloadPopular();
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'ARTIFACT_ERROR') artifactError = e.data.error;
    });
    isOnline = navigator.onLine;
    window.addEventListener('online', () => { isOnline = true; });
    window.addEventListener('offline', () => { isOnline = false; });
    const checkMobile = () => { isMobile = window.innerWidth < 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
  });

  function clearDocumentToolState() {
    toolsOpen = false;
    toolDocument = null;
    toolFindings = [];
    toolReviewRun = false;
    toolGraphResult = null;
    toolGraphLoading = false;
    toolGraphError = '';
  }

  function runDocumentReview(terminology: TerminologyRule[]) {
    if (!toolDocument) return;
    toolFindings = reviewDocument(toolDocument.text, terminology);
    toolReviewRun = true;
  }

  async function runGraphLookup(term: string) {
    if (!term) return;
    toolGraphLoading = true;
    toolGraphError = '';

    try {
      const response = await fetch('/api/tool-graph-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toolGraphResult = null;
        toolGraphError = String(payload.error || 'Reference lookup is unavailable.');
        return;
      }

      toolGraphResult = {
        available: Boolean(payload.available),
        context: String(payload.context || ''),
        nodeCount: Number(payload.nodeCount || 0),
      };
    } catch {
      toolGraphResult = null;
      toolGraphError = 'Reference lookup is unavailable.';
    } finally {
      toolGraphLoading = false;
    }
  }

  function newChat() {
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    sessionId = generateSessionId();
    messages = [{ role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' }];
    rag = clearRagState();
    clearDocumentToolState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
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
    clearDocumentToolState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
    chatPath = null;
    if (fileInput) fileInput.value = '';
  }

  function removeFile() {
    rag = clearRagState();
    documentTopics = '';
    clearDocumentToolState();
    if (fileInput) fileInput.value = '';
  }

  async function onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    clearDocumentToolState();
    isUploading = true;
    rag.uploadStatus = 'uploading';
    rag.uploadedFileName = file.name;
    const result = await handleFileUpload(file, sessionId, (p) => rag.uploadProgress = p, (s) => rag.uploadStatus = s);
    if (result.sourceText) {
      toolDocument = { name: file.name, text: result.sourceText };
    }
    if (result.success) {
      rag.ragDegraded = result.degraded;
      messages = [...messages, { role: 'assistant', content: result.message }];
      try {
        const vectors2 = await getStoredVectors(sessionId);
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

  function mergeFailoverEvents(events: FailoverEvent[]) {
    if (!events.length) return;
    const merged = [...events, ...failoverEvents];
    const seen = new Set<string>();
    failoverEvents = merged.filter((event) => {
      const key = `${event.timestamp}:${event.provider}:${event.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }

  function captureFailoverHeader(headers: Headers) {
    const raw = headers.get('x-failover-events');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) mergeFailoverEvents(parsed);
    } catch {}
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
  }

  async function doSend() {
    safeAbort();
    liveOutage = null;
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
        body: JSON.stringify({ messages: messagesToSend, intent: isThinkingMode ? 'research' : 'chat-fast', sessionId, liveSearch: isLiveMode }),
        signal: abortController.signal,
      });

      captureFailoverHeader(response.headers);

      if (!response.ok) {
        const errText = await response.text();
        let errorPayload: Record<string, unknown> | null = null;
        try { errorPayload = JSON.parse(errText) as Record<string, unknown>; } catch {}
        const outage = createLiveOutageState(
          errorPayload,
          hasVisibleLiveResponse(messages.map((message, index) => ({
            liveResponse: message.liveResponse,
            content: message.content,
            empty: message.empty,
            hasArtifact: artifactQueue.forMessage(index).length > 0,
          }))),
        );
        if (outage) {
          liveOutage = outage;
          return;
        }
        const errMessage = String(errorPayload?.message || errorPayload?.error || errText);
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

      messages = [...messages, { role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders, searchTier: msgSearchTier, liveResponse: true }];
      msgIdx = messages.length - 1;

      checkpointContent = '';
      checkpointTimer = setInterval(() => {
        if (chatState === 'streaming' && messages[msgIdx]?.content) {
          checkpointContent = messages[msgIdx].content;
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
            // Only Kroki-render types without client-side renderers (already filtered in resolveArtifact)
            if (alreadyResolved.has(fa.title || `${fa.type} Diagram`)) continue;
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

        if (!messages[msgIdx].content && !artifactQueue.entries.some(e => e.messageIdx === msgIdx)) {
          messages = messages.map((m, i) => i === msgIdx ? { ...m, content: '', empty: true, sources: sourcesFromHeaders } : m);
        }
      }

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
      pendingArtifactRepair = null;
      chatState = 'idle';
      isLoading = false;
      isStreaming = false;
      abortController = null;

      if (messageQueue.length > 0) {
        setTimeout(() => {
          if (chatState === 'idle' && messageQueue.length > 0) {
            const next = messageQueue.shift()!;
            messages = [...messages, { role: 'user', content: next.content }];
            doSend();
          }
        }, 100);
      }
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
    {#if liveOutage}
      <div role="status" aria-live="polite" class="bg-amber-50 border-b border-amber-200 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span class="font-semibold">Live AI unavailable.</span>
        {#if liveOutage.hasPriorResponse}
          <span>Your last response remains visible in this open session only.</span>
        {:else}
          <span>No live response is available right now.</span>
        {/if}
        <span class="text-amber-700">Retry in about {liveOutage.retryAfterSeconds}s.</span>
        <button type="button" onclick={regenerate} disabled={isLoading} class="ml-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">Retry</button>
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

    {#if toolsOpen}
      <DocumentToolsPanel
        documentName={toolDocument?.name ?? ''}
        findings={toolFindings}
        hasRun={toolReviewRun}
        onReview={runDocumentReview}
        graphResult={toolGraphResult}
        graphLoading={toolGraphLoading}
        graphError={toolGraphError}
        onLookup={runGraphLookup}
        onClose={() => { toolsOpen = false; }}
      />
    {/if}

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
      {toolsOpen}
      onToggleTools={() => { toolsOpen = !toolsOpen; }}
      {tokenDisplay}
      {chatPath}
      {failoverEvents}
      panelOpen={!!activeArtifactEntry}
      {isMobile}
    />
  </div>

  <ArtifactSplitView
    queue={artifactQueue}
    {isMobile}
    activeEntry={activeArtifactEntry}
    onclose={closeSplit}
    onFixArtifact={(code: string, err: string) => { artifactError = err; fixArtifactErr(); }}
    {artifactError}
  />
</div>
