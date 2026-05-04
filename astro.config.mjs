import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './site',
  publicDir: './site/public',
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
