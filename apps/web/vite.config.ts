import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Potluck',
        short_name: 'Potluck',
        description: 'Everyone brings a dish.',
        // Matches --ground, so the splash screen does not flash a different
        // colour before the app paints.
        background_color: '#FBFAEF',
        theme_color: '#FBFAEF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Recipes should stay readable when the kitchen wifi drops or the
        // backend is cold. Shell is precached; recipe reads are stale-while-
        // revalidate so an offline cook still sees what they saw this morning.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // _worker.js is Cloudflare's, not the app's. Pages consumes it as the
        // edge worker rather than serving it, so precaching it would have the
        // service worker fetch a path that resolves to index.html and store
        // that under a .js name.
        globIgnores: ['_worker.js'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/recipes/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'recipes',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/api\/photos\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'photos',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the session cookie behaves exactly as it will in
      // production behind Cloudflare, rather than needing CORS special cases.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
