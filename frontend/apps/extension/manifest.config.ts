import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.displayName || pkg.name,
  description: pkg.description,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
    128: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
    // Popup as fallback for browsers without sidepanel support (Firefox, older Chrome)
    default_popup: 'src/popup/index.html',
  },
  // Background service worker that opens sidepanel instead of popup on click
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: [
    'sidePanel',
    'storage',
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  }
})
