import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    allowedHosts: ['dev-fe-wallet.holaholi.site']
  },
  plugins: [
    react(),
    tailwindcss({
      content: [
        './src/**/*.{ts,tsx,css}',
        '../../packages/ui/src/**/*.{ts,tsx,css}',
        '../../packages/core/src/**/*.{ts,tsx}',
      ],
    } as never),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-64x64.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'apple-touch-icon-180x180.png', 'favicon.ico'],
      manifest: {
        name: 'GoldenEra Wallet',
        short_name: 'GEW',
        description: 'A secure, non-custodial cryptocurrency wallet. Your keys, your crypto.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['crypto', 'wallet'],
        icons: [
          {
            "src": "pwa-64x64.png",
            "sizes": "64x64",
            "type": "image/png"
          },
          {
            "src": "pwa-192x192.png",
            "sizes": "192x192",
            "type": "image/png"
          },
          {
            "src": "pwa-512x512.png",
            "sizes": "512x512",
            "type": "image/png"
          },
          {
            "src": "maskable-icon-512x512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable"
          }
        ],
        screenshots: [],
        shortcuts: [
          {
            name: 'Open Wallet',
            short_name: 'Wallet',
            description: 'Open your GoldenEra wallet',
            url: '/',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['**/logo_full.png'], // Exclude large files from precache
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true // Disable in dev for faster reloads
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
              return 'vendor-react'
            }
            if (/[\\/]node_modules[\\/](@base-ui|lucide-react|clsx|tailwind-merge|motion|vaul|vaul-base)[\\/]/.test(id)) {
              return 'vendor-ui'
            }
            if (/[\\/]node_modules[\\/](@capacitor|@capawesome|@capgo|@ionic\/pwa-elements|capacitor-secure-storage-plugin)[\\/]/.test(id)) {
              return 'vendor-capacitor'
            }
            if (/[\\/]node_modules[\\/](@stackflow)[\\/]/.test(id)) {
              return 'vendor-stackflow'
            }
            if (/[\\/]node_modules[\\/](zod|axios|uuid|zustand|@tanstack|idb-keyval|unstorage|react-hook-form|@hookform)[\\/]/.test(id)) {
              return 'vendor-utils'
            }
            if (/[\\/]node_modules[\\/](firebase)[\\/]/.test(id)) {
              return 'vendor-firebase'
            }
            if (/[\\/]node_modules[\\/](@goldenera\/cryptoj)[\\/]/.test(id)) {
              return 'vendor-crypto'
            }
          }
        }
      }
    }
  },
})
