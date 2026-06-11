<script lang="ts">
  import { stripDisclaimers, formatMarkdown } from '../lib/markdown';
  import type { ArtifactQueue, ArtifactEntry } from '../lib/artifact-queue';
  import ChatArtifactChip from './ChatArtifactChip.svelte';

  type WebhookDeliveryState = {
    messageIdx: number;
    status: 'sending' | 'sent' | 'failed';
    attempts?: number;
    error?: string;
    requestId?: string;
  };

  interface Props {
    messages: { role: string; content: string; provider?: string; sources?: { title: string; url: string }[]; searchTier?: string; empty?: boolean }[];
    queue: ArtifactQueue;
    isStreaming: boolean;
    isLoading: boolean;
    activeMessageIdx: number | null;
    activeArtifactId: string | null;
    onChipClick: (entry: ArtifactEntry) => void;
    onCopyMessage: (idx: number) => void;
    onCopySlackMessage: (idx: number) => void;
    onExportMessageMarkdown: (idx: number) => void;
    onExportMessageWebhook: (idx: number) => void;
    onRetryWebhookExport: (idx: number) => void;
    onRetryMessage: () => void;
    onEditMessage: (idx: number) => void;
    editingMessageIdx: number | null;
    editText: string;
    onEditTextChange: (val: string) => void;
    onSaveEdit: (idx: number) => void;
    onCancelEdit: () => void;
    copiedMessageIdx: number | null;
    copiedSlackMessageIdx: number | null;
    webhookDelivery: WebhookDeliveryState | null;
    chatPath: string | null;
  }

  let {
    messages, queue, isStreaming, isLoading, activeMessageIdx, activeArtifactId,
    onChipClick, onCopyMessage, onCopySlackMessage, onExportMessageMarkdown, onExportMessageWebhook, onRetryWebhookExport, onRetryMessage, onEditMessage,
    editingMessageIdx, editText, onEditTextChange, onSaveEdit, onCancelEdit,
    copiedMessageIdx, copiedSlackMessageIdx, webhookDelivery, chatPath,
  }: Props = $props();

  let artifactEntries = $state<ArtifactEntry[]>([]);

  $effect(() => {
    return queue.subscribeDebounced((entries) => {
      artifactEntries = entries;
    });
  });
</script>

<div class="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-6 w-full scroll-smooth max-w-3xl mx-auto" style="overscroll-behavior: contain;" role="log" aria-label="Chat messages" aria-live="polite">
  {#each messages as msg, i}
    <div class="msg-group relative {msg.role === 'user' ? 'flex flex-row-reverse' : ''}" id="msg-{i}">
      <div class="{msg.role === 'user' ? 'ml-auto text-right max-w-[95%] md:max-w-[75%]' : 'max-w-full overflow-hidden'}">
        {#if msg.role === 'assistant'}
          {#if msg.empty}
            <div class="text-[#71717a] italic text-sm">No response received.</div>
          {:else}
            <div class="ai-content whitespace-pre-wrap break-words min-w-0">{@html formatMarkdown(stripDisclaimers(msg.content), msg.sources)}</div>
          {/if}
          {#if !isStreaming && msg.content && !msg.empty}
            <div class="flex flex-wrap items-center gap-2 mt-2 md:mt-1.5 opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity duration-150">
              <button onclick={() => onCopyMessage(i)} class="text-[12px] md:text-[11px] px-3 py-1.5 md:px-2 md:py-0.5 rounded-md text-stone-500 md:text-stone-400 hover:text-stone-800 md:hover:text-stone-700 bg-stone-100 md:bg-transparent hover:bg-stone-200/50 transition-all">
                {copiedMessageIdx === i ? 'Copied' : 'Copy'}
              </button>
              <button onclick={() => onExportMessageMarkdown(i)} title="Export response as Markdown" class="text-[12px] md:text-[11px] px-3 py-1.5 md:px-2 md:py-0.5 rounded-md text-stone-500 md:text-stone-400 hover:text-stone-800 md:hover:text-stone-700 bg-stone-100 md:bg-transparent hover:bg-stone-200/50 transition-all">
                Markdown
              </button>
              <button onclick={() => onCopySlackMessage(i)} title="Copy response for Slack" class="text-[12px] md:text-[11px] px-3 py-1.5 md:px-2 md:py-0.5 rounded-md text-stone-500 md:text-stone-400 hover:text-stone-800 md:hover:text-stone-700 bg-stone-100 md:bg-transparent hover:bg-stone-200/50 transition-all">
                {copiedSlackMessageIdx === i ? 'Slack copied' : 'Slack'}
              </button>
              <button onclick={() => onExportMessageWebhook(i)} title="Send response to webhook" class="text-[12px] md:text-[11px] px-3 py-1.5 md:px-2 md:py-0.5 rounded-md text-stone-500 md:text-stone-400 hover:text-stone-800 md:hover:text-stone-700 bg-stone-100 md:bg-transparent hover:bg-stone-200/50 transition-all">
                Webhook
              </button>
              {#if i === messages.length - 1}
                <button onclick={onRetryMessage} class="text-[12px] md:text-[11px] px-3 py-1.5 md:px-2 md:py-0.5 rounded-md text-stone-500 md:text-stone-400 hover:text-stone-800 md:hover:text-stone-700 bg-stone-100 md:bg-transparent hover:bg-stone-200/50 transition-all">Retry</button>
              {/if}
            </div>
            {#if webhookDelivery?.messageIdx === i}
              <div role="status" class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                {#if webhookDelivery.status === 'sending'}
                  <span>Sending to webhook...</span>
                {:else if webhookDelivery.status === 'sent'}
                  <span>Webhook sent{webhookDelivery.attempts ? ` after ${webhookDelivery.attempts} attempt(s)` : ''}.</span>
                {:else}
                  <span class="text-amber-700">{webhookDelivery.error || 'Webhook export failed.'}</span>
                  <button type="button" onclick={() => onRetryWebhookExport(i)} title="Retry webhook export" class="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100">
                    Retry
                  </button>
                {/if}
              </div>
            {/if}
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
              <textarea value={editText} oninput={(e) => onEditTextChange((e.target as HTMLTextAreaElement).value)} class="w-full bg-white border border-stone-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/30 text-stone-800" rows="3"></textarea>
              <div class="flex gap-1.5 mt-2">
                <button onclick={() => onSaveEdit(i)} disabled={!editText.trim()} class="text-[10px] bg-stone-800 text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-all font-medium">Save</button>
                <button onclick={onCancelEdit} class="text-[10px] bg-stone-100 text-stone-600 px-3 py-1 rounded-lg border border-stone-200 transition-all hover:bg-stone-200">Cancel</button>
              </div>
            </div>
          {:else}
            <div class="bg-stone-100 rounded-2xl px-4 py-2.5 inline-block text-left">
              <div class="leading-relaxed text-[15px] text-[#1a1a1a]">{msg.content}</div>
            </div>
            <div class="flex items-center gap-2 mt-1 justify-end opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity duration-150">
              <button onclick={() => onEditMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">Edit</button>
              <button onclick={() => onCopyMessage(i)} class="text-[11px] px-2 py-0.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-all">{copiedMessageIdx === i ? 'Copied' : 'Copy'}</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    {#if !isStreaming}
      {#each artifactEntries.filter(a => a.messageIdx === i) as entry}
        <div class="flex justify-start w-full">
          <ChatArtifactChip
            entry={entry}
            active={activeMessageIdx === i && activeArtifactId === entry.artifact.id}
            onclick={() => onChipClick(entry)}
          />
        </div>
      {/each}
    {/if}
  {/each}

  {#if isLoading && !isStreaming}
    <div class="flex justify-start w-full">
      <div class="w-full max-w-md px-4 py-3 rounded-2xl border border-amber-200/60 bg-amber-50/30 transition-all">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-100">
            <div class="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-[13px] font-semibold text-stone-600">Thinking...</span>
            <div class="text-[10px] text-stone-400 mt-0.5">Analyzing your request</div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
