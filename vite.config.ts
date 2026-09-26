import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project URLs (/<repo>/) and locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
