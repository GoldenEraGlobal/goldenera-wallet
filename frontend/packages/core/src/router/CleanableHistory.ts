import { createMemoryHistory, type History } from 'history'
import { createUuid } from '../utils/UuidUtil'

const STATE_KEY = 'goldeneraWalletStack'
const STATE_SCHEMA = 'goldenera-wallet-stack'
const STATE_VERSION = 1

export type StackRealm = 'authenticated' | 'backup' | 'unauthenticated'

interface StackHistoryMetadata {
    schema: typeof STATE_SCHEMA
    version: typeof STATE_VERSION
    realm: StackRealm
    instanceId: string
    ordinal: number
}

type NamespacedHistoryState = Record<string, unknown> & {
    [STATE_KEY]: StackHistoryMetadata
}

const createInstanceId = () => createUuid()

const metadataFrom = (value: unknown): StackHistoryMetadata | null => {
    if (!value || typeof value !== 'object') return null
    const metadata = (value as Record<string, unknown>)[STATE_KEY]
    if (!metadata || typeof metadata !== 'object') return null
    const record = metadata as Partial<StackHistoryMetadata>
    if (record.schema !== STATE_SCHEMA || record.version !== STATE_VERSION ||
        (record.realm !== 'authenticated' && record.realm !== 'backup' && record.realm !== 'unauthenticated') ||
        typeof record.instanceId !== 'string' || !record.instanceId ||
        !Number.isSafeInteger(record.ordinal) || Number(record.ordinal) < 0) return null
    return record as StackHistoryMetadata
}

/**
 * A memory history mirrored into browser history without adopting routes from a
 * different authentication realm or a stale app instance.
 */
export class CleanableHistory {
    private readonly history: History
    private readonly realm: StackRealm
    private readonly instanceId = createInstanceId()
    private popstateHandler: ((event: PopStateEvent) => void) | null = null
    private listeners = new Set<() => void>()
    private rootLocationState: unknown = null
    private ordinal = 0
    private maxOrdinal = 0

    constructor(realm: StackRealm) {
        this.realm = realm
        this.history = createMemoryHistory()
    }

    private metadata(): StackHistoryMetadata {
        return {
            schema: STATE_SCHEMA,
            version: STATE_VERSION,
            realm: this.realm,
            instanceId: this.instanceId,
            ordinal: this.ordinal,
        }
    }

    private state(existing: unknown): NamespacedHistoryState {
        const state = existing && typeof existing === 'object'
            ? { ...(existing as Record<string, unknown>) }
            : {}
        return { ...state, [STATE_KEY]: this.metadata() } as NamespacedHistoryState
    }

    private browserUrl(pathname = this.history.location.pathname) {
        return `${window.location.pathname}#${pathname}`
    }

    private replaceBrowserEntry(pathname = this.history.location.pathname) {
        window.history.replaceState(this.state(window.history.state), '', this.browserUrl(pathname))
    }

    private normalizeForeignEntry() {
        this.ordinal = 0
        this.maxOrdinal = 0
        // HistorySyncController stores its serialized activity/ordinal state on
        // the memory-history location. Replacing only the pathname would erase
        // that state and make its next sync pass fail before it can restamp the
        // active realm root.
        this.history.replace('/', this.rootLocationState ?? this.history.location.state)
        this.replaceBrowserEntry('/')
    }

    startBrowserSync() {
        if (typeof window === 'undefined' || this.popstateHandler) return
        this.replaceBrowserEntry()
        this.popstateHandler = (event: PopStateEvent) => {
            const metadata = metadataFrom(event.state)
            const isCurrentRealmEntry = metadata?.realm === this.realm &&
                metadata.instanceId === this.instanceId &&
                metadata.ordinal <= this.maxOrdinal

            if (!isCurrentRealmEntry) {
                // Never adopt a route from another auth realm, a prior app
                // instance, or an entry without a validated ordinal.
                this.normalizeForeignEntry()
                return
            }

            const nextOrdinal = metadata.ordinal
            const delta = nextOrdinal - this.ordinal
            this.ordinal = nextOrdinal
            if (delta !== 0) this.history.go(delta)
        }
        window.addEventListener('popstate', this.popstateHandler)
    }

    stopBrowserSync() {
        if (this.popstateHandler && typeof window !== 'undefined') {
            window.removeEventListener('popstate', this.popstateHandler)
            this.popstateHandler = null
        }
    }

    get action() { return this.history.action }
    get location() { return this.history.location }

    push(...args: Parameters<History['push']>) {
        this.history.push(...args)
        if (typeof window !== 'undefined') {
            this.ordinal++
            this.maxOrdinal = this.ordinal
            window.history.pushState(
                this.state(window.history.state),
                '',
                this.browserUrl(),
            )
        }
    }

    replace(...args: Parameters<History['replace']>) {
        this.history.replace(...args)
        if (this.ordinal === 0 && this.history.location.state !== null) {
            this.rootLocationState = this.history.location.state
        }
        if (typeof window !== 'undefined') this.replaceBrowserEntry()
    }

    go(delta: number) {
        if (typeof window !== 'undefined') {
            window.history.go(delta)
        } else {
            this.ordinal += delta
            this.history.go(delta)
        }
    }

    back() {
        if (typeof window !== 'undefined') {
            if (this.ordinal > 0) window.history.back()
            return
        }
        if (this.ordinal > 0) this.ordinal--
        this.history.back()
    }

    forward() {
        if (typeof window !== 'undefined') {
            window.history.forward()
            return
        }
        this.ordinal++
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

    destroy() {
        this.stopBrowserSync()
        this.listeners.forEach(unlisten => unlisten())
        this.listeners.clear()
    }

    reset() {
        this.ordinal = 0
        this.maxOrdinal = 0
        this.history.replace('/', this.rootLocationState ?? this.history.location.state)
        if (typeof window !== 'undefined') this.replaceBrowserEntry('/')
    }
}
