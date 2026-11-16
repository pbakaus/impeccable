import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// SvelteKit 3 reads its config from the plugin; svelte.config.js is an error.
export default defineConfig({
  plugins: [sveltekit({ preprocess: vitePreprocess(), adapter: adapter() })],
  server: { host: '127.0.0.1', strictPort: false },
});
