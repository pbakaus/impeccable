import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './site',
  output: 'static',
  build: {
    format: 'directory',
  },
  outDir: './build',
  redirects: {
    '/cheatsheet': '/docs',
    '/gallery': '/slop#try-it-live',
    '/skills': '/docs',
    '/anti-patterns': '/slop#catalog',
    '/visual-mode': '/slop#see-it',
    '/neon-mirai': '/neo-mirai/',
    '/cases/neon-mirai': '/cases/neo-mirai',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
