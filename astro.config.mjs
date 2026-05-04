// @ts-check
import { defineConfig } from 'astro/config';
import { sessionDrivers } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

function envDefine(key) {
  const val = process.env[key];
  return val ? JSON.stringify(val) : 'undefined';
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  session: {
    driver: sessionDrivers.lruCache()
  },
  adapter: cloudflare({
    imageService: 'passthrough',
    prerenderEnvironment: 'node',
  }),
  integrations: [svelte()],
  vite: {
    define: {
      'import.meta.env.GROQ_API_KEY': envDefine('GROQ_API_KEY'),
      'import.meta.env.CEREBRAS_API_KEY': envDefine('CEREBRAS_API_KEY'),
      'import.meta.env.GEMINI_API_KEY': envDefine('GEMINI_API_KEY'),
      'import.meta.env.NVIDIA_API_KEY': envDefine('NVIDIA_API_KEY'),
      'import.meta.env.OPENROUTER_API_KEY': envDefine('OPENROUTER_API_KEY'),
      'import.meta.env.TAVILY_API_KEY': envDefine('TAVILY_API_KEY'),
      'import.meta.env.EXA_API_KEY': envDefine('EXA_API_KEY'),
      'import.meta.env.TURNSTILE_SECRET_KEY': envDefine('TURNSTILE_SECRET_KEY'),
      'import.meta.env.DEV_IPS': envDefine('DEV_IPS'),
    },
    plugins: [tailwindcss()]
  }
});