import './activities'
import { defineConfig } from '@stackflow/config'
import { basicUIPlugin } from '@stackflow/plugin-basic-ui'
import { historySyncPlugin } from '@stackflow/plugin-history-sync'
import { basicRendererPlugin } from '@stackflow/plugin-renderer-basic'
import { webRendererPlugin } from '@stackflow/plugin-renderer-web'
import { stackflow } from '@stackflow/react'
import { createMemoryHistory, type History } from 'history'
import { useEffect, useState } from 'react'
import {
    BackupPhrasePage,
    CreateWalletPage,
    DashboardPage,
    DeleteWalletPage,
    ImportWalletPage,
    ScanQrCodePage,
    SettingsPage,
    ShowPhrasePage,
    ToggleBiometricPage,
    TokenDetailPage,
    WelcomePage
} from '../pages'
import { TxSubmitPage } from '../pages/TxSubmitPage'
import { useWalletStore } from '../store/WalletStore'
import {
    getTheme,
    isNotIos as isNotIosPlatform,
    shouldUseWebRenderer
} from '../utils/PlatformUtil'
import { RootCtx } from './RootContext'

export const TRANSITION_DURATION = 270

const useWebRenderer = shouldUseWebRenderer()
const isNotIos = isNotIosPlatform()
const theme = getTheme()

const basePlugins = [
    useWebRenderer ? webRendererPlugin() : basicRendererPlugin(),
    basicUIPlugin({
        rootClassName: `root-ui theme-${theme}`,
        theme,
    })
]
const transitionDuration = useWebRenderer ? 0 : TRANSITION_DURATION

// Custom history wrapper that can be properly cleaned up
class CleanableHistory {
    private history: History
    private popstateHandler: ((event: PopStateEvent) => void) | null = null
    private listeners: Set<() => void> = new Set()
    private historyIndex = 0 // Track our position in browser history
    private instanceId = Date.now().toString(36) + Math.random().toString(36).substr(2)

    constructor() {
        this.history = createMemoryHistory()
    }

    // Sync with browser for back/forward button support
    startBrowserSync() {
        if (typeof window !== 'undefined') {
            // Update current entry with our instanceId
            window.history.replaceState({
                index: this.historyIndex,
                instanceId: this.instanceId
            }, '', window.location.href)

            this.popstateHandler = (event: PopStateEvent) => {
                try {
                    const state = event.state

                    // Check if this state belongs to our current history session
                    if (state?.instanceId === this.instanceId) {
                        const newIndex = state.index ?? 0
                        const delta = newIndex - this.historyIndex

                        this.historyIndex = newIndex

                        if (delta !== 0) {
                            this.history.go(delta)
                        }
                    } else {
                        // Mismatch or foreign state (e.g. from reload or other session)
                        // Force sync logic: Adopt this browser URL into our memory history
                        // Extract path from hash
                        const hash = window.location.hash
                        const path = hash.startsWith('#') ? hash.substring(1) : '/'

                        this.history.replace(path)

                        // We reset our index logic effectively for this "new" entry
                        // But we should claim it in browser state to prevent future mismatches
                        this.historyIndex = state?.index ?? 0 // Adopt the browser's index if available to keep relative continuity if possible

                        window.history.replaceState({
                            index: this.historyIndex,
                            instanceId: this.instanceId
                        }, '', window.location.href)
                    }
                } finally {
                    // History synchronization completes in this callback.
                }
            }
            window.addEventListener('popstate', this.popstateHandler)
        }
    }

    stopBrowserSync() {
        if (this.popstateHandler && typeof window !== 'undefined') {
            window.removeEventListener('popstate', this.popstateHandler)
            this.popstateHandler = null
        }
    }

    // Forward all history methods
    get action() { return this.history.action }
    get location() { return this.history.location }

    push(...args: Parameters<History['push']>) {
        this.history.push(...args)
        if (typeof window !== 'undefined') {
            this.historyIndex++
            window.history.pushState(
                { index: this.historyIndex, instanceId: this.instanceId },
                '',
                window.location.pathname + '#' + this.history.location.pathname
            )
        }
    }

    replace(...args: Parameters<History['replace']>) {
        this.history.replace(...args)
        if (typeof window !== 'undefined') {
            window.history.replaceState(
                { index: this.historyIndex, instanceId: this.instanceId },
                '',
                window.location.pathname + '#' + this.history.location.pathname
            )
        }
    }

    // Stackflow 3 history reconciliation uses go(delta), not only back()/forward().
    go(delta: number) {
        if (typeof window !== 'undefined') {
            window.history.go(delta)
        } else {
            this.historyIndex += delta
            this.history.go(delta)
        }
    }

    back() {
        if (typeof window !== 'undefined' && this.historyIndex > 0) {
            window.history.back()
        } else {
            if (this.historyIndex > 0) {
                this.historyIndex--
            }
            this.history.back()
        }
    }

    forward() {
        if (typeof window !== 'undefined') {
            window.history.forward()
        } else {
            this.historyIndex++
            this.history.forward()
        }
    }

    listen(listener: Parameters<History['listen']>[0]) {
        const unlisten = this.history.listen((update) => {
            // Always sync browser hash after any navigation to ensure consistency
            if (typeof window !== 'undefined') {
                window.history.replaceState(
                    { index: this.historyIndex, instanceId: this.instanceId },
                    '',
                    window.location.pathname + '#' + update.location.pathname
                )
            }
            listener(update)
        })
        this.listeners.add(unlisten)
        return () => {
            unlisten()
            this.listeners.delete(unlisten)
        }
    }

    createHref(to: Parameters<History['createHref']>[0]) {
        return this.history.createHref(to)
    }

    // Clean up everything
    destroy() {
        this.stopBrowserSync()
        this.listeners.forEach(unlisten => unlisten())
        this.listeners.clear()
    }

    // Reset to root
    reset() {
        this.historyIndex = 0
        this.history.replace('/')
        if (typeof window !== 'undefined') {
            window.history.replaceState(
                { index: this.historyIndex, instanceId: this.instanceId },
                '',
                window.location.pathname + '#/'
            )
        }
    }
}

// All components are available to the renderer; each config registers only the
// activities that belonged to that auth/backup stack before the v2 migration.
const components = {
    ShowPhrasePage, DashboardPage, SettingsPage, ToggleBiometricPage,
    DeleteWalletPage, TokenDetailPage, ScanQrCodePage, TxSubmitPage,
    WelcomePage, CreateWalletPage, ImportWalletPage, BackupPhrasePage,
}

const authenticatedConfig = defineConfig({
    transitionDuration,
    activities: [
        { name: 'DashboardPage', route: '/' },
        { name: 'ShowPhrasePage', route: '/show-phrase' },
        { name: 'SettingsPage', route: '/settings' },
        { name: 'DeleteWalletPage', route: '/delete-wallet' },
        { name: 'ScanQrCodePage', route: '/scan-qr-code' },
        { name: 'ToggleBiometricPage', route: '/toggle-biometric' },
        { name: 'TokenDetailPage', route: '/token/:tokenAddress' },
        { name: 'TxSubmitPage', route: '/tx-submit' },
    ],
})
const unauthenticatedConfig = defineConfig({
    transitionDuration,
    activities: [
        { name: 'WelcomePage', route: '/' },
        { name: 'CreateWalletPage', route: '/create-wallet' },
        { name: 'ImportWalletPage', route: '/import-wallet' },
    ],
})
const backupConfig = defineConfig({
    transitionDuration,
    activities: [{ name: 'BackupPhrasePage', route: '/' }],
})

const createAuthenticatedStack = (history: CleanableHistory) => stackflow({
    config: authenticatedConfig,
    components,
    plugins: [
        ...basePlugins,
        historySyncPlugin({
            config: authenticatedConfig,
            fallbackActivity: () => 'DashboardPage',
            useHash: false,
            history: history as unknown as History,
        }),
    ],
})
const createUnauthenticatedStack = (history: CleanableHistory) => stackflow({
    config: unauthenticatedConfig,
    components,
    plugins: [
        ...basePlugins,
        historySyncPlugin({
            config: unauthenticatedConfig,
            fallbackActivity: () => 'WelcomePage',
            useHash: false,
            history: history as unknown as History,
        }),
    ],
})
const createBackupStack = (history: CleanableHistory) => stackflow({
    config: backupConfig,
    components,
    plugins: [
        ...basePlugins,
        historySyncPlugin({
            config: backupConfig,
            fallbackActivity: () => 'BackupPhrasePage',
            useHash: false,
            history: history as unknown as History,
        }),
    ],
})

type StackStatus = 'unlocked' | 'backup' | 'locked' | 'error'

// Deadlines survive browser suspension; visibility changes never extend them.
const useAutoLock = (hasSession: boolean) => {
    useEffect(() => {
        if (!hasSession) return
        let timeoutId: ReturnType<typeof setTimeout>
        const schedule = () => {
            clearTimeout(timeoutId)
            const state = useWalletStore.getState()
            if (!state.checkSessionDeadline()) return
            timeoutId = setTimeout(() => state.checkSessionDeadline(), Math.max(0, (state.sessionExpiresAt ?? 0) - Date.now()))
        }
        const activity = () => {
            useWalletStore.getState().touchSession()
            schedule()
        }
        const resume = () => {
            if (document.visibilityState === 'visible') schedule()
        }
        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'touchmove', 'click', 'wheel']
        events.forEach(event => window.addEventListener(event, activity, { passive: true }))
        document.addEventListener('visibilitychange', resume)
        window.addEventListener('pageshow', schedule)
        schedule()
        return () => {
            clearTimeout(timeoutId)
            events.forEach(event => window.removeEventListener(event, activity))
            document.removeEventListener('visibilitychange', resume)
            window.removeEventListener('pageshow', schedule)
        }
    }, [hasSession])
}

// Component that manages a single stack with proper cleanup
const StackManager = ({ status }: { status: StackStatus }) => {
    const [stackData, setStackData] = useState<{
        Stack: ReturnType<typeof stackflow>['Stack']
        history: CleanableHistory
    } | null>(null)

    useEffect(() => {
        // Create new history and stack
        const history = new CleanableHistory()
        history.reset()
        history.startBrowserSync()

        let stack: ReturnType<typeof stackflow>
        switch (status) {
            case 'unlocked':
                stack = createAuthenticatedStack(history)
                break
            case 'backup':
                stack = createBackupStack(history)
                break
            default:
                stack = createUnauthenticatedStack(history)
        }

        setStackData({ Stack: stack.Stack, history })

        // Cleanup when unmounting or status changes
        return () => {
            history.destroy()
        }
    }, [status])

    if (!stackData) {
        return null
    }

    return <stackData.Stack />
}

export const Stack = () => {
    const status = useWalletStore(state => state.status)

    // Auto-lock after 2 minutes of inactivity when wallet is unlocked
    useAutoLock(status === 'unlocked' || status === 'backup')

    if (status === 'loading') {
        return null
    }

    const effectiveStatus: StackStatus = status === 'unlocked' ? 'unlocked' : status === 'backup' ? 'backup' : status === 'error' ? 'error' : 'locked'

    return (
        <RootCtx.Provider value={{ isNotIos, useWebRenderer, theme }}>
            <StackManager key={effectiveStatus} status={effectiveStatus} />
        </RootCtx.Provider>
    )
}

// Type exports for navigation
export type TypeActivities = {
    ShowPhrasePage: typeof ShowPhrasePage
    DashboardPage: typeof DashboardPage
    SettingsPage: typeof SettingsPage
    ToggleBiometricPage: typeof ToggleBiometricPage
    DeleteWalletPage: typeof DeleteWalletPage
    TokenDetailPage: typeof TokenDetailPage
    ScanQrCodePage: typeof ScanQrCodePage
    WelcomePage: typeof WelcomePage
    CreateWalletPage: typeof CreateWalletPage
    ImportWalletPage: typeof ImportWalletPage
    BackupPhrasePage: typeof BackupPhrasePage
    TxSubmitPage: typeof TxSubmitPage
}