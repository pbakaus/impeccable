import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './site',
  publicDir: './site/public',
  output: 'static',
  devToolbar: {
    enabled: false,
  },
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
