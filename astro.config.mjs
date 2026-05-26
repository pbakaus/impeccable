import { defineConfig } from 'astro/config';

const viteCacheDir = process.env.IMPECCABLE_VITE_CACHE_DIR || undefined;
const disableDevToolbar = process.env.IMPECCABLE_DISABLE_ASTRO_DEV_TOOLBAR === '1';

export default defineConfig({
  srcDir: './site',
  publicDir: './site/public',
  output: 'static',
  build: {
    format: 'directory',
  },
  devToolbar: {
    enabled: !disableDevToolbar,
  },
  outDir: './build',
  vite: {
    cacheDir: viteCacheDir,
    build: {
      assetsInlineLimit: 0,
    },
  },
});
