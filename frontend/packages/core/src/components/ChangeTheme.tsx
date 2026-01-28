import { FamilyDrawerAnimatedContent, FamilyDrawerAnimatedWrapper, FamilyDrawerButton, FamilyDrawerClose, FamilyDrawerContent, FamilyDrawerOverlay, FamilyDrawerPortal, FamilyDrawerRoot, FamilyDrawerViewContent, useTheme, ViewsRegistry } from "@project/ui";
import { Moon, Sun, SunMoon } from "lucide-react";
import { useState } from "react";

export interface ChangeThemeProps {
    children: (open: () => void) => React.ReactNode
}

function MinimalView() {
    const { theme, setTheme } = useTheme()
    return (
        <>
            <header className="mb-2.5 flex h-[72px] items-center pl-2">
                <h2 className="text-[19px] font-semibold text-foreground md:font-medium">
                    Change Theme
                </h2>
            </header>
            <div className="space-y-3">
                <FamilyDrawerButton aria-selected={theme === 'light'} onClick={() => setTheme('light')}>
                    <Sun className="h-5 w-5" />
                    Light
                </FamilyDrawerButton>
                <FamilyDrawerButton aria-selected={theme === 'dark'} onClick={() => setTheme('dark')}>
                    <Moon className="h-5 w-5" />
                    Dark
                </FamilyDrawerButton>
                <FamilyDrawerButton aria-selected={theme === 'system'} onClick={() => setTheme('system')}>
                    <SunMoon className="h-5 w-5" />
                    System
                </FamilyDrawerButton>
            </div>
        </>

    )
}

const minimalViews: ViewsRegistry = {
    default: MinimalView,
}

export function ChangeTheme({ children }: ChangeThemeProps) {
    const [open, setOpen] = useState(false)
    return (
        <>
            {children(() => setOpen(true))}
            <FamilyDrawerRoot views={minimalViews} open={open} onOpenChange={setOpen}>
                <FamilyDrawerPortal>
                    <FamilyDrawerOverlay />
                    <FamilyDrawerContent>
                        <FamilyDrawerClose />
                        <FamilyDrawerAnimatedWrapper>
                            <FamilyDrawerAnimatedContent>
                                <FamilyDrawerViewContent />
                            </FamilyDrawerAnimatedContent>
                        </FamilyDrawerAnimatedWrapper>
                    </FamilyDrawerContent>
                </FamilyDrawerPortal>
            </FamilyDrawerRoot>
        </>
    )
}