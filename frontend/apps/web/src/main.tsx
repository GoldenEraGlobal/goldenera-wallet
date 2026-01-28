import { SplashScreen } from '@capacitor/splash-screen'
import { createApp } from '@project/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'

// PWA Auto-update: Automatically update when new version is available
// This will immediately activate the new service worker without requiring user interaction
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // New content is available, reload immediately
    console.log('PWA: New update available, reloading...')
    updateSW(true)
  },
  onOfflineReady() {
    console.log('PWA: App is ready for offline use')
  },
  onRegisteredSW(swUrl, registration) {
    console.log('PWA: Service worker registered:', swUrl)
    // Check for updates every 60 seconds
    if (registration) {
      setInterval(() => {
        registration.update()
      }, 60 * 1000)
    }
  },
  onRegisterError(error) {
    console.error('PWA: Service worker registration failed:', error)
  }
})

// iOS viewport height fix - Chrome doesn't handle dvh correctly
// This sets --app-height to actual window.innerHeight
let lastHeight = 0
let rafId: number | null = null

const setAppHeight = () => {
  // Use requestAnimationFrame to batch updates
  if (rafId) return

  rafId = requestAnimationFrame(() => {
    rafId = null

    // Use visualViewport if available (more accurate), fallback to innerHeight
    const vh = window.visualViewport?.height ?? window.innerHeight

    // Only update if height actually changed (avoid unnecessary reflows)
    if (Math.abs(vh - lastHeight) < 1) return
    lastHeight = vh

    document.documentElement.style.setProperty('--app-height', `${vh}px`)
  })
}

// Set initial height
setAppHeight()

// Listen for resize and orientation changes (debounced via RAF)
window.addEventListener('resize', setAppHeight, { passive: true })
window.addEventListener('orientationchange', () => {
  // Delay to allow browser to settle after orientation change
  setTimeout(setAppHeight, 150)
}, { passive: true })

const init = async () => {
  const { App } = await createApp({ isExtension: false })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div
        className='max-w-md mx-auto overflow-hidden'
        style={{
          height: 'var(--app-height, 100%)',
          maxHeight: 'var(--app-height, 100%)'
        }}
      >
        <App />
      </div>
    </StrictMode>,
  )
}

SplashScreen.show({
  autoHide: false
}).then(() => {
  init()
    .then(() => {
      console.log('Wallet APP initialized')
      SplashScreen.hide()
    })
    .catch(console.error)
})
