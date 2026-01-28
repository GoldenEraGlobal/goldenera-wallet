import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config'
import { name, version } from './package.json'


export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    // Configure Tailwind to scan workspace packages
    tailwindcss({
      content: [
        './src/**/*.{ts,tsx,css}',
        '../../packages/ui/src/**/*.{ts,tsx,css}',
        '../../packages/core/src/**/*.{ts,tsx}',
      ],
    } as never),
    crx({ manifest }),
    zip({ outDir: 'release', outFileName: `crx-${name}-${version}.zip` }),
  ],
  server: {
    cors: {
      origin: [
        /chrome-extension:\/\//,
      ],
    },
  },
})
