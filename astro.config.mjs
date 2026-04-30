import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './site',
  output: 'static',
  build: {
    format: 'directory',
  },
  outDir: './build',
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
