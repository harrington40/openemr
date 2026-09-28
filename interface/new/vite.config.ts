import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Absolute base: the SPA is served from the domain root by nginx
  // (root /home/dev/openrx/public/dist). A RELATIVE base ('./') broke every deep
  // link — at /patients/36 the browser resolved ./assets/* to
  // /patients/assets/*, which nginx's SPA fallback answered with index.html
  // (text/html) instead of JavaScript, so the page came up blank on refresh.
  // Override with VITE_BASE=./ when previewing from a sub-directory such as
  // /public/dist/ in the OpenEMR container.
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: '../../public/dist',
    emptyOutDir: true,
    // Source maps must not ship: they contain the original application source and
    // are served straight off the web root, so anyone can fetch them. Opt in with
    // SOURCEMAP=true when you need a debuggable build.
    sourcemap: process.env.SOURCEMAP === 'true',
  },
  server: {
    port: 5173,
    watch: {
      // The repo lives on a Windows drive mounted into WSL (/mnt/c). inotify
      // events do not propagate across that boundary, so chokidar silently
      // misses edits and the dev server keeps serving stale modules.
      // Polling is slower but reliable here.
      usePolling: true,
      interval: 400,
    },
    proxy: {
      // NestJS API (new backend)
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // PHP REST API (legacy, during migration)
      '/apis': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
      // OAuth2 (still handled by PHP)
      '/oauth2': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
      // Legacy PHP UI
      '/interface': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
      '/public': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
      '/portal': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
    },
  },
})
