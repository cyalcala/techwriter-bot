<script lang="ts">
  import { onMount } from 'svelte';
  import { TokenBatcher } from '../lib/token-batcher';
  import { handleFileUpload, searchDocumentChunks, formatRagContext, createRagRetrievalMessage, clearRagState, createDefaultRagState, type RagState } from '../lib/rag-client';
  import { clearSessionVectors, deleteDocumentVectors, getStoredVectors, updateActivity } from '../lib/rag-db';
  import { setupCleanupCallbacks, runStaleCheck, clearAllData } from '../lib/cleanup';
  import { ArtifactStreamParser, type Artifact } from '../lib/stream-parser';
  import { detectAllArtifacts } from '../lib/artifact-detector';
  import { preloadPopular } from '../lib/renderer-loader';
  import { fixArtifactError } from '../lib/artifact-state';
  import { estimateTokens } from '../lib/token-counter';
  import { clearConversation } from '../lib/session-persist';
  import { createArtifactQueue, type ArtifactEntry } from '../lib/artifact-queue';
  import { extractArtifactTitle } from '../lib/artifact-lifecycle';
  import { createArtifactRegenerationPrompt, createArtifactRepairTarget, planArtifactRepairReplacement, type ArtifactRepairTarget } from '../lib/artifact-repair';
  import { createLiveOutageState, hasVisibleLiveResponse, type LiveOutageState } from '../lib/session-continuity';
  import { createSessionExport, parseSessionImport, sessionExportFilename } from '../lib/session-transfer';
  import { createChatMarkdownExport, chatMarkdownExportFilename } from '../lib/chat-markdown-export';
  import {
    archiveConversation,
    createConversationSnapshot,
    deleteConversation,
    listVisibleConversations,
    renameConversation,
    upsertConversationSnapshot,
    type ConversationSnapshot,
  } from '../lib/conversation-session';
  import { reviewDocument, type DocumentFinding, type TerminologyRule } from '../lib/document-review';
  import ChatMessages from './ChatMessages.svelte';
  import ChatInput from './ChatInput.svelte';
  import DocumentToolsPanel from './DocumentToolsPanel.svelte';
  import ArtifactSplitView from './ArtifactSplitView.svelte';

  interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
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

  interface DocumentSource {
    name: string;
    text: string;
  }

  interface Props {
    personaName?: string;
    suggestedPrompts?: string[];
  }

  const DEFAULT_PERSONA_NAME = 'Technical Writer';
  const DEFAULT_SUGGESTED_PROMPTS = [
    'Draft release notes for a recent change',
    'Review this documentation for clarity',
    'Create a diagram for a technical workflow',
  ];

  let {
    personaName = DEFAULT_PERSONA_NAME,
    suggestedPrompts = DEFAULT_SUGGESTED_PROMPTS,
  }: Props = $props();

  function cleanPersonaName(name?: string): string {
    return (name || '').trim() || DEFAULT_PERSONA_NAME;
  }

  function personaGreeting(name: string): string {
    return `Hi! I'm ${name}. I help with writing, research, diagrams, and code. What can I create for you?`;
  }

  function createChatMessage(message: Message): Message {
    return { createdAt: new Date().toISOString(), ...message };
  }

  const visiblePersonaName = $derived(cleanPersonaName(personaName));
  const visibleSuggestedPrompts = $derived(
    (Array.isArray(suggestedPrompts) ? suggestedPrompts : [])
      .map((prompt) => prompt.trim())
      .filter(Boolean)
      .slice(0, 3),
  );

  let messages = $state<Message[]>([createChatMessage({ role: 'assistant', content: personaGreeting(visiblePersonaName) })]);
  let inputMessage = $state('');
  let isLoading = $state(false);
  let isStreaming = $state(false);
  const showSuggestedPrompts = $derived(
    visibleSuggestedPrompts.length > 0
      && messages.length === 1
      && messages[0]?.role === 'assistant'
      && !isLoading
      && !isStreaming,
  );
  let sessionId = $state('');
  let conversationId = $state('');
  let conversationRecords = $state<ConversationSnapshot[]>([]);
  let conversationHistoryOpen = $state(false);
  let renamingConversationId = $state<string | null>(null);
  let conversationRenameValue = $state('');
  const visibleConversations = $derived(listVisibleConversations(conversationRecords));
  let isUploading = $state(false);
  let rag = $state<RagState>(createDefaultRagState());
  let ragMetadataOnly = $state(false);
  let fileInput: HTMLInputElement;
  let sessionImportInput: HTMLInputElement;
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
  let documentSources = $state<Record<string, DocumentSource>>({});
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
  const STREAM_SLOW_SWITCH_MS = 30_000;
  const STREAM_IDLE_TIMEOUT_FAST_MS = 15_000;
  const STREAM_IDLE_TIMEOUT_DEFAULT_MS = 30_000;
  const STREAM_SLOW_SWITCH_MESSAGE = '*Provider slow, switching...*';

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
      messages = [...messages, createChatMessage({ role: 'user', content: prompt })];
      artifactError = null;
      doSend();
    }
  }

  function generateSessionId() {
    try { return crypto.randomUUID(); } catch (e) { return Math.random().toString(36).substring(2) + Date.now().toString(36); }
  }

  function generateConversationId() {
    return `conversation_${generateSessionId()}`;
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
    conversationId = generateConversationId();
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

  function hasActiveConversationContent() {
    return messages.some((message) => message.role === 'user' && message.content.trim())
      || messages.some((message, index) => index > 0 && message.role === 'assistant' && message.content.trim())
      || artifactQueue.entries.length > 0
      || rag.documents.length > 0;
  }

  function saveActiveConversationSnapshot() {
    if (!conversationId || !sessionId || !hasActiveConversationContent()) return;

    const existingConversation = conversationRecords.find((conversation) => conversation.id === conversationId);
    const snapshot = createConversationSnapshot({
      id: conversationId,
      sessionId,
      messages,
      artifacts: artifactQueue.entries,
      documents: rag.documents,
      chatPath,
      title: existingConversation?.title,
      createdAt: existingConversation?.createdAt,
      archived: existingConversation?.archived,
    });
    conversationRecords = upsertConversationSnapshot(conversationRecords, snapshot);
  }

  function toggleConversationHistory() {
    saveActiveConversationSnapshot();
    conversationHistoryOpen = !conversationHistoryOpen;
  }

  function restoreConversation(conversation: ConversationSnapshot) {
    if (conversation.id === conversationId) {
      conversationHistoryOpen = false;
      return;
    }

    saveActiveConversationSnapshot();
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    conversationId = conversation.id;
    sessionId = conversation.sessionId || generateSessionId();
    messages = conversation.messages.map(createChatMessage);
    rag = {
      ...clearRagState(),
      uploadStatus: conversation.documents.length > 0 ? 'done' : 'idle',
      uploadedFileName: conversation.documents.at(-1)?.filename ?? '',
      documents: conversation.documents,
    };
    ragMetadataOnly = conversation.documents.length > 0;
    documentSources = {};
    clearDocumentToolState();
    artifactQueue.clear();
    for (const entry of conversation.artifacts) {
      artifactQueue.push(entry);
    }
    activeArtifactEntry = artifactQueue.entries[0] ?? null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
    isLiveMode = false;
    chatPath = conversation.chatPath ?? null;
    conversationHistoryOpen = false;
    if (fileInput) fileInput.value = '';
  }

  function beginConversationRename(conversation: ConversationSnapshot) {
    renamingConversationId = conversation.id;
    conversationRenameValue = conversation.title;
  }

  function commitConversationRename(conversation: ConversationSnapshot) {
    conversationRecords = renameConversation(conversationRecords, conversation.id, conversationRenameValue);
    renamingConversationId = null;
    conversationRenameValue = '';
  }

  function cancelConversationRename() {
    renamingConversationId = null;
    conversationRenameValue = '';
  }

  function archiveConversationRecord(conversation: ConversationSnapshot) {
    if (conversation.id === conversationId) return;
    conversationRecords = archiveConversation(conversationRecords, conversation.id, true);
  }

  function deleteConversationRecord(conversation: ConversationSnapshot) {
    if (conversation.id === conversationId) return;
    conversationRecords = deleteConversation(conversationRecords, conversation.id);
  }

  function rememberDocumentSource(documentId: string, source: DocumentSource) {
    documentSources = { ...documentSources, [documentId]: source };
  }

  function forgetDocumentSource(documentId: string) {
    const next = { ...documentSources };
    delete next[documentId];
    documentSources = next;
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
    saveActiveConversationSnapshot();
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    sessionId = generateSessionId();
    conversationId = generateConversationId();
    messages = [createChatMessage({ role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' })];
    rag = clearRagState();
    ragMetadataOnly = false;
    documentSources = {};
    clearDocumentToolState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
    isLiveMode = false;
    chatPath = null;
    conversationHistoryOpen = false;
    if (fileInput) fileInput.value = '';
  }

  function clearChat() {
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    conversationId = generateConversationId();
    messages = [createChatMessage({ role: 'assistant', content: 'Chat cleared. My memory has been wiped. What would you like to work on?' })];
    rag = clearRagState();
    ragMetadataOnly = false;
    documentSources = {};
    clearDocumentToolState();
    artifactQueue.clear();
    activeArtifactEntry = null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
    isLiveMode = false;
    chatPath = null;
    conversationHistoryOpen = false;
    if (fileInput) fileInput.value = '';
  }

  function removeFile() {
    clearSessionVectors(sessionId).catch(() => {});
    rag = clearRagState();
    ragMetadataOnly = false;
    documentSources = {};
    documentTopics = '';
    clearDocumentToolState();
    if (fileInput) fileInput.value = '';
  }

  async function removeDocument(documentId: string) {
    await deleteDocumentVectors(sessionId, documentId);
    forgetDocumentSource(documentId);
    const remaining = rag.documents.filter((document) => document.id !== documentId);
    rag.documents = remaining;
    ragMetadataOnly = ragMetadataOnly && remaining.length > 0;

    if (remaining.length === 0) {
      rag = clearRagState();
      ragMetadataOnly = false;
      documentTopics = '';
      clearDocumentToolState();
      if (fileInput) fileInput.value = '';
      return;
    }

    rag.uploadStatus = 'done';
    rag.uploadedFileName = remaining[remaining.length - 1].filename;
    if (toolDocument && !remaining.some((document) => document.filename === toolDocument?.name)) {
      clearDocumentToolState();
    }
  }

  async function processFileUpload(file: File) {
    clearDocumentToolState();
    rag.uploadStatus = 'uploading';
    rag.uploadedFileName = file.name;
    const result = await handleFileUpload(file, sessionId, (p) => rag.uploadProgress = p, (s) => rag.uploadStatus = s);
    if (result.sourceText) {
      toolDocument = { name: file.name, text: result.sourceText };
    }
    if (result.success) {
      ragMetadataOnly = false;
      rag.ragDegraded = result.degraded;
      if (result.document) {
        rag.documents = [...rag.documents, result.document];
        if (result.sourceText) rememberDocumentSource(result.document.id, { name: file.name, text: result.sourceText });
      }
      messages = [...messages, createChatMessage({ role: 'assistant', content: result.message })];
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
      messages = [...messages, createChatMessage({ role: 'assistant', content: result.message })];
    }
  }

  async function onFileSelected(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files || []);
    if (files.length === 0) return;
    isUploading = true;
    for (const file of files) {
      await processFileUpload(file);
    }
    isUploading = false;
  }

  function exportSession() {
    const payload = createSessionExport({
      messages,
      artifacts: artifactQueue.entries,
      documents: rag.documents,
      chatPath,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sessionExportFilename(new Date(payload.exportedAt));
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    const exportedAt = new Date();
    const markdown = createChatMarkdownExport({
      personaName: visiblePersonaName,
      messages,
      artifacts: artifactQueue.entries,
      documents: rag.documents,
      chatPath,
      now: exportedAt,
    });
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = chatMarkdownExportFilename(exportedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onSessionImportSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    let raw = '';
    try {
      raw = await file.text();
    } catch {
      messages = [...messages, createChatMessage({ role: 'assistant', content: 'Session import failed: I could not read that file.' })];
      input.value = '';
      return;
    }

    const parsed = parseSessionImport(raw);
    if (!parsed.ok) {
      messages = [...messages, createChatMessage({ role: 'assistant', content: `Session import failed: ${parsed.message}` })];
      input.value = '';
      return;
    }

    saveActiveConversationSnapshot();
    safeAbort();
    clearConversation();
    documentTopics = '';
    clearAllData(sessionId);
    sessionId = generateSessionId();
    conversationId = generateConversationId();
    messages = parsed.payload.messages.map(createChatMessage);
    rag = {
      ...clearRagState(),
      uploadStatus: parsed.payload.documents.length > 0 ? 'done' : 'idle',
      uploadedFileName: parsed.payload.documents.at(-1)?.filename ?? '',
      documents: parsed.payload.documents,
    };
    ragMetadataOnly = parsed.payload.documents.length > 0;
    documentSources = {};
    clearDocumentToolState();
    artifactQueue.clear();
    for (const entry of parsed.payload.artifacts) {
      artifactQueue.push(entry);
    }
    activeArtifactEntry = artifactQueue.entries[0] ?? null;
    artifactError = null;
    pendingArtifactRepair = null;
    liveOutage = null;
    isLiveMode = false;
    chatPath = parsed.payload.chatPath ?? null;
    conversationHistoryOpen = false;
    if (fileInput) fileInput.value = '';
    input.value = '';
  }

  async function reembedDocument(documentId: string) {
    const source = documentSources[documentId];
    if (!source) {
      messages = [...messages, createChatMessage({ role: 'assistant', content: 'Re-embed is unavailable because the document source is no longer in this open session.' })];
      return;
    }

    isUploading = true;
    try {
      await deleteDocumentVectors(sessionId, documentId);
      forgetDocumentSource(documentId);
      rag.documents = rag.documents.filter((document) => document.id !== documentId);
      ragMetadataOnly = false;
      const file = new File([source.text], source.name, { type: 'text/plain' });
      await processFileUpload(file);
    } finally {
      isUploading = false;
    }
  }

  async function copyMessage(idx: number) {
    try { await navigator.clipboard.writeText(messages[idx].content); copiedMessageIdx = idx; setTimeout(() => { copiedMessageIdx = null; }, 1500); } catch {}
  }

  function startEdit(idx: number) { editingMessageIdx = idx; editText = messages[idx].content; }
  function cancelEdit() { editingMessageIdx = null; editText = ''; }

  async function saveEdit(idx: number) {
    if (!editText.trim()) return;
    messages = messages.slice(0, idx);
    messages = [...messages, createChatMessage({ role: 'user', content: editText.trim() })];
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
      messages = [...messages, createChatMessage({ role: 'assistant', content: '*Connection unstable. Please wait a moment.*' })];
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
        messages = [...messages, createChatMessage({ role: 'assistant', content: `Message queued (${messageQueue.length}/${MAX_QUEUE}). We will process after the current response.` })];
      }
      return;
    }
    messages = [...messages, createChatMessage({ role: 'user', content: inputMessage.trim() })];
    inputMessage = '';
    await doSend();
  }

  async function sendSuggestedPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;
    inputMessage = trimmed;
    await sendMessage();
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
      messages = [...messages, createChatMessage({ role: 'assistant', content: 'This conversation is getting long. Consider starting a new chat for optimal performance.' })];
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

      const hasDocument = rag.documents.length > 0 || rag.uploadStatus === 'done';
      if (hasDocument) {
        const lastUserMsg = [...messagesToSend].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) {
          const { chunks, embedFailed } = await searchDocumentChunks(sessionId, lastUserMsg.content);
          if (embedFailed) rag.ragDegraded = true;
          if (chunks.length > 0) {
            const ctx = formatRagContext(chunks);
            if (ctx) messagesToSend = [{ role: 'system', content: `Use these uploaded document excerpts. Cite every document-backed claim with [Doc: filename, line n]. If the answer is not supported by these excerpts, say "I don't have enough context in the uploaded document to answer that."\n\n${ctx}` }, ...messagesToSend];
          } else {
            messages = [...messages, createChatMessage({ role: 'assistant', content: createRagRetrievalMessage({ embedFailed }) })];
            return;
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

      messages = [...messages, createChatMessage({ role: 'assistant', content: '', provider: providerName, sources: sourcesFromHeaders, searchTier: msgSearchTier, liveResponse: true })];
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
          messages[msgIdx] = { ...messages[msgIdx], content: (checkpointContent || messages[msgIdx].content) + `\n\n${STREAM_SLOW_SWITCH_MESSAGE}` };
          const saved = msgIdx;
          safeAbort();
          requestAnimationFrame(() => { messages = [...messages.slice(0, saved)]; doSend(); });
        }
      }, STREAM_SLOW_SWITCH_MS);

      const batcher = new TokenBatcher((batch) => { messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + batch }; });

      const artifactParser = new ArtifactStreamParser(
        (artifact) => { resolveArtifact(artifact, msgIdx); },
        (text) => { batcher.push(text); },
      );

      let buffer = '';
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const idleTimeout = chatPath === 'fast' ? STREAM_IDLE_TIMEOUT_FAST_MS : STREAM_IDLE_TIMEOUT_DEFAULT_MS;
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
          messages = [...messages, createChatMessage({ role: 'assistant', content: `Connection Error: ${error.message}` })];
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
            messages = [...messages, createChatMessage({ role: 'user', content: next.content })];
            doSend();
          }
        }, 100);
      }
    }
  }

  function handleChipClick(entry: ArtifactEntry) {
    activeArtifactEntry = entry;
    requestAnimationFrame(() => {
      document.getElementById(`msg-${entry.messageIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function regenerateArtifactEntry(entry: ArtifactEntry) {
    if (isLoading) return;
    const updatedEntry = artifactQueue.replace(entry.messageIdx, entry.artifact.id, entry.artifact, { status: 'updating', error: null });
    activeArtifactEntry = updatedEntry || entry;
    pendingArtifactRepair = createArtifactRepairTarget(entry);
    artifactError = null;
    messages = [...messages, createChatMessage({ role: 'user', content: createArtifactRegenerationPrompt(entry) })];
    doSend();
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
          <h1 class="text-xs md:text-sm font-semibold tracking-tight text-stone-800 whitespace-nowrap">{visiblePersonaName}</h1>
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
        <div class="relative">
          <button type="button" onclick={toggleConversationHistory} aria-expanded={conversationHistoryOpen} aria-controls="conversation-history-panel" class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="History">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-3.18-6.87M21 3v6h-6"/></svg>
            <span class="hidden sm:inline">History</span>
            {#if visibleConversations.length > 0}
              <span class="min-w-4 rounded-full bg-stone-200 px-1 text-center text-[9px] leading-4 text-stone-500">{visibleConversations.length}</span>
            {/if}
          </button>
          {#if conversationHistoryOpen}
            <div id="conversation-history-panel" class="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-stone-200 bg-white text-stone-700 shadow-xl">
              <div class="border-b border-stone-100 px-3 py-2 text-[11px] font-semibold uppercase text-stone-400">Session History</div>
              {#if visibleConversations.length === 0}
                <div class="px-3 py-3 text-xs text-stone-500">No saved conversations in this open session</div>
              {:else}
                <div class="max-h-72 overflow-y-auto py-1">
                  {#each visibleConversations as conversation}
                    <div class="flex items-center gap-1 px-2 py-1 text-xs transition-colors hover:bg-stone-50" aria-current={conversation.id === conversationId ? 'true' : undefined}>
                      {#if renamingConversationId === conversation.id}
                        <form
                          class="flex min-w-0 flex-1 items-center gap-1"
                          onsubmit={(event) => {
                            event.preventDefault();
                            commitConversationRename(conversation);
                          }}
                        >
                          <input bind:value={conversationRenameValue} class="min-w-0 flex-1 rounded border border-stone-200 px-2 py-1 text-xs text-stone-700 outline-none focus:border-amber-300" aria-label="Conversation title" />
                          <button type="submit" aria-label="Save conversation title" class="rounded p-1 text-stone-400 hover:bg-amber-50 hover:text-amber-700">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.2a1 1 0 01-1.414-.006L4.296 10.16a1 1 0 011.414-1.414l3.04 3.04 6.546-6.5a1 1 0 011.408.004z" clip-rule="evenodd"/></svg>
                          </button>
                          <button type="button" onclick={cancelConversationRename} aria-label="Cancel conversation rename" class="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 5.23a.75.75 0 011.06 0L10 8.94l3.71-3.71a.75.75 0 111.06 1.06L11.06 10l3.71 3.71a.75.75 0 11-1.06 1.06L10 11.06l-3.71 3.71a.75.75 0 01-1.06-1.06L8.94 10 5.23 6.29a.75.75 0 010-1.06z" clip-rule="evenodd"/></svg>
                          </button>
                        </form>
                      {:else}
                        <button
                          type="button"
                          onclick={() => restoreConversation(conversation)}
                          class="min-w-0 flex-1 rounded px-1 py-1 text-left transition-colors hover:bg-stone-100"
                        >
                          <span class="block truncate font-medium text-stone-700">{conversation.title}</span>
                          <span class="mt-0.5 block text-[10px] text-stone-400">{conversation.messages.length} messages / {conversation.artifacts.length} artifacts</span>
                        </button>
                        <button type="button" onclick={() => beginConversationRename(conversation)} aria-label="Rename conversation" class="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 2.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/><path d="M11.379 4.793L3 13.172V17h3.828l8.379-8.379-3.828-3.828z"/></svg>
                        </button>
                        <button type="button" onclick={() => archiveConversationRecord(conversation)} disabled={conversation.id === conversationId} aria-label="Archive conversation" class="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-30">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3a2 2 0 00-2 2v1.5A1.5 1.5 0 003.5 8H4v7a2 2 0 002 2h8a2 2 0 002-2V8h.5A1.5 1.5 0 0018 6.5V5a2 2 0 00-2-2H4zm1 5h10v7a1 1 0 01-1 1H6a1 1 0 01-1-1V8zm2.5 2a.5.5 0 000 1h5a.5.5 0 000-1h-5z"/></svg>
                        </button>
                        <button type="button" onclick={() => deleteConversationRecord(conversation)} disabled={conversation.id === conversationId} aria-label="Delete conversation" class="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.5 2a1.5 1.5 0 00-1.415 1H4.75a.75.75 0 000 1.5h10.5a.75.75 0 000-1.5h-2.335A1.5 1.5 0 0011.5 2h-3zM5.5 6a.75.75 0 01.75.75v8A2.25 2.25 0 008.5 17h3a2.25 2.25 0 002.25-2.25v-8a.75.75 0 011.5 0v8A3.75 3.75 0 0111.5 18.5h-3a3.75 3.75 0 01-3.75-3.75v-8A.75.75 0 015.5 6z" clip-rule="evenodd"/></svg>
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
        <button onclick={exportMarkdown} class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="Export chat as Markdown">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2.5A1.5 1.5 0 015.5 1h5.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0116 5.622V17.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 17.5v-15zM11 2.75V5a1 1 0 001 1h2.25L11 2.75z"/><path d="M6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"/></svg>
          <span class="hidden sm:inline">Markdown</span>
        </button>
        <button onclick={exportSession} class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="Export session">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4A1 1 0 016.707 8.293L9 10.586V3a1 1 0 011-1z"/><path d="M3 14a1 1 0 011-1h2.5a1 1 0 110 2H5v1h10v-1h-1.5a1 1 0 110-2H16a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3z"/></svg>
          <span class="hidden sm:inline">Export</span>
        </button>
        <button onclick={() => sessionImportInput.click()} class="text-[10px] md:text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 px-2 md:px-3 py-1 md:py-1.5 rounded-lg transition-all flex items-center gap-1" title="Import session">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 md:h-3.5 md:w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a1 1 0 01-1-1V9.414l-2.293 2.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 9.414V17a1 1 0 01-1 1z"/><path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 11-2 0V4H5v2a1 1 0 01-2 0V3z"/></svg>
          <span class="hidden sm:inline">Import</span>
        </button>
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
      activeArtifactId={activeArtifactEntry?.artifact.id ?? null}
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

    {#if showSuggestedPrompts}
      <div class="px-4 md:px-8 pb-2">
        <div class="max-w-3xl mx-auto flex flex-wrap gap-2">
          {#each visibleSuggestedPrompts as prompt}
            <button
              type="button"
              onclick={() => sendSuggestedPrompt(prompt)}
              disabled={isLoading}
              class="max-w-full rounded-lg border border-stone-200 bg-white/70 px-3 py-2 text-left text-xs font-medium text-stone-600 shadow-sm transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-stone-800 disabled:opacity-50"
            >{prompt}</button>
          {/each}
        </div>
      </div>
    {/if}

    <input type="file" bind:this={fileInput} onchange={onFileSelected} class="hidden" accept=".txt,.md,.json,.csv" multiple />
    <input type="file" bind:this={sessionImportInput} onchange={onSessionImportSelected} class="hidden" accept=".json,application/json" />

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
      ragDocuments={rag.documents}
      {ragMetadataOnly}
      onRemoveFile={removeFile}
      onDeleteDocument={removeDocument}
      onReembedDocument={reembedDocument}
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
    busy={isLoading}
    onclose={closeSplit}
    onselect={handleChipClick}
    onregenerate={regenerateArtifactEntry}
    onFixArtifact={(code: string, err: string) => { artifactError = err; fixArtifactErr(); }}
    {artifactError}
  />
</div>
