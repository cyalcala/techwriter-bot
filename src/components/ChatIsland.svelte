<script>
  import { onMount, afterUpdate } from 'svelte';

  let messages = [
    { role: 'assistant', content: 'Hi! I am your Technical Writer Bot. Upload a document (txt, md, json) to my sandbox memory, and I can help you draft, edit, or analyze it.' }
  ];
  let inputMessage = '';
  let isLoading = false;
  let turnstileToken = '';
  let sessionId = '';
  let isUploading = false;
  let uploadStatus = '';
  let fileInput;
  let isThinkingMode = false;
  let chatContainer;
  let authTimeout = false;

  // Show emergency bypass after 3 seconds
  onMount(() => {
    setTimeout(() => {
      if (!turnstileToken) authTimeout = true;
    }, 3000);
  });

  // Generate a new session ID
  function generateSessionId() {
    return crypto.randomUUID();
  }

  function initTurnstile() {
    if (window.turnstile) {
      console.log("[Svelte] Rendering Turnstile...");
      window.turnstile.render('#turnstile-container', {
        sitekey: '0x4AAAAAAASo_P5_H-S7U0h9',
        callback: (token) => {
          turnstileToken = token;
          window.turnstileTokenValue = token;
        },
      });
    } else {
      console.warn("[Svelte] Turnstile not ready, retrying in 500ms...");
      setTimeout(initTurnstile, 500);
    }
  }

  onMount(() => {
    sessionId = generateSessionId();

    // 1. Check if token already exists
    if (window.turnstileTokenValue) {
      turnstileToken = window.turnstileTokenValue;
    }

    // 2. Try to init immediately, or wait for ready event
    if (window.turnstile) {
      initTurnstile();
    } else {
      window.addEventListener('turnstile-ready', initTurnstile);
    }

    // 3. Backup listener for the success event
    window.addEventListener('turnstile-success', (e) => {
      turnstileToken = e.detail;
    });
  });

  // Auto-scroll logic
  afterUpdate(() => {
    if (chatContainer) {
      chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
      });
    }
  });

  function newChat() {
    sessionId = generateSessionId();
    messages = [
      { role: 'assistant', content: 'Fresh session started. My memory is now clear. What would you like to work on?' }
    ];
  }

  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    isUploading = true;
    uploadStatus = 'Reading...';
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      uploadStatus = 'Vectorizing...';
      
      try {
        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            fileName: file.name,
            sessionId
          })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || 'Ingestion failed');
        }
        
        uploadStatus = 'Ready!';
        messages = [...messages, { role: 'assistant', content: `✅ I've successfully analyzed **${file.name}** and added it to our temporary sandbox memory!` }];
      } catch (err) {
        console.error(err);
        uploadStatus = 'Error';
        messages = [...messages, { role: 'assistant', content: `❌ **Upload failed:** ${err.message}. Please check your Cloudflare AI bindings.` }];
      } finally {
        isUploading = false;
        setTimeout(() => { uploadStatus = ''; }, 3000);
      }
    };
    reader.readAsText(file);
  }

  // Simple Markdown formatter
  function formatMarkdown(text) {
    if (!text) return '';
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Bullet points
    text = text.replace(/^\* (.*)/gm, '<li class="ml-4 list-disc">$1</li>');
    // Wrap lists
    text = text.replace(/(<li.*<\/li>)/gs, '<ul class="my-2">$1</ul>');
    // New lines
    text = text.replace(/\n/g, '<br />');
    return text;
  }

  async function sendMessage() {
    if (!inputMessage.trim() || isLoading || !turnstileToken) return;

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
          turnstileToken,
          sessionId 
        })
      });
      
      // Store status for error reporting
      window.lastResponseStatus = response.status;

      if (!response.ok) {
        const rawText = await response.text().catch(() => 'No error details');
        throw new Error(rawText);
      }

      // Extract the successful provider name if possible
      const providerName = response.headers.get('x-provider') || 'Unknown';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = { role: 'assistant', content: '', provider: providerName };
      messages = [...messages, assistantMessage];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta?.content) {
                assistantMessage.content += data.choices[0].delta.content;
                messages = [...messages]; // Trigger Svelte reactivity
              }
            } catch (e) {
              // Ignore partial JSON
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      const errorMsg = error.message || 'Unknown error';
      // If we have the status code from the fetch response, use it
      const statusCode = window.lastResponseStatus || 'Unknown';
      messages = [...messages, { 
        role: 'assistant', 
        content: `❌ **Connection Error:** ${errorMsg} (Status: ${statusCode}). 
        \n\n**System Audit:** Check Cloudflare Dashboard > Settings > Functions > Variables for CEREBRAS_API_KEY.` 
      }];
    } finally {
      isLoading = false;
      // Turnstile tokens are single-use. Reset the widget to get a fresh token for the next message.
      if (window.turnstile) {
        window.turnstile.reset();
      }
    }
  }
</script>

<div class="flex flex-col h-screen bg-[#fcfaf6] text-[#2e2e2e] font-['Outfit'] selection:bg-[#e8e4db]">
  <!-- Header -->
  <header class="p-2 md:p-4 bg-[#f1ede4]/90 backdrop-blur-xl border-b border-[#e5e1d8] flex justify-between items-center sticky top-0 shadow-sm z-20">
    <div class="flex items-center gap-2">
      <div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-600 shadow-[0_0_8px_rgba(22,163,74,0.5)]"></div>
      <h1 class="text-xs md:text-lg font-bold tracking-tight text-[#1a1a1a]">
        Technical Writer <span class="hidden md:inline text-gray-400 font-normal mx-2">/</span> 
        <span class="md:hidden text-[#8c8576] font-normal">Bot</span>
        <a href="https://www.linkedin.com/in/cyrusalcala/" target="_blank" class="hidden md:inline-block text-[9px] uppercase text-[#8c8576] font-mono tracking-widest border border-[#d6d0c4] px-2 py-0.5 rounded bg-white shadow-sm hover:text-[#1a1a1a] transition-colors">BY CY ALCALA</a>
      </h1>
    </div>
    <div class="flex items-center gap-2">
      <button 
        on:click={newChat}
        class="text-[10px] md:text-xs bg-white/50 hover:bg-white text-[#6d675b] px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl transition-all flex items-center gap-1.5 border border-[#d6d0c4] shadow-sm active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
        </svg>
        <span class="hidden md:inline">New Chat</span>
        <span class="md:hidden">New</span>
      </button>
    </div>
  </header>
  
  <style>
    /* Hide scrollbar for all browsers */
    main::-webkit-scrollbar { display: none; }
    main { -ms-overflow-style: none; scrollbar-width: none; }
    
    /* Claude-like serif style for AI responses */
    .ai-content {
      font-family: 'Instrument Serif', serif;
      font-size: 1.25rem;
      line-height: 1.6;
    }
    
    @media (max-width: 768px) {
      .ai-content {
        font-size: 1.15rem;
      }
    }
  </style>

  <!-- Chat Area -->
  <main bind:this={chatContainer} class="flex-1 overflow-y-auto px-3 py-4 md:p-8 space-y-4 md:space-y-6 max-w-4xl mx-auto w-full scroll-smooth">
    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div class="max-w-[92%] md:max-w-[85%] rounded-3xl p-4 md:p-6 shadow-sm border {msg.role === 'user' ? 'bg-[#e8e4db] border-[#d6d0c4] text-[#1a1a1a] rounded-tr-none' : 'bg-white border-[#e5e1d8] text-[#2e2e2e] rounded-tl-none'}">
          {#if msg.role === 'assistant'}
            {#if msg.content.includes('<think>') }
              {@const parts = msg.content.split('</think>')}
              {#if parts.length > 1}
                <details class="mb-4 bg-[#fcfaf6] rounded-2xl border border-[#e5e1d8] overflow-hidden group">
                  <summary class="p-3 text-[10px] text-[#8c8576] font-semibold cursor-pointer hover:bg-[#f1ede4] transition-colors list-none flex items-center gap-2 uppercase tracking-widest">
                    <span class="transform group-open:rotate-90 transition-transform">▶</span>
                    Thought Process
                  </summary>
                  <div class="p-4 text-xs italic text-[#6d675b] border-t border-[#e5e1d8] leading-relaxed font-['Inter']">
                    {parts[0].replace('<think>', '').trim()}
                  </div>
                </details>
                <div class="ai-content whitespace-pre-wrap">{@html formatMarkdown(parts[1].trim())}</div>
                {#if msg.provider}
                  <div class="mt-4 pt-3 border-t border-[#e5e1d8] flex items-center gap-2">
                    <span class="text-[8px] uppercase tracking-widest font-bold text-[#8c8576] opacity-40">Engine: {msg.provider}</span>
                  </div>
                {/if}
              {:else}
                <div class="flex items-center gap-2 text-xs text-[#8c8576] mb-3 italic">
                  <div class="w-1.5 h-1.5 rounded-full bg-[#d6d0c4] animate-pulse"></div>
                  Thinking...
                </div>
                <div class="leading-relaxed whitespace-pre-wrap text-[#8c8576] blur-[0.4px] font-['Inter']">
                  {msg.content.replace('<think>', '').trim()}
                </div>
              {/if}
            {:else}
              <div class="ai-content whitespace-pre-wrap">{@html formatMarkdown(msg.content)}</div>
              {#if msg.provider}
                <div class="mt-4 pt-3 border-t border-[#e5e1d8] flex items-center gap-2">
                  <span class="text-[8px] uppercase tracking-widest font-bold text-[#8c8576] opacity-40">Engine: {msg.provider}</span>
                </div>
              {/if}
            {/if}
          {:else}
            <div class="leading-relaxed whitespace-pre-wrap font-['Inter'] text-sm md:text-base">{msg.content}</div>
          {/if}
        </div>
      </div>
    {/each}
    {#if isLoading && messages[messages.length-1].role === 'user'}
       <div class="flex justify-start">
         <div class="bg-white border border-[#e5e1d8] text-[#8c8576] px-6 py-4 rounded-full shadow-sm animate-pulse text-sm">
           Gathering thoughts...
         </div>
       </div>
    {/if}
  </main>

  <!-- Input Area -->
  <footer class="p-3 md:p-6 bg-[#f1ede4]/70 backdrop-blur-xl border-t border-[#e5e1d8] transition-all">
    <div class="max-w-4xl mx-auto">
      <div class="flex gap-2 md:gap-3 items-center mb-3">
        <!-- Minimalist Upload Button -->
        <input 
          type="file" 
          bind:this={fileInput} 
          on:change={handleFileUpload} 
          class="hidden" 
          accept=".txt,.md,.json,.csv"
        />
        <button 
          on:click={() => fileInput.click()}
          disabled={isUploading || !turnstileToken}
          class="p-2.5 md:p-4 bg-white hover:bg-[#fcfaf6] border border-[#d6d0c4] rounded-xl md:rounded-2xl text-[#8c8576] transition-all shadow-sm disabled:opacity-50 shrink-0"
        >
          {#if isUploading}
            <div class="w-5 h-5 border-2 border-[#8c8576] border-t-transparent rounded-full animate-spin"></div>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          {/if}
        </button>

        <!-- Compact Text Input -->
        <div class="relative flex-1">
          <input 
            bind:value={inputMessage} 
            on:keydown={(e) => e.key === 'Enter' && sendMessage()}
            disabled={!turnstileToken}
            class="w-full bg-white/80 border border-[#d6d0c4] rounded-xl md:rounded-2xl p-2.5 md:p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#8c8576]/20 pr-10 md:pr-24 text-[#1a1a1a] placeholder:text-[#a39e91] text-sm md:text-lg"
            placeholder={turnstileToken ? "Ask anything..." : "Authenticating..."}
          />
          {#if authTimeout && !turnstileToken}
            <button 
              on:click={() => { turnstileToken = 'BYPASS'; window.turnstileTokenValue = 'BYPASS'; }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] bg-red-500 text-white px-2 py-1 rounded-md animate-bounce shadow-lg z-50"
            >
              SKIP AUTH
            </button>
          {/if}
          {#if uploadStatus}
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-bold uppercase tracking-tight bg-[#8c8576] px-1.5 py-0.5 rounded text-white animate-pulse">
              {uploadStatus}
            </span>
          {/if}
        </div>

        <!-- Mobile-first Send Icon -->
        <button 
          on:click={sendMessage}
          disabled={!turnstileToken || isLoading}
          class="bg-[#8c8576] hover:bg-[#6d675b] text-white p-2.5 md:px-8 md:py-4 rounded-xl md:rounded-2xl transition-all shadow-md active:scale-95 disabled:opacity-50 shrink-0 flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 md:hidden" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
          <span class="hidden md:inline text-lg font-bold">Send</span>
        </button>
      </div>

      <!-- Footer Branding & Toggles -->
      <div class="flex justify-between items-center gap-2 text-[10px] md:text-[11px] text-[#8c8576]">
        <div class="flex items-center gap-2">
           <!-- Premium Toggle - More compact on mobile -->
           <div class="flex items-center bg-[#e8e4db]/50 p-0.5 rounded-lg border border-[#d6d0c4] shadow-inner">
             <button 
               on:click={() => isThinkingMode = false}
               class="px-2 md:px-4 py-1 rounded-md transition-all {!isThinkingMode ? 'bg-white text-[#1a1a1a] shadow-sm font-bold' : 'text-[#8c8576]'}"
             >
               Fast
             </button>
             <button 
               on:click={() => isThinkingMode = true}
               class="px-2 md:px-4 py-1 rounded-md transition-all {isThinkingMode ? 'bg-[#8c8576] text-white shadow-sm font-bold' : 'text-[#8c8576]'}"
             >
               Brain
             </button>
           </div>
           <span class="hidden md:inline opacity-40">|</span>
           <span class="hidden md:inline font-mono opacity-60">SESS: {sessionId.slice(0,6)}</span>
        </div>

        <!-- Turnstile & Status Pill -->
        <div class="flex items-center gap-2">
          {#if turnstileToken}
             <div class="flex items-center gap-1 text-green-600 font-bold uppercase tracking-tighter text-[7px] md:text-[8px] bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100 shadow-sm">
               Encrypted
             </div>
           {/if}
           <!-- Normalized Turnstile Widget (Manually Rendered) -->
           <div id="turnstile-container"></div>
        </div>
      </div>
    </div>
  </footer>
</div>
