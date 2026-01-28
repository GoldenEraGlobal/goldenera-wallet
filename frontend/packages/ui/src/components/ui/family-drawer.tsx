import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import clsx from "clsx"
import { AnimatePresence, motion } from "motion/react"
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import useMeasure from "react-use-measure"
import { Drawer } from "vaul-base"

// ============================================================================
// Types
// ============================================================================

type ViewComponent = React.ComponentType<Record<string, unknown>>

interface ViewsRegistry {
  [viewName: string]: ViewComponent
}

// ============================================================================
// Context
// ============================================================================

interface FamilyDrawerContextValue {
  isOpen: boolean
  view: string
  setView: (view: string) => void
  opacityDuration: number
  elementRef: ReturnType<typeof useMeasure>[0]
  bounds: ReturnType<typeof useMeasure>[1]
  views: ViewsRegistry | undefined
}

const FamilyDrawerContext = createContext<FamilyDrawerContextValue | undefined>(
  undefined
)

function useFamilyDrawer() {
  const context = useContext(FamilyDrawerContext)
  if (!context) {
    throw new Error(
      "FamilyDrawer components must be used within FamilyDrawerRoot"
    )
  }
  return context
}

// ============================================================================
// Root Component
// ============================================================================

interface FamilyDrawerRootProps {
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  defaultView?: string
  onViewChange?: (view: string) => void
  views?: ViewsRegistry
}

function FamilyDrawerRoot({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  defaultView = "default",
  onViewChange,
  views: customViews,
}: FamilyDrawerRootProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [view, setView] = useState(defaultView)
  const [elementRef, bounds] = useMeasure()
  const previousHeightRef = useRef<number>(0)

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = onOpenChange || setInternalOpen

  const opacityDuration = useMemo(() => {
    const currentHeight = bounds.height
    const previousHeight = previousHeightRef.current

    const MIN_DURATION = 0.15
    const MAX_DURATION = 0.27

    if (!previousHeightRef.current) {
      previousHeightRef.current = currentHeight
      return MIN_DURATION
    }

    const heightDifference = Math.abs(currentHeight - previousHeight)
    previousHeightRef.current = currentHeight

    const duration = Math.min(
      Math.max(heightDifference / 500, MIN_DURATION),
      MAX_DURATION
    )

    return duration
  }, [bounds.height])

  const handleViewChange = (newView: string) => {
    setView(newView)
    onViewChange?.(newView)
  }

  // Use custom views if provided, otherwise pass undefined
  const views =
    customViews && Object.keys(customViews).length > 0 ? customViews : undefined

  const contextValue: FamilyDrawerContextValue = {
    isOpen,
    view,
    setView: handleViewChange,
    opacityDuration,
    elementRef,
    bounds,
    views,
  }

  return (
    <FamilyDrawerContext.Provider value={contextValue}>
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        {children}
      </Drawer.Root>
    </FamilyDrawerContext.Provider>
  )
}

// ============================================================================
// Trigger Component
// ============================================================================

interface FamilyDrawerTriggerProps extends useRender.ComponentProps<'button'> {
}

function FamilyDrawerTrigger(props: FamilyDrawerTriggerProps) {
  const { render, ...otherProps } = props;

  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>({
      className: clsx(
        "fixed top-1/2 left-1/2 antialiased -translate-y-1/2 -translate-x-1/2 h-[44px] rounded-full border bg-background px-4 py-2 font-medium text-foreground transition-colors hover:bg-accent focus-visible:shadow-focus-ring-button md:font-medium cursor-pointer",
      ),
      type: 'button'
    }, otherProps),
  });

  return <Drawer.Trigger render={element} />;
}

// ============================================================================
// Portal Component
// ============================================================================

function FamilyDrawerPortal({ children }: { children: ReactNode }) {
  return <Drawer.Portal>{children}</Drawer.Portal>
}

// ============================================================================
// Overlay Component
// ============================================================================

interface FamilyDrawerOverlayProps {
  className?: string
  onClick?: () => void
}

function FamilyDrawerOverlay({ className, onClick }: FamilyDrawerOverlayProps) {
  const { setView } = useFamilyDrawer()

  return (
    <Drawer.Overlay
      className={clsx("fixed inset-0 z-50 bg-black/30", className)}
      onClick={onClick || (() => setView("default"))}
    />
  )
}

// ============================================================================
// Content Component
// ============================================================================

interface FamilyDrawerContentProps extends useRender.ComponentProps<'div'> {
  children: ReactNode
}

function FamilyDrawerContent(props: FamilyDrawerContentProps) {
  const { render, children, ...otherProps } = props;
  const { bounds } = useFamilyDrawer()

  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({
      className: clsx(
        "fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[361px] overflow-hidden rounded-[36px] bg-background outline-none md:mx-auto md:w-full",
      ),
    }, otherProps),
  });

  return (
    <Drawer.Content render={element}>
      <motion.div
        animate={{
          height: bounds.height,
          transition: {
            duration: 0.27,
            ease: [0.25, 1, 0.5, 1],
          },
        }}
      >
        {children}
      </motion.div>
    </Drawer.Content>
  );
}

// ============================================================================
// Animated Wrapper Component
// ============================================================================

interface FamilyDrawerAnimatedWrapperProps {
  children: ReactNode
  className?: string
}

function FamilyDrawerAnimatedWrapper({
  children,
  className,
}: FamilyDrawerAnimatedWrapperProps) {
  const { elementRef } = useFamilyDrawer()

  return (
    <div
      ref={elementRef}
      className={clsx("px-6 pb-6 pt-2.5 antialiased", className)}
    >
      {children}
    </div>
  )
}

// ============================================================================
// Animated Content Component
// ============================================================================

interface FamilyDrawerAnimatedContentProps {
  children: ReactNode
}

function FamilyDrawerAnimatedContent({
  children,
}: FamilyDrawerAnimatedContentProps) {
  const { view, opacityDuration } = useFamilyDrawer()

  return (
    <AnimatePresence initial={false} mode="popLayout" custom={view}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        key={view}
        transition={{
          duration: opacityDuration,
          ease: [0.26, 0.08, 0.25, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// ============================================================================
// Close Component
// ============================================================================

interface FamilyDrawerCloseProps extends useRender.ComponentProps<'button'> {
}

function FamilyDrawerClose(props: FamilyDrawerCloseProps) {
  const { render, children, ...otherProps } = props;

  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>({
      className: clsx(
        "absolute right-8 top-7 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-75 cursor-pointer",
      ),
      ...{ 'data-vaul-no-drag': '' },
      type: 'button'
    }, otherProps),
  });

  return (
    <Drawer.Close render={element}>
      {children || <CloseIcon />}
    </Drawer.Close>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface FamilyDrawerHeaderProps {
  icon: ReactNode
  title: string
  description: string
  className?: string
}

function FamilyDrawerHeader({
  icon,
  title,
  description,
  className,
}: FamilyDrawerHeaderProps) {
  return (
    <header className={clsx("mt-[21px]", className)}>
      {icon}
      <h2 className="mt-2.5 text-[22px] font-semibold text-foreground md:font-medium">
        {title}
      </h2>
      <p className="mt-3 text-[17px] font-medium leading-[24px] text-muted-foreground md:font-normal">
        {description}
      </p>
    </header>
  )
}

interface FamilyDrawerButtonProps extends useRender.ComponentProps<'button'> {
}

function FamilyDrawerButton(props: FamilyDrawerButtonProps) {
  const { render, ...otherProps } = props;

  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>({
      className: clsx(
        "flex h-12 w-full items-center gap-[15px] rounded-[16px] bg-muted px-4 text-md font-medium text-foreground transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-95 md:font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground",
      ),
      ...{ 'data-vaul-no-drag': '' },
      type: 'button'
    }, otherProps),
  });

  return element;
}

interface FamilyDrawerSecondaryButtonProps extends useRender.ComponentProps<'button'> {
}

function FamilyDrawerSecondaryButton(props: FamilyDrawerSecondaryButtonProps) {
  const { render, ...otherProps } = props;

  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>({
      className: clsx(
        "flex h-12 w-full items-center justify-center gap-[15px] rounded-full text-center text-[19px] font-semibold transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-95 md:font-medium cursor-pointer",
      ),
      ...{ 'data-vaul-no-drag': '' },
      type: 'button'
    }, otherProps),
  });

  return element;
}

// ============================================================================
// View Content Renderer
// ============================================================================

interface FamilyDrawerViewContentProps {
  views?: ViewsRegistry
}

function FamilyDrawerViewContent(
  {
    views: propViews,
  }: FamilyDrawerViewContentProps = {} as FamilyDrawerViewContentProps
) {
  const { view, views: contextViews } = useFamilyDrawer()

  // Use prop views first, then context views
  const views = propViews || contextViews

  if (!views) {
    throw new Error(
      "FamilyDrawerViewContent requires views to be provided via props or FamilyDrawerRoot"
    )
  }

  const ViewComponent = views[view]

  if (!ViewComponent) {
    // Fallback to default view if view not found
    const DefaultComponent = views.default
    return DefaultComponent ? <DefaultComponent /> : null
  }

  return <ViewComponent />
}

// ============================================================================
// Icons
// ============================================================================

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Close Icon</title>
      <path
        d="M10.4854 1.99998L2.00007 10.4853"
        stroke="#999999"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.4854 10.4844L2.00007 1.99908"
        stroke="#999999"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ============================================================================
// Exports
// ============================================================================

export {
  FamilyDrawerAnimatedContent, FamilyDrawerAnimatedWrapper, FamilyDrawerButton, FamilyDrawerClose, FamilyDrawerContent, FamilyDrawerHeader, FamilyDrawerOverlay, FamilyDrawerPortal, FamilyDrawerRoot, FamilyDrawerSecondaryButton, FamilyDrawerTrigger, FamilyDrawerViewContent,
  useFamilyDrawer, type ViewComponent, type ViewsRegistry
}

