import { defineConfig } from 'vite';

// Set base to '/<repo-name>/' for GitHub Pages project sites.
// Override at build time: VITE_BASE=/your-repo/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2020',
    sourcemap: true
  },
  server: {
    host: true,
    port: 5173
  }
});
