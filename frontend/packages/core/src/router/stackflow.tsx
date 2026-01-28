import { basicUIPlugin } from "@stackflow/plugin-basic-ui";
import { historySyncPlugin } from "@stackflow/plugin-history-sync";
import { basicRendererPlugin } from "@stackflow/plugin-renderer-basic";
import { webRendererPlugin } from "@stackflow/plugin-renderer-web";
import { stackflow } from "@stackflow/react";
import { createMemoryHistory, type History } from "history";
import { useEffect, useState } from "react";
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
} from "../pages";
import { TxSubmitPage } from "../pages/TxSubmitPage";
import { useWalletStore } from "../store/WalletStore";
import {
    getTheme,
    isNotIos as isNotIosPlatform,
    shouldUseWebRenderer
} from "../utils/PlatformUtil";
import { RootCtx } from "./RootContext";

export const TRANSITION_DURATION = 270
const AUTO_LOCK_TIMEOUT = 2 * 60 * 1000

const useWebRenderer = shouldUseWebRenderer();
const isNotIos = isNotIosPlatform();
const theme = getTheme();

const basePlugins = [
    useWebRenderer ? webRendererPlugin() : basicRendererPlugin(),
    basicUIPlugin({
        rootClassName: `root-ui theme-${theme}`,
        theme,
    })
];
const transitionDuration = useWebRenderer ? 0 : TRANSITION_DURATION

// Custom history wrapper that can be properly cleaned up
class CleanableHistory {
    private history: History
    private popstateHandler: ((event: PopStateEvent) => void) | null = null
    private listeners: Set<() => void> = new Set()
    private historyIndex = 0 // Track our position in browser history

    constructor() {
        this.history = createMemoryHistory()
    }

    // Sync with browser for back/forward button support
    startBrowserSync() {
        if (typeof window !== 'undefined') {
            // Initialize browser history state with index
            window.history.replaceState({ index: this.historyIndex }, '', window.location.href)

            this.popstateHandler = (event: PopStateEvent) => {
                const newIndex = event.state?.index ?? 0
                const delta = newIndex - this.historyIndex

                if (delta < 0) {
                    // Going back
                    this.history.go(delta)
                } else if (delta > 0) {
                    // Going forward
                    this.history.go(delta)
                }

                this.historyIndex = newIndex
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
                { index: this.historyIndex },
                '',
                window.location.pathname + '#' + this.history.location.pathname
            )
        }
    }

    replace(...args: Parameters<History['replace']>) {
        this.history.replace(...args)
        if (typeof window !== 'undefined') {
            window.history.replaceState(
                { index: this.historyIndex },
                '',
                window.location.pathname + '#' + this.history.location.pathname
            )
        }
    }

    go(delta: number) {
        this.history.go(delta)
    }

    back() {
        this.history.back()
    }

    forward() {
        this.history.forward()
    }

    listen(listener: Parameters<History['listen']>[0]) {
        const unlisten = this.history.listen(listener)
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
                { index: this.historyIndex },
                '',
                window.location.pathname + '#/'
            )
        }
    }
}

// Stack factory functions
const createAuthenticatedStack = (history: CleanableHistory) => {
    return stackflow({
        transitionDuration,
        activities: {
            ShowPhrasePage,
            DashboardPage,
            SettingsPage,
            ToggleBiometricPage,
            DeleteWalletPage,
            TokenDetailPage,
            ScanQrCodePage,
            TxSubmitPage
        },
        plugins: [
            ...basePlugins,
            historySyncPlugin({
                routes: {
                    DashboardPage: "/",
                    ShowPhrasePage: "/show-phrase",
                    SettingsPage: "/settings",
                    DeleteWalletPage: "/delete-wallet",
                    ScanQrCodePage: "/scan-qr-code",
                    ToggleBiometricPage: "/toggle-biometric",
                    TokenDetailPage: "/token/:tokenAddress",
                    TxSubmitPage: '/tx-submit'
                },
                fallbackActivity: () => 'DashboardPage',
                useHash: false, // No hash needed with memory history
                history: history as unknown as History
            })
        ]
    })
}

const createUnauthenticatedStack = (history: CleanableHistory) => {
    return stackflow({
        transitionDuration,
        activities: {
            WelcomePage,
            CreateWalletPage,
            ImportWalletPage
        },
        plugins: [
            ...basePlugins,
            historySyncPlugin({
                routes: {
                    WelcomePage: "/",
                    CreateWalletPage: "/create-wallet",
                    ImportWalletPage: "/import-wallet",
                },
                fallbackActivity: () => 'WelcomePage',
                useHash: false,
                history: history as unknown as History
            })
        ]
    })
}

const createBackupStack = (history: CleanableHistory) => {
    return stackflow({
        transitionDuration,
        activities: {
            BackupPhrasePage
        },
        plugins: [
            ...basePlugins,
            historySyncPlugin({
                routes: {
                    BackupPhrasePage: "/",
                },
                fallbackActivity: () => 'BackupPhrasePage',
                useHash: false,
                history: history as unknown as History
            })
        ]
    })
}

type StackStatus = 'unlocked' | 'backup' | 'locked'

// Hook to handle auto-lock after inactivity
const useAutoLock = (isUnlocked: boolean) => {
    const lockWallet = useWalletStore(state => state.lockWallet)

    useEffect(() => {
        // Only run auto-lock when wallet is unlocked
        if (!isUnlocked) {
            return
        }

        let timeoutId: ReturnType<typeof setTimeout>

        const resetTimer = () => {
            clearTimeout(timeoutId)
            timeoutId = setTimeout(() => {
                console.log('Auto-locking wallet due to inactivity')
                lockWallet()
            }, AUTO_LOCK_TIMEOUT)
        }

        // Events that indicate user activity
        const activityEvents = [
            'mousedown',
            'mousemove',
            'keydown',
            'scroll',
            'touchstart',
            'touchmove',
            'click',
            'wheel'
        ]

        // Add listeners for all activity events
        activityEvents.forEach(event => {
            window.addEventListener(event, resetTimer, { passive: true })
        })

        // Also reset on visibility change (user switches back to tab)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                resetTimer()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        // Start the initial timer
        resetTimer()

        // Cleanup
        return () => {
            clearTimeout(timeoutId)
            activityEvents.forEach(event => {
                window.removeEventListener(event, resetTimer)
            })
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [isUnlocked, lockWallet])
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
    useAutoLock(status === 'unlocked')

    if (status === 'loading') {
        return null
    }

    const effectiveStatus: StackStatus = status === 'unlocked' ? 'unlocked' : status === 'backup' ? 'backup' : 'locked'

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