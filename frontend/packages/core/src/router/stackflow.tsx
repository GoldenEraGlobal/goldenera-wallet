import './activities'
import { defineConfig } from '@stackflow/config'
import { basicUIPlugin } from '@stackflow/plugin-basic-ui'
import { historySyncPlugin } from '@stackflow/plugin-history-sync'
import { basicRendererPlugin } from '@stackflow/plugin-renderer-basic'
import { webRendererPlugin } from '@stackflow/plugin-renderer-web'
import { stackflow } from '@stackflow/react'
import type { History } from 'history'
import { useEffect, useState } from 'react'
import {
    BackupPhrasePage,
    BipCreatePage,
    BipDetailPage,
    CreateWalletPage,
    DashboardPage,
    DeleteWalletPage,
    ImportWalletPage,
    GovernancePage,
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
import { CleanableHistory, type StackRealm } from './CleanableHistory'
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

// All components are available to the renderer; each config registers only the
// activities that belonged to that auth/backup stack before the v2 migration.
const components = {
    ShowPhrasePage, DashboardPage, SettingsPage, ToggleBiometricPage,
    DeleteWalletPage, TokenDetailPage, ScanQrCodePage, TxSubmitPage,
    GovernancePage, BipCreatePage, BipDetailPage,
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
        { name: 'GovernancePage', route: '/governance' },
        { name: 'BipCreatePage', route: '/governance/create' },
        { name: 'BipDetailPage', route: '/governance/bip/:hash' },
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
        // Create a realm-bound history so browser Back/Forward can never adopt
        // authenticated routes into a locked or backup stack.
        const realm: StackRealm = status === 'unlocked'
            ? 'authenticated'
            : status === 'backup'
                ? 'backup'
                : 'unauthenticated'
        const history = new CleanableHistory(realm)
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
    GovernancePage: typeof GovernancePage
    BipCreatePage: typeof BipCreatePage
    BipDetailPage: typeof BipDetailPage
}
