import { defineConfig } from 'astro/config';
import { impeccableShikiThemes } from './site/lib/impeccable-shiki-theme.mjs';

export default defineConfig({
  srcDir: './site',
  publicDir: './site/public',
  output: 'static',
  markdown: {
    shikiConfig: {
      themes: impeccableShikiThemes,
      defaultColor: false,
    },
  },
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
