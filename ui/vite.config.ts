import { defineConfig } from 'vite';

// Tests assert wall-clock results in the user's own zone, which also has a DST change mid-semester.
process.env.TZ ??= 'Australia/Sydney';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: {
    target: 'chrome120',
    // The Mac host's WKWebView takes only the prefixed -webkit-user-select (and, before macOS 15,
    // -webkit-backdrop-filter). Built for Chrome alone, the minifier dropped those prefixes, so the
    // page's text was selectable on the Mac and a drag selected it. Safari 16 is macOS 13's.
    cssTarget: ['chrome120', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    cssCodeSplit: false,
  },
  server: { port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts'] },
});
