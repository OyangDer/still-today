import { defineConfig } from 'vite';

// Tests assert wall-clock results in the user's own zone, which also has a DST change mid-semester.
process.env.TZ ??= 'Australia/Sydney';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    cssCodeSplit: false,
  },
  server: { port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts'] },
});
