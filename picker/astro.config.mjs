import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './picker',
  outDir: './build-picker',
  output: 'static',
  build: {
    assets: 'assets',
    assetsPrefix: '.',
    format: 'directory',
  },
  devToolbar: {
    enabled: false,
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
