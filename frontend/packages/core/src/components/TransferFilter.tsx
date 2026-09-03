import type { GetTransfersTransferTypeKey } from '@project/api'
import { getTransfersTransferType } from '@project/api'
import type { ViewsRegistry } from '@project/ui'
import { FamilyDrawerAnimatedContent, FamilyDrawerAnimatedWrapper, FamilyDrawerButton, FamilyDrawerClose, FamilyDrawerContent, FamilyDrawerOverlay, FamilyDrawerPortal, FamilyDrawerRoot, FamilyDrawerViewContent } from '@project/ui'
import { ArrowRightLeft, Flame, ListFilter, Receipt, Sparkles, Trophy } from 'lucide-react'
import { createContext, useCallback, useContext, useState } from 'react'
import { useUncontrolledProp } from 'uncontrollable'

export interface TransferFilterProps {
    children: (open: () => void) => React.ReactNode
    filter?: GetTransfersTransferTypeKey
    onFilterChange?: (filter?: GetTransfersTransferTypeKey) => void
}

const TransferFilterContext = createContext<{ filter?: GetTransfersTransferTypeKey, setFilter: (filter?: GetTransfersTransferTypeKey) => void }>({ filter: undefined, setFilter: () => { } })

function MinimalView() {
    const { filter, setFilter } = useContext(TransferFilterContext)
    return (
        <>
            <header className="mb-2.5 flex h-[72px] items-center pl-2">
                <h2 className="text-[19px] font-semibold text-foreground md:font-medium">
                    Transfer Filter
                </h2>
            </header>
            <div className="space-y-3">
                <FamilyDrawerButton aria-selected={!filter} onClick={() => setFilter(undefined)}>
                    <ListFilter className="h-5 w-5" />
                    All
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersTransferType.TRANSFER === filter}
                    onClick={() => setFilter(getTransfersTransferType.TRANSFER)}>
                    <ArrowRightLeft className="h-5 w-5" />
                    Transfer
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersTransferType.BURN === filter}
                    onClick={() => setFilter(getTransfersTransferType.BURN)}>
                    <Flame className="h-5 w-5" />
                    Burn
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersTransferType.MINT === filter}
                    onClick={() => setFilter(getTransfersTransferType.MINT)}>
                    <Sparkles className="h-5 w-5" />
                    Mint
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersTransferType.BLOCK_FEES === filter}
                    onClick={() => setFilter(getTransfersTransferType.BLOCK_FEES)}>
                    <Receipt className="h-5 w-5" />
                    Block fees
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersTransferType.BLOCK_REWARD === filter}
                    onClick={() => setFilter(getTransfersTransferType.BLOCK_REWARD)}>
                    <Trophy className="h-5 w-5" />
                    Block reward
                </FamilyDrawerButton>
            </div>
        </>

    )
}

const minimalViews: ViewsRegistry = {
    default: MinimalView,
}

export function TransferFilter({ children, filter: filterProp, onFilterChange }: TransferFilterProps) {
    const [open, setOpen] = useState(false)

    const onChange = useCallback((filter?: GetTransfersTransferTypeKey) => {
        onFilterChange?.(filter)
        setOpen(false)
    }, [onFilterChange])

    const [filter, setFilter] = useUncontrolledProp(filterProp, undefined, onChange)

    return (
        <TransferFilterContext.Provider value={{ filter, setFilter }}>
            {children(() => setOpen(true))}
            <FamilyDrawerRoot
                views={minimalViews}
                open={open}
                onOpenChange={setOpen}
                title="Transfer filter"
                description="Choose which transfer types to display"
            >
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
        </TransferFilterContext.Provider>
    )
}
