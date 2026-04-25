<script>
  import { onMount } from 'svelte';
  
  let messages = [];
  let inputMessage = '';
  let isLoading = false;
  let turnstileToken = '';

  // Setup turnstile callback globally
  onMount(() => {
    // @ts-ignore
    window.onTurnstileSuccess = (token) => {
      turnstileToken = token;
    };
  });

  async function sendMessage() {
    if (!inputMessage.trim() || !turnstileToken) return;

    messages = [...messages, { role: 'user', content: inputMessage }];
    inputMessage = '';
    isLoading = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          intent: 'chat-fast', // Use default for now
          turnstileToken
        })
      });

      if (!res.ok) throw new Error('Chat API failed');

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let botMessage = { role: 'assistant', content: '' };
      messages = [...messages, botMessage];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        
        // Parse OpenAI SSE format
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const data = JSON.parse(line.replace('data: ', ''));
                    if (data.choices[0].delta?.content) {
                        botMessage.content += data.choices[0].delta.content;
                        messages = [...messages.slice(0, -1), botMessage];
                    }
                } catch(e) {}
            }
        }
      }
    } catch (e) {
      console.error(e);
      messages = [...messages, { role: 'assistant', content: 'Sorry, I encountered an error. Check if API keys are set.' }];
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
  <!-- Header -->
  <header class="p-4 bg-gray-800 shadow-md">
    <h1 class="text-xl font-bold">TechWriter Bot <span class="text-xs text-gray-400 ml-2 border border-gray-600 px-2 py-1 rounded">Obsidian Memory Active</span></h1>
  </header>

  <!-- Chat Area -->
  <main class="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto w-full">
    {#each messages as msg}
      <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[80%] rounded-lg p-4 leading-relaxed whitespace-pre-wrap {msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'}">
          {msg.content}
        </div>
      </div>
    {/each}
    {#if isLoading && messages[messages.length-1].role === 'user'}
       <div class="flex justify-start">
         <div class="bg-gray-700 text-gray-400 p-4 rounded-lg animate-pulse">
           Thinking...
         </div>
       </div>
    {/if}
  </main>

  <!-- Input Area -->
  <footer class="p-4 bg-gray-800">
    <div class="max-w-4xl mx-auto">
      <!-- Turnstile Widget (Dummy Site Key for testing, replace in production) -->
      <div class="cf-turnstile mb-2" data-sitekey="1x00000000000000000000AA" data-callback="onTurnstileSuccess"></div>
      
      <div class="flex gap-2">
        <input 
          bind:value={inputMessage} 
          on:keydown={(e) => e.key === 'Enter' && sendMessage()}
          disabled={!turnstileToken}
          class="flex-1 bg-gray-700 border border-gray-600 rounded p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={turnstileToken ? "Ask me to draft something..." : "Waiting for Cloudflare Turnstile..."}
        />
        <button 
          on:click={sendMessage}
          disabled={!turnstileToken || isLoading}
          class="bg-blue-600 hover:bg-blue-700 px-6 py-2 font-medium rounded transition-colors disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  </footer>
</div>
