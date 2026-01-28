import { Share } from '@capacitor/share'
import { NATIVE_TOKEN } from '@goldenera/cryptoj'
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useGetTokensHook } from '@project/api'
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    Field,
    FieldError,
    FieldLabel,
    Input,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@project/ui'
import { CustomQRCode } from "custom-qr-code/react"
import {
    Copy,
    Download,
    ShareIcon,
    X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from "react-hook-form"
import { NumericFormat } from "react-number-format"
import z from "zod"
import { useCopy } from '../hooks/useCopy'
import { useShareSupported } from '../hooks/useShareSupported'
import { useWalletStore } from '../store/WalletStore'
import { qrToString } from '../utils/QrUtil'
import { compareAddress, formatWei } from '../utils/WalletUtil'

const amountSchema = z.object({
    amount: z.string().refine((value) => {
        if (!value || value === '') {
            return true
        }
        try {
            return parseFloat(value) > 0
        } catch {
            return false
        }
    }, 'Amount must be greater than 0')
})

type AmountFormValues = z.infer<typeof amountSchema>

interface SetAmountDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (amount: string) => void
    initialAmount?: string
    tokenSymbol?: string
    tokenDecimals?: number
}

function SetAmountDialog({ open, onOpenChange, onConfirm, initialAmount, tokenSymbol, tokenDecimals = 8 }: SetAmountDialogProps) {
    const form = useForm<AmountFormValues>({
        resolver: standardSchemaResolver(amountSchema),
        defaultValues: {
            amount: initialAmount || ''
        }
    })

    const onSubmit = (data: AmountFormValues) => {
        onConfirm(data.amount)
        onOpenChange(false)
        form.reset({ amount: data.amount })
    }

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            form.reset({ amount: initialAmount || '' })
        }
    }, [open, initialAmount, form])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set Amount</DialogTitle>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <Controller
                        control={form.control}
                        name="amount"
                        render={({ field, fieldState }) => (
                            <Field className="w-full">
                                <FieldLabel>Amount ({tokenSymbol})</FieldLabel>
                                <NumericFormat
                                    customInput={Input}
                                    placeholder={formatWei('0', tokenDecimals)}
                                    allowNegative={false}
                                    thousandSeparator=","
                                    decimalScale={tokenDecimals}
                                    decimalSeparator="."
                                    allowedDecimalSeparators={['.', ',']}
                                    inputMode="decimal"
                                    value={field.value}
                                    onValueChange={(values) => {
                                        field.onChange(values.value)
                                    }}
                                />
                                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                            </Field>
                        )}
                    />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">
                            Confirm
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}



interface ReceiveTransferProps {
    children: (open: (tokenAddress?: string) => void) => React.ReactNode
}

export function ReceiveTransfer({
    children,
}: ReceiveTransferProps) {
    const { copy, copied } = useCopy()
    const { copy: copyQr, copied: copiedQr } = useCopy()
    const address = useWalletStore((state) => state.address)
    const { data: tokens } = useGetTokensHook()
    const [tokenAddress, setTokenAddress] = useState<string>(NATIVE_TOKEN)
    const token = tokens?.find((token) => compareAddress(token.address, tokenAddress))
    const [amount, setAmount] = useState<string | undefined>(undefined)
    const [open, setOpen] = useState(false)
    const qrStrData = useMemo(() => {
        return qrToString({
            address: address || '',
            tokenAddress,
            amount
        })
    }, [address, tokenAddress, amount])
    const isShareSupported = useShareSupported()
    const [sharing, setSharing] = useState(false)
    const [isAmountDialogOpen, setIsAmountDialogOpen] = useState(false)

    const onOpenChange = (open: boolean) => {
        setOpen(open)
    }

    const openDrawer = (tokenAddress?: string) => {
        setTokenAddress(tokenAddress || NATIVE_TOKEN)
        setAmount(undefined)
        setOpen(true)
    }

    const copyAddress = () => {
        copy(address || '')
    }

    const copyQrAddress = () => {
        copyQr(address || '')
    }

    const shareAddress = () => {
        setSharing(true)
        Share.share({
            title: 'Crypto Address',
            text: `Send ${amount ? amount + ' ' : ''}${token?.smallestUnitName} (${token?.name}) to ${address}`
        }).finally(() => {
            setSharing(false)
        })
    }

    const openAmountDialog = () => {
        // tempAmount is not really needed as intermediate state anymore if we pass current amount to dialog
        setIsAmountDialogOpen(true)
    }

    const handleAmountConfirm = (newAmount: string) => {
        setAmount(newAmount || undefined)
        setIsAmountDialogOpen(false)
    }



    return (
        <>
            <Drawer open={open} onOpenChange={onOpenChange}>
                {children(openDrawer)}
                <DrawerContent>
                    {/* Simple header with status and amount */}
                    <DrawerHeader className="relative pb-4">
                        <DrawerClose
                            render={(props) => (
                                <button
                                    type="button"
                                    className="absolute right-4 -top-2 p-2 rounded-full hover:bg-muted transition-colors"
                                    {...props}
                                >
                                    <X className="size-4" />
                                </button>
                            )}
                        />

                        <DrawerTitle>
                            Receive
                        </DrawerTitle>
                    </DrawerHeader>

                    <div className="px-4">
                        <div className='space-y-4'>
                            <div className='flex items-center gap-2 justify-center'>
                                {token && (
                                    <Avatar className="after:border-none size-6">
                                        <AvatarImage src={token.logoUrl} alt={token.name} />
                                        <AvatarFallback className="text-xs">{token.smallestUnitName?.slice(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                )}
                                <span className='font-bold'>
                                    {token?.smallestUnitName}
                                </span>
                            </div>

                            <div className="flex items-center justify-center">
                                <Tooltip open={copied}>
                                    <TooltipTrigger onClick={copyAddress} render={<div className='bg-white overflow-hidden rounded-lg flex flex-col items-center pb-5'>
                                        <CustomQRCode
                                            width={220}
                                            height={220}
                                            margin={0}
                                            type="svg"
                                            data={qrStrData}
                                        />
                                        <span className='text-xs text-black font-bold max-w-[220px] text-center px-5' style={{
                                            wordBreak: 'break-all'
                                        }}>
                                            {address}
                                        </span>
                                        <span className='text-xs text-black font-bold max-w-[220px] text-center mt-2' style={{
                                            wordBreak: 'break-all'
                                        }}>
                                            Amount: {amount ?? 'N/A'}
                                        </span>
                                    </div>} />
                                    <TooltipContent>
                                        <p>{copiedQr ? 'Copied address' : 'Copy address'}</p>
                                    </TooltipContent>
                                </Tooltip>

                            </div>
                            <div className="flex items-center w-full gap-3">
                                <Tooltip open={copiedQr}>
                                    <TooltipTrigger onClick={copyQrAddress} render={<Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0">
                                        <Copy className="h-5 w-5" />
                                        <span className="text-xs">Copy</span>
                                    </Button>} />
                                    <TooltipContent>
                                        <p>{copiedQr ? 'Copied address' : 'Copy address'}</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={openAmountDialog}>
                                    <Download className="h-5 w-5" />
                                    <span className="text-xs">Set amount</span>
                                </Button>
                                {isShareSupported && (
                                    <Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={shareAddress} disabled={sharing}>
                                        {sharing ? <Spinner className="h-5 w-5"></Spinner> : <ShareIcon className="h-5 w-5" />}
                                        <span className="text-xs">Share</span>
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <DrawerFooter>
                        <DrawerClose render={(props) => (
                            <Button variant="outline" className="w-full" {...props}>
                                Close
                            </Button>
                        )} />
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
            <SetAmountDialog
                open={isAmountDialogOpen}
                onOpenChange={setIsAmountDialogOpen}
                onConfirm={handleAmountConfirm}
                initialAmount={amount}
                tokenSymbol={token?.smallestUnitName}
                tokenDecimals={token?.numberOfDecimals ?? 8}
            />
        </>
    )
}
