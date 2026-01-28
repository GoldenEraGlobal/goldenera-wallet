import { Capacitor } from '@capacitor/core'
import { cn, PullToRefresh } from "@project/ui"
import { AppScreen, AppScreenProps } from "@stackflow/plugin-basic-ui"
import { PropsWithChildren, useEffect } from "react"
import { DrawerDemo } from '../components/DevMenu'
import { useRootContext } from "../router/RootContext"
import { useFlow } from '../router/useFlow'

const isNative = Capacitor.isNativePlatform()

// ============================================================================
// Layouts
// ============================================================================

interface BasicLayoutProps extends AppScreenProps {
    transparent?: boolean
}

// Simple layout for onboarding/unlocked pages
export const BasicLayout = ({ children, transparent = false, ...props }: PropsWithChildren<BasicLayoutProps>) => {
    const { useWebRenderer } = useRootContext()
    useGlobalBg(!transparent)
    return (
        <div className={isNative ? 'is-native' : 'is-web'}>
            <AppScreen appBar={undefined} preventSwipeBack={useWebRenderer} {...props}>
                <div className={`flex flex-col w-full h-full min-h-0 pt-[env(safe-area-inset-top)] ${transparent ? 'bg-transparent' : 'bg-background'}`}>
                    <div className='flex-1 min-h-0 w-full overflow-y-auto'>
                        <div className='flex flex-col items-center justify-center min-h-full w-full p-6'>
                            {children}
                        </div>
                    </div>
                    <div className="fixed z-50 bottom-4 right-4">
                        <DrawerDemo />
                    </div>
                </div>
            </AppScreen>
        </div>
    )
}

interface AppLayoutProps extends AppScreenProps {
    title?: string
    backButton?: {
        onClick?: () => void
    }
    actionButton?: React.ReactNode
    leftContent?: React.ReactNode
    className?: string
    transparent?: boolean
    swipeBack?: boolean
    centered?: boolean
    padding?: boolean
    onRefresh?: () => Promise<void>
}

// Layout for authenticated pages with consistent header
export const AppLayout = ({
    children,
    title,
    backButton,
    actionButton,
    leftContent,
    className,
    transparent = false,
    swipeBack = true,
    centered = false,
    padding = true,
    onRefresh,
    ...props
}: PropsWithChildren<AppLayoutProps>) => {
    const { pop } = useFlow()
    const { useWebRenderer } = useRootContext()
    useGlobalBg(!transparent)

    return (
        <div className={isNative ? 'is-native' : 'is-web'}>
            <AppScreen
                appBar={{
                    title,
                    backButton: backButton ? {
                        onClick: backButton.onClick || (() => pop())
                    } : undefined,
                    renderRight: actionButton ? () => actionButton : undefined,
                    renderLeft: leftContent ? () => leftContent : undefined
                }}
                preventSwipeBack={useWebRenderer || !swipeBack}
                {...props}
            >
                <div className={cn('w-full h-full min-h-0 overflow-hidden flex flex-col', transparent ? 'bg-transparent' : 'bg-background')}>
                    <PullToRefresh
                        id='main-content'
                        onRefresh={onRefresh}
                        className={`flex flex-col overflow-y-auto w-full flex-1 min-h-0 ${className || ''}`}
                    >
                        <div className={`flex flex-col w-full flex-1 min-h-0 ${padding ? 'p-6' : ''} ${centered ? 'items-center justify-center' : ''}`}>
                            {children}
                            {padding && <div className="p-6"></div>}
                        </div>
                    </PullToRefresh>
                </div>
            </AppScreen>
        </div>
    )
}


const useGlobalBg = (enabled: boolean) => {
    useEffect(() => {
        if (enabled) {
            document.documentElement.classList.add('bg-background');
            document.body.classList.add('bg-background');
        } else {
            document.documentElement.classList.remove('bg-background');
            document.body.classList.remove('bg-background');
        }

        return () => {
            document.documentElement.classList.remove('bg-background');
            document.body.classList.remove('bg-background');
        }
    }, [enabled])
}