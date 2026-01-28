import * as React from "react"
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react"
import { cn } from "../../lib/utils"
import { Spinner } from "./spinner"

// Pull-to-refresh configuration defaults
const DEFAULT_THRESHOLD = 80 // Distance required to trigger refresh
const DEFAULT_MAX_DISTANCE = 120 // Maximum pull distance
const DEFAULT_RESISTANCE_FACTOR = 0.4 // Resistance when pulling past threshold

// ============================================================================
// PullToRefresh Context
// ============================================================================

type RefreshCallback = () => Promise<void>

interface PullToRefreshContextValue {
    // Register a refresh callback, returns unregister function
    registerRefreshCallback: (id: string, callback: RefreshCallback) => () => void
    // Trigger all registered refresh callbacks
    triggerRefresh: () => Promise<void>
    // Whether refresh is in progress
    isRefreshing: boolean
    // Nested pull-to-refresh management
    registerNestedPTR: (id: string) => () => void
    setNestedActive: (id: string, active: boolean) => void
    isNestedActive: boolean
    // Depth level (0 = root, 1 = first nested, etc.)
    depth: number
    // Whether refresh is enabled (has onRefresh prop or registered callbacks)
    isRefreshEnabled: boolean
}

const PullToRefreshContext = createContext<PullToRefreshContextValue | null>(null)

// ============================================================================
// useOnRefresh Hook
// ============================================================================

/**
 * Hook to register a refresh callback that will be called when pull-to-refresh is triggered.
 * The callback will be automatically unregistered when the component unmounts.
 * 
 * @example
 * ```tsx
 * useOnRefresh(async () => {
 *   await refetchData()
 * })
 * ```
 */
export function useOnRefresh(callback: RefreshCallback) {
    const context = useContext(PullToRefreshContext)
    const id = useId()

    useEffect(() => {
        if (!context) {
            console.warn('useOnRefresh must be used within a PullToRefresh component')
            return
        }

        const unregister = context.registerRefreshCallback(id, callback)
        return unregister
    }, [context, id, callback])
}

/**
 * Hook to access the pull-to-refresh context state
 */
export function usePullToRefreshContext() {
    return useContext(PullToRefreshContext)
}

// ============================================================================
// PullToRefreshProvider (internal)
// ============================================================================

interface PullToRefreshProviderProps {
    children: React.ReactNode
    onRefresh?: RefreshCallback
    isRefreshing: boolean
    setIsRefreshing: (value: boolean) => void
}

function PullToRefreshProvider({
    children,
    onRefresh,
    isRefreshing,
    setIsRefreshing
}: PullToRefreshProviderProps) {
    const parentContext = useContext(PullToRefreshContext)
    const depth = parentContext ? parentContext.depth + 1 : 0

    // Store registered callbacks
    const callbacksRef = useRef<Map<string, RefreshCallback>>(new Map())

    // Store nested PTR instances
    const nestedPTRsRef = useRef<Set<string>>(new Set())
    const [activeNestedId, setActiveNestedId] = useState<string | null>(null)

    // Track if we have any registered callbacks
    const [hasCallbacks, setHasCallbacks] = useState(false)

    const registerRefreshCallback = useCallback((id: string, callback: RefreshCallback) => {
        callbacksRef.current.set(id, callback)
        setHasCallbacks(callbacksRef.current.size > 0)
        return () => {
            callbacksRef.current.delete(id)
            setHasCallbacks(callbacksRef.current.size > 0)
        }
    }, [])

    const triggerRefresh = useCallback(async () => {
        setIsRefreshing(true)
        try {
            // Call the main onRefresh prop if provided
            const promises: Promise<void>[] = []
            if (onRefresh) {
                promises.push(onRefresh())
            }

            // Call all registered callbacks
            for (const callback of callbacksRef.current.values()) {
                promises.push(callback())
            }

            await Promise.all(promises)
        } finally {
            setIsRefreshing(false)
        }
    }, [onRefresh, setIsRefreshing])

    // Check if refresh is enabled (either has onRefresh prop or registered callbacks)
    const isRefreshEnabled = !!onRefresh || hasCallbacks

    const registerNestedPTR = useCallback((id: string) => {
        nestedPTRsRef.current.add(id)
        return () => {
            nestedPTRsRef.current.delete(id)
            if (activeNestedId === id) {
                setActiveNestedId(null)
            }
        }
    }, [activeNestedId])

    const setNestedActive = useCallback((id: string, active: boolean) => {
        if (active) {
            setActiveNestedId(id)
            // Also notify parent context if we're nested
            if (parentContext) {
                parentContext.setNestedActive(id, true)
            }
        } else if (activeNestedId === id) {
            setActiveNestedId(null)
            if (parentContext) {
                parentContext.setNestedActive(id, false)
            }
        }
    }, [activeNestedId, parentContext])

    const contextValue: PullToRefreshContextValue = {
        registerRefreshCallback,
        triggerRefresh,
        isRefreshing,
        registerNestedPTR,
        setNestedActive,
        isNestedActive: activeNestedId !== null,
        depth,
        isRefreshEnabled
    }

    return (
        <PullToRefreshContext.Provider value={contextValue}>
            {children}
        </PullToRefreshContext.Provider>
    )
}

// ============================================================================
// usePullToRefresh Hook
// ============================================================================

interface UsePullToRefreshOptions {
    onRefresh?: RefreshCallback
    threshold?: number
    maxDistance?: number
    resistanceFactor?: number
}

interface UsePullToRefreshReturn {
    containerRef: React.RefObject<HTMLDivElement | null>
    pullDistance: number
    isRefreshing: boolean
    isPulling: boolean
    pullProgress: number
    spinnerOpacity: number
    spinnerScale: number
    spinnerRotation: number
    handlers: {
        onTouchStart: ((e: React.TouchEvent) => void) | undefined
        onTouchMove: ((e: React.TouchEvent) => void) | undefined
        onTouchEnd: (() => void) | undefined
    }
    containerStyle: React.CSSProperties
    setIsRefreshing: (value: boolean) => void
}

export function usePullToRefresh({
    onRefresh,
    threshold = DEFAULT_THRESHOLD,
    maxDistance = DEFAULT_MAX_DISTANCE,
    resistanceFactor = DEFAULT_RESISTANCE_FACTOR
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
    const [pullDistance, setPullDistance] = useState(0)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [isPulling, setIsPulling] = useState(false)
    const touchStartY = useRef(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const instanceId = useId()

    // Get parent context if nested
    const parentContext = useContext(PullToRefreshContext)

    // Register this PTR with parent if we're nested
    useEffect(() => {
        if (parentContext) {
            const unregister = parentContext.registerNestedPTR(instanceId)
            return unregister
        }
    }, [parentContext, instanceId])

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (!onRefresh || isRefreshing) return

        // If parent context has nested active (another nested PTR is active), don't start
        if (parentContext?.isNestedActive) return

        const scrollContainer = containerRef.current
        if (scrollContainer && scrollContainer.scrollTop <= 0) {
            touchStartY.current = e.touches[0].clientY
            setIsPulling(true)

            // Notify parent that we're active (to block sibling/parent PTRs)
            if (parentContext) {
                parentContext.setNestedActive(instanceId, true)
            }
        }
    }, [onRefresh, isRefreshing, parentContext, instanceId])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        // Completely ignore touch during refresh
        if (isRefreshing) return
        if (!isPulling || !onRefresh) return

        const scrollContainer = containerRef.current
        if (!scrollContainer || scrollContainer.scrollTop > 0) {
            setIsPulling(false)
            setPullDistance(0)
            // Notify parent we're no longer active
            if (parentContext) {
                parentContext.setNestedActive(instanceId, false)
            }
            return
        }

        const touchY = e.touches[0].clientY
        const diff = touchY - touchStartY.current

        if (diff > 0) {
            // Prevent parent scroll
            e.stopPropagation()

            // Apply resistance when pulling past threshold
            let distance = diff
            if (distance > threshold) {
                distance = threshold + (diff - threshold) * resistanceFactor
            }
            distance = Math.min(distance, maxDistance)
            setPullDistance(distance)
        }
    }, [isPulling, onRefresh, isRefreshing, threshold, maxDistance, resistanceFactor, parentContext, instanceId])

    const handleTouchEnd = useCallback(async () => {
        // Completely ignore touch during refresh
        if (isRefreshing) return
        if (!isPulling || !onRefresh) return

        // Notify parent we're no longer pulling
        if (parentContext) {
            parentContext.setNestedActive(instanceId, false)
        }

        if (pullDistance >= threshold) {
            setIsRefreshing(true)
            setIsPulling(false)
            setPullDistance(threshold) // Keep spinner visible during refresh

            try {
                await onRefresh()
            } finally {
                setIsRefreshing(false)
                setPullDistance(0)
            }
        } else {
            setPullDistance(0)
            setIsPulling(false)
        }
    }, [isPulling, pullDistance, onRefresh, isRefreshing, threshold, parentContext, instanceId])

    // Calculate spinner visual properties based on pull distance
    const pullProgress = Math.min(pullDistance / threshold, 1)
    const spinnerOpacity = isRefreshing ? 1 : pullProgress
    const spinnerScale = isRefreshing ? 1 : (0.5 + (pullProgress * 0.5))
    const spinnerRotation = pullProgress * 180

    // Container style with transform and scroll lock during refresh
    const containerStyle: React.CSSProperties = {
        transform: pullDistance > 0 ? `translateY(${pullDistance * 0.5}px)` : undefined,
        transition: isPulling ? 'none' : 'transform 0.3s ease-out',
        // Disable scroll during refresh
        overflowY: isRefreshing ? 'hidden' : undefined,
        touchAction: isRefreshing ? 'none' : undefined
    }

    // During refresh, disable all touch handlers to prevent any interference
    // Also disable if parent's nested PTR is active (but not us)
    const shouldDisableHandlers = isRefreshing || (parentContext?.isNestedActive && !isPulling)

    const activeHandlers = shouldDisableHandlers ? {
        onTouchStart: undefined,
        onTouchMove: undefined,
        onTouchEnd: undefined
    } : {
        onTouchStart: onRefresh ? handleTouchStart : undefined,
        onTouchMove: onRefresh ? handleTouchMove : undefined,
        onTouchEnd: onRefresh ? handleTouchEnd : undefined
    }

    return {
        containerRef,
        pullDistance,
        isRefreshing,
        isPulling,
        pullProgress,
        spinnerOpacity,
        spinnerScale,
        spinnerRotation,
        handlers: activeHandlers,
        containerStyle,
        setIsRefreshing
    }
}

// ============================================================================
// PullToRefreshIndicator Component (internal)
// ============================================================================

interface PullToRefreshIndicatorProps {
    isVisible: boolean
    isRefreshing: boolean
    isPulling: boolean
    pullDistance: number
    spinnerOpacity: number
    spinnerScale: number
    spinnerRotation: number
}

function PullToRefreshIndicator({
    isVisible,
    isRefreshing,
    isPulling,
    pullDistance,
    spinnerOpacity,
    spinnerScale,
    spinnerRotation
}: PullToRefreshIndicatorProps) {
    if (!isVisible) return null

    return (
        <div
            className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-50"
            style={{
                top: -40 + (pullDistance * 0.5),
                opacity: spinnerOpacity,
                transition: isPulling ? 'none' : 'all 0.3s ease-out'
            }}
        >
            <div
                className="bg-foreground backdrop-blur-sm rounded-full p-2 shadow-lg"
                style={{
                    transform: `scale(${spinnerScale}) rotate(${isRefreshing ? 0 : spinnerRotation}deg)`,
                    transition: isPulling ? 'none' : 'all 0.3s ease-out'
                }}
            >
                <Spinner
                    className={cn("size-6 text-background", isRefreshing && "animate-spin")}
                    style={{
                        animation: isRefreshing ? undefined : 'none'
                    }}
                />
            </div>
        </div>
    )
}

// ============================================================================
// PullToRefresh Component
// ============================================================================

interface PullToRefreshProps extends React.HTMLAttributes<HTMLDivElement> {
    onRefresh?: RefreshCallback
    threshold?: number
    maxDistance?: number
    resistanceFactor?: number
    children: React.ReactNode
}

/**
 * Inner component that renders the pull-to-refresh UI.
 * This uses context to check if refresh is enabled (either via onRefresh prop or useOnRefresh hooks).
 */
function PullToRefreshInner({
    onRefresh,
    threshold = DEFAULT_THRESHOLD,
    maxDistance = DEFAULT_MAX_DISTANCE,
    resistanceFactor = DEFAULT_RESISTANCE_FACTOR,
    children,
    className,
    style,
    ...props
}: PullToRefreshProps) {
    const context = useContext(PullToRefreshContext)
    const parentContext = useContext(PullToRefreshContext)

    const [pullDistance, setPullDistance] = useState(0)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [isPulling, setIsPulling] = useState(false)
    const touchStartY = useRef(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const instanceId = useId()

    // Check if refresh is enabled via context (includes registered callbacks)
    const isRefreshEnabled = context?.isRefreshEnabled ?? !!onRefresh

    // Register this PTR with parent if we're nested
    useEffect(() => {
        if (parentContext) {
            const unregister = parentContext.registerNestedPTR(instanceId)
            return unregister
        }
    }, [parentContext, instanceId])

    // Check if touch target is inside a drawer component
    const isTouchInsideDrawer = useCallback((target: EventTarget | null): boolean => {
        if (!target || !(target instanceof Element)) return false

        // Check for drawer-related data attributes
        const drawerSelectors = [
            '[data-slot="drawer"]',
            '[data-slot="drawer-content"]',
            '[data-slot="drawer-overlay"]',
            '[data-vaul-drawer]',
            '[data-vaul-drawer-visible]',
            '[vaul-drawer]'
        ]

        // Check if element or any parent matches drawer selectors
        let element: Element | null = target
        while (element) {
            for (const selector of drawerSelectors) {
                if (element.matches(selector)) {
                    return true
                }
            }
            element = element.parentElement
        }
        return false
    }, [])

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // Check if touch is inside a drawer element
        if (isTouchInsideDrawer(e.target)) return

        if (!isRefreshEnabled || isRefreshing) return

        // If parent context has nested active (another nested PTR is active), don't start
        if (parentContext?.isNestedActive) return

        const scrollContainer = containerRef.current
        if (scrollContainer && scrollContainer.scrollTop <= 0) {
            touchStartY.current = e.touches[0].clientY
            setIsPulling(true)

            // Notify parent that we're active (to block sibling/parent PTRs)
            if (parentContext) {
                parentContext.setNestedActive(instanceId, true)
            }
        }
    }, [isRefreshEnabled, isRefreshing, parentContext, instanceId, isTouchInsideDrawer])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        // Completely ignore touch during refresh
        if (isRefreshing) return
        if (!isPulling || !isRefreshEnabled) return

        const scrollContainer = containerRef.current
        if (!scrollContainer || scrollContainer.scrollTop > 0) {
            setIsPulling(false)
            setPullDistance(0)
            // Notify parent we're no longer active
            if (parentContext) {
                parentContext.setNestedActive(instanceId, false)
            }
            return
        }

        const touchY = e.touches[0].clientY
        const diff = touchY - touchStartY.current

        if (diff > 0) {
            // Prevent parent scroll
            e.stopPropagation()

            // Apply resistance when pulling past threshold
            let distance = diff
            if (distance > threshold) {
                distance = threshold + (diff - threshold) * resistanceFactor
            }
            distance = Math.min(distance, maxDistance)
            setPullDistance(distance)
        }
    }, [isPulling, isRefreshEnabled, isRefreshing, threshold, maxDistance, resistanceFactor, parentContext, instanceId])

    const handleTouchEnd = useCallback(async () => {
        // Completely ignore touch during refresh
        if (isRefreshing) return
        if (!isPulling || !isRefreshEnabled) return

        // Notify parent we're no longer pulling
        if (parentContext) {
            parentContext.setNestedActive(instanceId, false)
        }

        if (pullDistance >= threshold) {
            setIsRefreshing(true)
            setIsPulling(false)
            setPullDistance(threshold) // Keep spinner visible during refresh

            try {
                // Use context's triggerRefresh to call all callbacks including onRefresh
                if (context) {
                    await context.triggerRefresh()
                } else if (onRefresh) {
                    await onRefresh()
                }
            } finally {
                setIsRefreshing(false)
                setPullDistance(0)
            }
        } else {
            setPullDistance(0)
            setIsPulling(false)
        }
    }, [isPulling, pullDistance, isRefreshEnabled, isRefreshing, threshold, parentContext, instanceId, context, onRefresh])

    // Calculate spinner visual properties based on pull distance
    const pullProgress = Math.min(pullDistance / threshold, 1)
    const spinnerOpacity = isRefreshing ? 1 : pullProgress
    const spinnerScale = isRefreshing ? 1 : (0.5 + (pullProgress * 0.5))
    const spinnerRotation = pullProgress * 180

    // Container style with transform and scroll lock during refresh
    const containerStyle: React.CSSProperties = {
        transform: pullDistance > 0 ? `translateY(${pullDistance * 0.5}px)` : undefined,
        transition: isPulling ? 'none' : 'transform 0.3s ease-out',
        // Disable scroll and native overscroll during pull/refresh
        overflowY: isRefreshing ? 'hidden' : undefined,
        touchAction: isRefreshing ? 'none' : undefined,
        // Disable native overscroll behavior (bounce on iOS, glow on Android) during pull
        overscrollBehavior: (isPulling || isRefreshing) ? 'none' : undefined
    }

    // During refresh, disable all touch handlers to prevent any interference
    // Also disable if parent's nested PTR is active (but not us)
    const shouldDisableHandlers = isRefreshing || (parentContext?.isNestedActive && !isPulling)

    const handlers = shouldDisableHandlers ? {
        onTouchStart: undefined,
        onTouchMove: undefined,
        onTouchEnd: undefined
    } : {
        onTouchStart: isRefreshEnabled ? handleTouchStart : undefined,
        onTouchMove: isRefreshEnabled ? handleTouchMove : undefined,
        onTouchEnd: isRefreshEnabled ? handleTouchEnd : undefined
    }

    return (
        <div
            ref={containerRef}
            className={cn("relative", className)}
            onTouchStart={handlers.onTouchStart}
            onTouchMove={handlers.onTouchMove}
            onTouchEnd={handlers.onTouchEnd}
            style={{ ...containerStyle, ...style }}
            {...props}
        >
            <PullToRefreshIndicator
                isVisible={isRefreshEnabled && (pullDistance > 0 || isRefreshing)}
                isRefreshing={isRefreshing}
                isPulling={isPulling}
                pullDistance={pullDistance}
                spinnerOpacity={spinnerOpacity}
                spinnerScale={spinnerScale}
                spinnerRotation={spinnerRotation}
            />
            {children}
        </div>
    )
}

function PullToRefresh({
    onRefresh,
    threshold,
    maxDistance,
    resistanceFactor,
    children,
    className,
    style,
    ...props
}: PullToRefreshProps) {
    const [isRefreshing, setIsRefreshing] = useState(false)

    // Wrap with provider first, then render inner component
    // This allows inner component to access context for isRefreshEnabled check
    return (
        <PullToRefreshProvider
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            setIsRefreshing={setIsRefreshing}
        >
            <PullToRefreshInner
                onRefresh={onRefresh}
                threshold={threshold}
                maxDistance={maxDistance}
                resistanceFactor={resistanceFactor}
                className={className}
                style={style}
                {...props}
            >
                {children}
            </PullToRefreshInner>
        </PullToRefreshProvider>
    )
}

export { PullToRefresh, PullToRefreshContext }
