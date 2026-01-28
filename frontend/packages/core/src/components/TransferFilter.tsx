import { getTransfersQueryParamsTransferTypeEnum, GetTransfersQueryParamsTransferTypeEnumKey } from "@project/api";
import { FamilyDrawerAnimatedContent, FamilyDrawerAnimatedWrapper, FamilyDrawerButton, FamilyDrawerClose, FamilyDrawerContent, FamilyDrawerOverlay, FamilyDrawerPortal, FamilyDrawerRoot, FamilyDrawerViewContent, ViewsRegistry } from "@project/ui";
import { ArrowRightLeft, Flame, ListFilter, Receipt, Sparkles, Trophy } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { useUncontrolledProp } from "uncontrollable";

export interface TransferFilterProps {
    children: (open: () => void) => React.ReactNode
    filter?: GetTransfersQueryParamsTransferTypeEnumKey
    onFilterChange?: (filter?: GetTransfersQueryParamsTransferTypeEnumKey) => void
}

const TransferFilterContext = createContext<{ filter?: GetTransfersQueryParamsTransferTypeEnumKey, setFilter: (filter?: GetTransfersQueryParamsTransferTypeEnumKey) => void }>({ filter: undefined, setFilter: () => { } })

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
                    aria-selected={getTransfersQueryParamsTransferTypeEnum.TRANSFER === filter}
                    onClick={() => setFilter(getTransfersQueryParamsTransferTypeEnum.TRANSFER)}>
                    <ArrowRightLeft className="h-5 w-5" />
                    Transfer
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersQueryParamsTransferTypeEnum.BURN === filter}
                    onClick={() => setFilter(getTransfersQueryParamsTransferTypeEnum.BURN)}>
                    <Flame className="h-5 w-5" />
                    Burn
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersQueryParamsTransferTypeEnum.MINT === filter}
                    onClick={() => setFilter(getTransfersQueryParamsTransferTypeEnum.MINT)}>
                    <Sparkles className="h-5 w-5" />
                    Mint
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersQueryParamsTransferTypeEnum.BLOCK_FEES === filter}
                    onClick={() => setFilter(getTransfersQueryParamsTransferTypeEnum.BLOCK_FEES)}>
                    <Receipt className="h-5 w-5" />
                    Block fees
                </FamilyDrawerButton>
                <FamilyDrawerButton
                    aria-selected={getTransfersQueryParamsTransferTypeEnum.BLOCK_REWARD === filter}
                    onClick={() => setFilter(getTransfersQueryParamsTransferTypeEnum.BLOCK_REWARD)}>
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

    const onChange = useCallback((filter?: GetTransfersQueryParamsTransferTypeEnumKey) => {
        onFilterChange?.(filter)
        setOpen(false)
    }, [onFilterChange])

    const [filter, setFilter] = useUncontrolledProp(filterProp, undefined, onChange)

    return (
        <TransferFilterContext.Provider value={{ filter, setFilter }}>
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
        </TransferFilterContext.Provider>
    )
}