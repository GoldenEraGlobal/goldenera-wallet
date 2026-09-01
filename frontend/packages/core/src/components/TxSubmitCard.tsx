import { ZERO_ADDRESS } from '@goldenera/cryptoj'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { TokenDtoV1} from '@project/api'
import { useGetBalancesHook, useGetMempoolRecommendedFeesHook, getBalances, getNextNonce, submitTransaction, useGetTokensHook, type MempoolRecommendedFeesDtoV1, type MempoolRecommendedFeesLevelDtoV1 } from '@project/api'
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    cn,
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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    Spinner
} from '@project/ui'
import { Send, TriangleAlertIcon, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { NumericFormat } from 'react-number-format'
import z from 'zod/v4'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import type { WalletSessionSnapshot } from '../store/WalletStore'
import { parseTokenAmount } from '../utils/TokenAmount'
import { TransferSubmission, assertTransferBalance, SubmissionCancelledError } from '../utils/TransferSubmission'
import { compareAddress, formatWei, isNativeToken, isZeroAddress, shortenAddress } from '../utils/WalletUtil'
import { DataRow } from './DataRow'
import { TokenSelect } from './TokenSelect'

const txSubmitSchema = z.object({
    tokenAddress: z.string().min(1, 'Please select a token'),
    recipient: z.string().min(42, 'Invalid address').max(42, 'Invalid address').regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format'),
    amount: z.string().min(1, 'Amount is required'),
    fee: z.enum(['fast', 'standard', 'slow']).default('standard')
})

type FeeType = 'fast' | 'standard' | 'slow'

type FeeOption = {
    value: FeeType
    label: string
}

const feeOptions: FeeOption[] = [
    { value: 'fast', label: 'Fast' },
    { value: 'standard', label: 'Standard' },
    { value: 'slow', label: 'Slow' }
]

export type TxSubmitForm = z.infer<typeof txSubmitSchema>

export interface TxSubmitCardProps {
    onSuccess?: (txHash: string) => void
    onError?: (error: Error) => void
    initialData?: Partial<TxSubmitForm>
}

// Average transaction size in bytes, matching the Java backend AVERAGE_TX_SIZE constant
const AVERAGE_TX_SIZE = 150n

/**
 * Calculate the transaction fee based on recommended fees from the API.
 * 
 * The fee calculation formula matches the Java backend:
 * totalFee = baseFee + (feePerByte * txSize)
 * 
 * @param recommendedFees - The recommended fees from the mempool API
 * @param feeLevel - The selected fee level (fast, standard, slow)
 * @param txSizeBytes - Optional actual transaction size; uses AVERAGE_TX_SIZE if not provided
 * @returns The calculated fee in wei as bigint
 */
function calculateFee(
    recommendedFees: MempoolRecommendedFeesDtoV1 | undefined,
    feeLevel: FeeType,
    txSizeBytes?: bigint
): bigint {
    const txSize = txSizeBytes ?? AVERAGE_TX_SIZE

    // Get the fee level data from the API response
    const feeData: MempoolRecommendedFeesLevelDtoV1 | undefined = recommendedFees?.[feeLevel]

    if (!feeData) {
        // Fallback to minimum fee if no data available
        // Using a reasonable default: 1000 wei base + 10 wei per byte
        return 1000n + (10n * txSize)
    }

    // If we have totalForAverageTx and are using average size, use it directly
    // This is the pre-calculated value from the backend for 150-byte transactions
    if (feeData.totalForAverageTx && txSize === AVERAGE_TX_SIZE) {
        return BigInt(feeData.totalForAverageTx)
    }

    // Calculate: baseFee + (feePerByte * txSize)
    const baseFee = feeData.baseFee ? BigInt(feeData.baseFee) : 0n
    const feePerByte = feeData.feePerByte ? BigInt(feeData.feePerByte) : 0n

    return baseFee + (feePerByte * txSize)
}

export const TxSubmitCard = ({ onSuccess, onError, initialData }: TxSubmitCardProps) => {
    const { pop } = useFlow()
    const address = useWalletStore(state => state.address)
    const { data: recommendedFees } = useGetMempoolRecommendedFeesHook()

    // Fetch available tokens
    const { data: tokensData, isLoading: isLoadingTokens } = useGetTokensHook()

    const amountSchema = useMemo(() => txSubmitSchema.superRefine((data, context) => {
        const token = tokensData?.find(item => compareAddress(item.address, data.tokenAddress))
        try {
            parseTokenAmount(data.amount, token?.numberOfDecimals)
        } catch (error) {
            context.addIssue({ code: 'custom', path: ['amount'], message: error instanceof Error ? error.message : 'Invalid amount' })
        }
    }), [tokensData])

    const form = useForm<z.input<typeof txSubmitSchema>, unknown, TxSubmitForm>({
        resolver: standardSchemaResolver(amountSchema),
        defaultValues: {
            tokenAddress: '',
            recipient: '',
            amount: '',
            fee: 'standard',
            ...initialData,
        },
        mode: 'onChange',
    })

    const selectedTokenAddress = form.watch('tokenAddress')

    // Fetch balance for selected token
    const { data: balanceData } = useGetBalancesHook(
        { query: {
            addresses: [address!],
            tokenAddresses: selectedTokenAddress.length > 0 ? [selectedTokenAddress, ZERO_ADDRESS] : [ZERO_ADDRESS]
        } },
        {
            query: {
                enabled: !!address
            },
        }
    )

    const tokens = useMemo(() => tokensData || [], [tokensData])
    const selectedToken = useMemo(
        () => tokens.find(t => compareAddress(t.address, selectedTokenAddress)),
        [tokens, selectedTokenAddress]
    )
    const nativeToken = useMemo(
        () => tokens.find(t => isNativeToken(t.address)),
        [tokens]
    )
    const tokenDecimals = selectedToken?.numberOfDecimals ?? 8
    const tokenSymbol = selectedToken?.smallestUnitName || selectedToken?.name || ''
    const nativeTokenDecimals = nativeToken?.numberOfDecimals ?? 8
    const nativeTokenSymbol = nativeToken?.smallestUnitName || nativeToken?.name || ''

    // Helper function to extract balance from balance data array
    const getBalanceFromData = useCallback((data: typeof balanceData, tokenAddress: string) => {
        if (!data || data.length === 0 || !tokenAddress) return null
        return data.find(b => compareAddress(b.tokenAddress, tokenAddress)) ?? null
    }, [])

    // Get balance for display (balanceData is an array directly)
    const balance = useMemo(() => {
        return getBalanceFromData(balanceData, selectedTokenAddress)
    }, [balanceData, selectedTokenAddress, getBalanceFromData])

    interface Review {
        data: TxSubmitForm
        token: TokenDtoV1
        nativeToken: TokenDtoV1
        fee: bigint
        snapshot: WalletSessionSnapshot
        operation: TransferSubmission
    }
    const [review, setReview] = useState<Review | null>(null)
    const reviewRef = useRef<Review | null>(null)
    const preparationRef = useRef<AbortController | null>(null)
    const mounted = useRef(true)
    const [isPreparingReview, setIsPreparingReview] = useState(false)
    const [isConfirming, setIsConfirming] = useState(false)
    const [postStarted, setPostStarted] = useState(false)
    const [submitError, setSubmitError] = useState<Error | null>(null)
    const reviewData = review?.data ?? null

    const invalidateReview = useCallback(() => {
        preparationRef.current?.abort()
        preparationRef.current = null
        reviewRef.current?.operation.cancel()
        reviewRef.current = null
        if (mounted.current) {
            setReview(null)
            setIsPreparingReview(false)
            setIsConfirming(false)
            setPostStarted(false)
            setSubmitError(null)
        }
    }, [])

    useEffect(() => {
        mounted.current = true
        const unsubscribe = useWalletStore.subscribe((state, previous) => {
            if (state.sessionRevision !== previous.sessionRevision || state.status !== 'unlocked') invalidateReview()
        })
        return () => {
            mounted.current = false
            unsubscribe()
            invalidateReview()
        }
    }, [invalidateReview])

    const calcFee = useCallback((type: FeeType) => calculateFee(recommendedFees, type), [recommendedFees])

    const onFormSubmit = async (data: TxSubmitForm) => {
        if (preparationRef.current || reviewRef.current) return
        const controller = new AbortController()
        preparationRef.current = controller
        const snapshot = useWalletStore.getState().getSessionSnapshot()
        setIsPreparingReview(true)
        setSubmitError(null)
        form.clearErrors('root')
        try {
            if (!snapshot) throw new SubmissionCancelledError()
            const token = tokens.find(item => compareAddress(item.address, data.tokenAddress))
            if (!token || !nativeToken) throw new Error('Token details are not loaded yet')
            const transfer = {
                recipient: data.recipient,
                tokenAddress: data.tokenAddress,
                amount: parseTokenAmount(data.amount, token.numberOfDecimals),
                fee: calculateFee(recommendedFees, data.fee),
            }
            if (!recommendedFees?.[data.fee] || transfer.fee < 0n) throw new Error('Could not fetch recommended fees')
            if (token.userBurnable === false && isZeroAddress(data.recipient)) throw new Error('Token is not burnable')
            if (compareAddress(data.recipient, snapshot.address)) throw new Error('Cannot send to self')
            const balances = await getBalances({ query: { addresses: [snapshot.address], tokenAddresses: [data.tokenAddress, ZERO_ADDRESS] }, signal: controller.signal })
            if (controller.signal.aborted || !useWalletStore.getState().isSessionCurrent(snapshot)) throw new SubmissionCancelledError()
            assertTransferBalance(transfer, balances.data)
            const operation = new TransferSubmission(transfer, {
                isSessionCurrent: () => useWalletStore.getState().isSessionCurrent(snapshot),
                getPrivateKey: () => useWalletStore.getState().getPrivateKey(),
                fetchNonce: async signal => (await getNextNonce({ query: { address: snapshot.address }, signal })).data,
                fetchBalances: async signal => (await getBalances({ query: { addresses: [snapshot.address], tokenAddresses: [data.tokenAddress, ZERO_ADDRESS] }, signal })).data,
                send: async (hexData, signal) => {
                    if (mounted.current) setPostStarted(true)
                    return (await submitTransaction({ body: { hexData }, signal })).data
                },
            })
            const nextReview: Review = { data: { ...data }, token: { ...token }, nativeToken: { ...nativeToken }, fee: transfer.fee, snapshot, operation }
            if (!mounted.current || preparationRef.current !== controller) { operation.cancel(); return }
            reviewRef.current = nextReview
            setReview(nextReview)
            setPostStarted(false)
        } catch (error) {
            if (!controller.signal.aborted && mounted.current && useWalletStore.getState().isSessionCurrent(snapshot)) {
                form.setError('root', { message: error instanceof Error ? error.message : 'Could not prepare transaction' })
            }
        } finally {
            if (preparationRef.current === controller) {
                preparationRef.current = null
                if (mounted.current) setIsPreparingReview(false)
            }
        }
    }

    const onConfirm = async () => {
        const current = reviewRef.current
        if (!current || current.operation.isPending || current.operation.hasSent) return
        setIsConfirming(true)
        setSubmitError(null)
        try {
            const hash = await current.operation.submit()
            if (!hash || !mounted.current || reviewRef.current !== current || !useWalletStore.getState().isSessionCurrent(current.snapshot)) return
            reviewRef.current = null
            setReview(null)
            onSuccess?.(hash)
            pop()
        } catch (error) {
            if (!mounted.current || reviewRef.current !== current || !useWalletStore.getState().isSessionCurrent(current.snapshot)) return
            const failure = error instanceof Error ? error : new Error('Transaction failed')
            const displayed = current.operation.hasSent
                ? new Error(`${failure.message}. A submission was sent; check transaction history before creating another transfer.`, { cause: failure })
                : failure
            setSubmitError(displayed)
            onError?.(displayed)
        } finally {
            if (mounted.current && reviewRef.current === current) setIsConfirming(false)
        }
    }

    const onCancel = () => {
        const current = reviewRef.current
        // Once POST starts it cannot be recalled. Allow closing after its outcome is shown.
        if (current?.operation.hasSent && current.operation.isPending) return
        invalidateReview()
    }

    const rootError = form.formState.errors.root?.message
    const isLoading = isPreparingReview || isConfirming || form.formState.isLoading
    const isDisabled = isLoading || !!review || form.formState.disabled || isLoadingTokens

    return (
        <>
            <form className="w-full" onSubmit={form.handleSubmit(onFormSubmit)}>
                <Card className={cn('w-full')}>
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 [&_svg]:size-7 [&_svg]:text-primary">
                            <Send />
                        </div>
                        <CardTitle>Send Transaction</CardTitle>
                        <CardDescription>
                            Transfer tokens to another address
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {/* Token Selection */}
                        <Controller
                            name="tokenAddress"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field className="w-full">
                                    <FieldLabel>Token</FieldLabel>
                                    <TokenSelect
                                        value={field.value}
                                        onChange={(e) => {
                                            console.log(e)
                                            field.onChange(e)
                                        }}
                                        disabled={isLoadingTokens || field.disabled}
                                        name={field.name}
                                    />
                                    {!!selectedToken && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Balance: {formatWei(balance?.balance || '0', tokenDecimals)} {tokenSymbol}
                                        </p>
                                    )}
                                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                                </Field>
                            )}
                        />

                        {/* Recipient Address */}
                        <Field className="w-full">
                            <FieldLabel>Recipient Address</FieldLabel>
                            <Input
                                placeholder="0x..."
                                {...form.register('recipient')}
                            />
                            {form.formState.errors.recipient && (
                                <FieldError>{form.formState.errors.recipient.message}</FieldError>
                            )}
                        </Field>

                        {/* Amount Input */}
                        <Controller
                            name="amount"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field className="w-full">
                                    <FieldLabel>Amount</FieldLabel>
                                    <NumericFormat
                                        customInput={Input}
                                        placeholder={formatWei('0', tokenDecimals)}
                                        allowNegative={false}
                                        thousandSeparator=","
                                        decimalSeparator="."
                                        inputMode="decimal"
                                        allowedDecimalSeparators={['.', ',']}
                                        value={field.value}
                                        onValueChange={(values) => {
                                            field.onChange(values.value)
                                        }}
                                    />
                                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                                </Field>
                            )}
                        />

                        {/* Fee Input */}
                        <Controller
                            name="fee"
                            control={form.control}
                            render={({ field, fieldState }) => {
                                const selectedToken = feeOptions.find((feeOption) => feeOption.value === field.value)
                                let selectedTokenLabel = 'Select fee'
                                if (selectedToken) {
                                    const calculatedFee = calcFee(selectedToken.value)
                                    selectedTokenLabel = `${selectedToken.label} ${formatWei(calculatedFee.toString(), nativeTokenDecimals)} ${nativeTokenSymbol}`
                                }
                                return (
                                    <Field className="w-full">
                                        <FieldLabel>Fee</FieldLabel>
                                        <Select
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            disabled={field.disabled}
                                            name={field.name}
                                        >
                                            <SelectTrigger className="w-full h-9" size="lg">
                                                <SelectValue className="flex items-center gap-2">
                                                    {isLoadingTokens ? <Spinner /> : null}
                                                    <span>{selectedTokenLabel}</span>
                                                </SelectValue>
                                            </SelectTrigger>

                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectLabel>Network fee</SelectLabel>
                                                    {feeOptions.map((feeOption) => (
                                                        <SelectItem key={feeOption.value} value={feeOption.value} className='flex items-center gap-2'>
                                                            {feeOption.label} ({formatWei(calcFee(feeOption.value).toString(), nativeTokenDecimals)} {nativeTokenSymbol})
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                        {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                                    </Field>
                                )
                            }}
                        />

                        {/* Root Error */}
                        {rootError && (
                            <Alert variant="destructive">
                                <TriangleAlertIcon />
                                <AlertDescription>
                                    {rootError}
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3">
                        <Button
                            type="submit"
                            size="lg"
                            className="w-full"
                            disabled={isDisabled}
                        >
                            {isLoading ? (
                                <>
                                    <Spinner />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <Send className="size-4 mr-2" />
                                    Submit
                                </>
                            )}
                        </Button>
                    </CardFooter>
                </Card>
            </form>
            <TxSubmitConfirm
                onConfirm={onConfirm}
                onCancel={onCancel}
                data={reviewData}
                token={review?.token}
                nativeToken={review?.nativeToken}
                fee={review?.fee ?? 0n}
                isLoading={isConfirming}
                hasSent={postStarted}
                error={submitError}
            />
        </>
    )
}

interface TxSubmitConfirmProps {
    onConfirm: () => void
    onCancel: () => void
    data: TxSubmitForm | null
    token?: TokenDtoV1
    nativeToken?: TokenDtoV1
    fee: bigint
    hasSent: boolean
    isLoading: boolean
    error: Error | null
}

const TxSubmitConfirm = ({ onConfirm, onCancel, data, token, nativeToken, fee, isLoading, hasSent, error }: TxSubmitConfirmProps) => {

    const feeDisplay = nativeToken ? formatWei(fee.toString(), nativeToken.numberOfDecimals) : '0'

    return (
        <Drawer open={!!data && !!token} onOpenChange={(open) => !open && onCancel()}>
            <DrawerContent>
                {/* Simple header with status and amount */}

                <DrawerHeader className="relative pb-4">
                    <DrawerClose
                        render={(props) => (
                            <button
                                type="button"
                                disabled={isLoading && hasSent}
                                aria-label="Close transaction review"
                                className="absolute right-4 -top-2 p-2 rounded-full hover:bg-muted transition-colors"
                                {...props}
                            >
                                <X className="size-4" />
                            </button>
                        )}
                    />

                    <DrawerTitle>
                        Review Transaction
                    </DrawerTitle>
                </DrawerHeader>

                {/* Scrollable key-value list */}
                {!!data && !!token && !!nativeToken && (
                    <div className="px-4 overflow-y-auto max-h-[60vh] flex flex-col gap-1">
                        <DataRow label="Recipient" value={shortenAddress(data.recipient)} valueToCopy={data.recipient} copyable />
                        <DataRow label="Network Fee" value={`${feeDisplay} ${nativeToken.smallestUnitName}`} />
                        <DataRow label="Token" value={token.name} />
                        <DataRow label="Amount" value={`${data.amount} ${token.smallestUnitName}`} />
                    </div>
                )}

                {error && (
                    <div className="px-4 mt-4">
                        <Alert variant="destructive">
                            <TriangleAlertIcon className="h-4 w-4" />
                            <AlertDescription>
                                {error.message}
                            </AlertDescription>
                        </Alert>
                    </div>
                )}

                <DrawerFooter>
                    <DrawerClose render={(props) => (
                        <Button variant="outline" className="w-full" {...props} disabled={isLoading && hasSent}>
                            {hasSent ? 'Close' : 'Cancel'}
                        </Button>
                    )} />
                    <Button
                        size="lg"
                        className="w-full"
                        onClick={onConfirm}
                        disabled={isLoading || hasSent}
                    >
                        {isLoading ? (
                            <>
                                <Spinner />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="size-4 mr-2" />
                                Confirm
                            </>
                        )}
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    )
}