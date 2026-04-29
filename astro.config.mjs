// @ts-check
import { defineConfig } from 'astro/config';
import { sessionDrivers } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  session: {
    driver: sessionDrivers.lruCache()
  },
  adapter: cloudflare({
    imageService: 'passthrough',
    prerenderEnvironment: 'node',
    remoteBindings: true
  }),
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()]
  }
});
