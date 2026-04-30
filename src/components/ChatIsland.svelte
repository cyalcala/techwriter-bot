<script lang="ts">
  import { onMount } from 'svelte';

  let messages = $state([
    { role: 'assistant', content: 'Hi! I am your Technical Writer Bot. Upload a document (txt, md, json) to my sandbox memory, and I can help you draft, edit, or analyze it.' }
  ]);
  let inputMessage = $state('');
  let isLoading = $state(false);
  let isStreaming = $state(false);
  let sessionId = $state('');
  let isUploading = $state(false);
  let uploadStatus = $state<'idle' | 'uploading' | 'done' | 'error'>('idle');
  let uploadedFileName = $state('');
  let fileInput: HTMLInputElement;
  let isThinkingMode = $state(false);
  let chatContainer: HTMLElement;

  function generateSessionId() {
    try { return crypto.randomUUID(); } catch (e) {
      return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
  }

  onMount(() => { sessionId = generateSessionId(); });

  $effect(() => {
    messages;
    if (chatContainer) chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  });

  function newChat() {
    sessionId = generateSessionId();
    messages = [{ role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' }];
    uploadStatus = 'idle';
    uploadedFileName = '';
  }

  function removeFile() {
    uploadStatus = 'idle';
    uploadedFileName = '';
    if (fileInput) fileInput.value = '';
  }

  async function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    isUploading = true;
    uploadStatus = 'uploading';
    uploadedFileName = file.name;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      try {
        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, fileName: file.name, sessionId })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || 'Ingestion failed');
        }

        uploadStatus = 'done';
        messages = [...messages, { role: 'assistant', content: `✅ I've processed **${file.name}** and added it to sandbox memory.` }];
      } catch (err: any) {
        console.error(err);
        uploadStatus = 'error';
        messages = [...messages, { role: 'assistant', content: `❌ Upload failed: ${err.message}` }];
      } finally {
        isUploading = false;
      }
    };
    reader.readAsText(file);
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatMarkdown(text: string | null | undefined): string {
    if (!text) return '';
    let formatted = escapeHtml(String(text));
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/^\- (.*)/gm, '<li class="ml-4 list-disc">$1</li>');
    formatted = formatted.replace(/(<li.*<\/li>)/gs, '<ul class="my-2">$1</ul>');
    formatted = formatted.replace(/\n/g, '<br />');
    return formatted;
  }

  async function sendMessage() {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage;
    inputMessage = '';
    messages = [...messages, { role: 'user', content: userMessage }];
    isLoading = true;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          intent: isThinkingMode ? 'research' : 'chat-fast',
          sessionId,
          hasRag: uploadStatus === 'done'
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const providerName = response.headers.get('x-provider') || 'AI';
      const role = response.headers.get('x-role') || '';
      isStreaming = true;

      const stream = response.body;
      if (!stream) throw new Error('No response stream received');

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      messages = [...messages, { role: 'assistant', content: '', provider: providerName }];
      const msgIdx = messages.length - 1;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
              const errorMsg = `\n\n❌ Error: ${json.error.message || JSON.stringify(json.error)}`;
              messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + errorMsg };
              continue;
            }
            const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.content || '';
            if (content) {
              messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + content };
            }
          } catch (e) {
            if (rawData && !rawData.includes('{')) {
              messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + rawData };
            }
          }
        }
      }

      if (buffer.trim().startsWith('data:')) {
        const rawData = buffer.slice(buffer.indexOf(':') + 1).trim();
        if (rawData !== '[DONE]') {
          try {
            const json = JSON.parse(rawData);
            const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
            if (content) messages[msgIdx] = { ...messages[msgIdx], content: messages[msgIdx].content + content };
          } catch (e) {}
        }
      }
    } catch (error: any) {
      console.error('[Chat]', error);
      messages = [...messages, { role: 'assistant', content: `❌ Connection Error: ${error.message}.` }];
    } finally {
      isLoading = false;
      isStreaming = false;
    }
  }
</script>

<div class="flex flex-col h-screen bg-[#fcfaf6] text-[#2e2e2e] font-['Outfit'] selection:bg-[#e8e4db]">
  <header class="p-3 md:p-4 bg-[#f1ede4]/90 backdrop-blur-xl border-b border-[#e5e1d8] flex justify-between items-center sticky top-0 shadow-sm z-20">
    <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-600 shadow-[0_0_8px_rgba(22,163,74,0.5)]"></div>
        <h1 class="text-sm md:text-lg font-bold tracking-tight text-[#1a1a1a]">
          Technical Writer <span class="hidden md:inline text-gray-400 font-normal mx-2">/</span>
          <span class="md:hidden text-[#8c8576] font-normal">Bot</span>
        </h1>
      </div>
      <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" class="text-[8px] md:text-[10px] text-[#8c8576] hover:text-[#1a1a1a] transition-colors flex items-center gap-1 font-medium group">
        <span class="opacity-50">made with</span>
        <span class="text-red-500 text-[10px] group-hover:scale-125 transition-transform duration-300">&#10084;&#65039;</span>
        <span class="opacity-50">by</span>
        <span class="border-b border-transparent group-hover:border-[#8c8576] transition-all">Cy Alcala</span>
      </a>
    </div>
    <div class="flex items-center gap-2">
      <button on:click={newChat} class="text-[10px] md:text-xs bg-white/50 hover:bg-white text-[#6d675b] px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl transition-all flex items-center gap-1.5 border border-[#d6d0c4] shadow-sm active:scale-95">
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
  </style>

  <main bind:this={chatContainer} class="flex-1 overflow-y-auto px-3 py-4 md:p-8 space-y-4 md:space-y-6 max-w-4xl mx-auto w-full scroll-smooth">
    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div class="max-w-[92%] md:max-w-[85%] rounded-3xl p-4 md:p-6 shadow-sm border {msg.role === 'user' ? 'bg-[#e8e4db] border-[#d6d0c4] text-[#1a1a1a] rounded-tr-none' : 'bg-white border-[#e5e1d8] text-[#2e2e2e] rounded-tl-none'}">
          {#if msg.role === 'assistant'}
            <div class="ai-content whitespace-pre-wrap">{@html formatMarkdown(msg.content)}</div>
            {#if msg.provider && !isStreaming}
              <div class="mt-4 pt-3 border-t border-[#e5e1d8] flex items-center gap-2">
                <span class="text-[8px] uppercase tracking-widest font-bold text-[#8c8576] opacity-40">Engine: {msg.provider}</span>
              </div>
            {/if}
          {:else}
            <div class="leading-relaxed whitespace-pre-wrap font-['Inter'] text-sm md:text-base">{msg.content}</div>
          {/if}
        </div>
      </div>
    {/each}
    {#if isLoading && !isStreaming}
      <div class="flex justify-start">
        <div class="bg-white border border-[#e5e1d8] text-[#8c8576] px-6 py-4 rounded-full shadow-sm animate-pulse text-sm flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full bg-[#d6d0c4] animate-bounce"></div>
          Gathering thoughts...
        </div>
      </div>
    {/if}
  </main>

  <footer class="p-2 md:p-6 bg-[#f1ede4]/70 backdrop-blur-xl border-t border-[#e5e1d8] transition-all">
    <div class="max-w-4xl mx-auto">

      <!-- File Upload Chip -->
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
            <span class="text-[10px] font-bold shrink-0">
              {#if uploadStatus === 'uploading'}uploading{/if}
            </span>
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
          title={uploadStatus === 'done' ? 'Replace file' : 'Upload document'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <div class="relative flex-1">
          <input
            bind:value={inputMessage}
            on:keydown={(e) => e.key === 'Enter' && sendMessage()}
            disabled={isLoading}
            class="w-full bg-white/80 border border-[#d6d0c4] rounded-xl md:rounded-2xl p-2.5 md:p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#8c8576]/20 text-[#1a1a1a] placeholder:text-[#a39e91] text-sm md:text-lg"
            placeholder={uploadStatus === 'done' ? 'Ask about your document...' : 'Ask anything...'}
          />
        </div>

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
      </div>

      <div class="flex justify-between items-center gap-1 text-[9px] md:text-[11px] text-[#8c8576] mt-2">
        <div class="flex items-center gap-1 md:gap-2">
          <div class="flex items-center bg-[#e8e4db]/50 p-0.5 rounded-md md:rounded-lg border border-[#d6d0c4] shadow-inner shrink-0">
            <button on:click={() => isThinkingMode = false} class="px-1.5 md:px-4 py-1 rounded-sm md:rounded-md transition-all {!isThinkingMode ? 'bg-white text-[#1a1a1a] shadow-sm font-bold' : 'text-[#8c8576]'} text-[9px] md:text-xs">Fast</button>
            <button on:click={() => isThinkingMode = true} class="px-1.5 md:px-4 py-1 rounded-sm md:rounded-md transition-all {isThinkingMode ? 'bg-black text-white shadow-sm font-bold' : 'text-[#8c8576]'} text-[9px] md:text-xs">Brain</button>
          </div>
          <span class="hidden sm:inline opacity-40">|</span>
          <span class="hidden sm:inline font-mono opacity-60 text-[8px] md:text-[10px]">SESS:{sessionId.slice(0,6)}</span>
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