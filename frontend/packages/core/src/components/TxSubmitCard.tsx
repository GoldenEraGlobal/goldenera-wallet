import { Amounts, bytesToHex, DECIMALS, encodeTx, Network, TxBuilder, TxType, type Address } from '@goldenera/cryptoj'
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { TokenDtoV1, useGetBalancesHook, useGetMempoolRecommendedFeesHook, useGetNextNonceHook, useGetTokensHook, useSubmitTransactionHook, type MempoolRecommendedFeesDtoV1, type MempoolRecommendedFeesLevelDtoV1 } from "@project/api"
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
} from "@project/ui"
import { useFlow } from '@stackflow/react/future'
import { Send, TriangleAlertIcon, X } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { NumericFormat } from "react-number-format"
import z from "zod/v4"
import { useWalletStore } from "../store/WalletStore"
import { compareAddress, formatWei, isNativeToken, isZeroAddress, shortenAddress } from "../utils/WalletUtil"
import { DataRow } from './DataRow'
import { TokenSelect } from './TokenSelect'

const txSubmitSchema = z.object({
    tokenAddress: z.string().min(1, 'Please select a token'),
    recipient: z.string().min(42, 'Invalid address').max(42, 'Invalid address').regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format'),
    amount: z.string().min(1, 'Amount is required').refine((value) => {
        return Amounts.isPositive(Amounts.parseTokens(value))
    }, 'Amount must be greater than 0'),
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
    const { replace } = useFlow()
    const address = useWalletStore(state => state.address)
    const privateKey = useWalletStore(state => state._privateKey)
    const { mutateAsync: submitTx, isPending: isSubmitting } = useSubmitTransactionHook()
    const { data: nextNonce } = useGetNextNonceHook(
        { address: address! },
        { query: { enabled: !!address } }
    )
    const { data: recommendedFees } = useGetMempoolRecommendedFeesHook()

    // Fetch available tokens
    const { data: tokensData, isLoading: isLoadingTokens } = useGetTokensHook()

    const form = useForm<TxSubmitForm>({
        resolver: standardSchemaResolver(txSubmitSchema),
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
    const selectedFee = form.watch('fee')

    // Fetch balance for selected token
    const { data: balanceData } = useGetBalancesHook(
        {
            addresses: [address!],
            tokenAddresses: selectedTokenAddress.length > 0 ? [selectedTokenAddress] : []
        },
        {
            query: {
                enabled: !!address && selectedTokenAddress.length > 0,
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

    // Get balance for display (balanceData is an array directly)
    const balance = useMemo(() => {
        if (!balanceData || balanceData.length === 0) return null
        return balanceData[0]
    }, [balanceData])

    const [reviewData, setReviewData] = useState<TxSubmitForm | null>(null)
    const [submitError, setSubmitError] = useState<Error | null>(null)

    const calcFee = useCallback((type: FeeType) => {
        return calculateFee(recommendedFees, type)
    }, [recommendedFees])

    const onFormSubmit = async (data: TxSubmitForm) => {
        setSubmitError(null)
        let isError = false

        // Parse amount using the correct decimals and compare as BigInt
        const amountWei = Amounts.parseWithDecimals(data.amount, tokenDecimals)
        const balanceWei = BigInt(balance?.balance ?? '0')

        if (amountWei > balanceWei) {
            form.setError('amount', {
                type: 'manual',
                message: 'Insufficient balance',
            })
            isError = true
        }

        if (selectedToken?.userBurnable === false && isZeroAddress(data.recipient)) {
            form.setError('recipient', {
                type: 'manual',
                message: 'Token is not burnable',
            })
            isError = true
        }

        if (compareAddress(data.recipient, address)) {
            form.setError('recipient', {
                type: 'manual',
                message: 'Cannot send to self',
            })
            isError = true
        }

        if (isError) {
            return
        }

        setReviewData(data)
    }

    const onConfirm = async () => {
        if (!reviewData) return

        try {
            setSubmitError(null)
            if (!privateKey) {
                throw new Error('Wallet is not unlocked')
            }
            if (typeof nextNonce === 'undefined') {
                throw new Error('Could not fetch nonce')
            }

            // Validate that we have fee data before proceeding
            const feeData = recommendedFees?.[reviewData.fee]
            if (!feeData) {
                throw new Error('Could not fetch recommended fees')
            }

            // Build the transaction
            const tx = TxBuilder.create()
                .type(TxType.TRANSFER)
                .network(Network.MAINNET)
                .recipient(reviewData.recipient as Address)
                .amount(Amounts.parseWithDecimals(reviewData.amount, tokenDecimals ?? DECIMALS.STANDARD))
                .fee(Amounts.wei(calculateFee(recommendedFees, reviewData.fee)))
                .nonce(BigInt(nextNonce))
                .tokenAddress(reviewData.tokenAddress as Address)
                .sign(privateKey)

            // Encode transaction to hex
            const txBytes = encodeTx(tx, true)
            const txHex = bytesToHex(txBytes)

            // Submit the transaction
            const result = await submitTx({
                data: {
                    hexData: txHex,
                },
            })

            // Check if transaction was successful
            if (result?.status === 'SUCCESS') {
                onSuccess?.(tx.hash)
                form.reset()
                setReviewData(null)
                replace('DashboardPage', {})
            } else {
                throw new Error(result?.message || 'Transaction rejected')
            }
        } catch (error) {
            console.error('Transaction failed:', error)
            setSubmitError(error as Error)
            onError?.(error as Error)
        }
    }

    const rootError = form.formState.errors.root?.message
    const isLoading = isSubmitting || form.formState.isLoading
    const isDisabled = isLoading || form.formState.disabled

    return (
        <>
            <form className="w-full" onSubmit={form.handleSubmit(onFormSubmit)}>
                <Card className={cn("w-full")}>
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
                                        decimalScale={tokenDecimals}
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
                onCancel={() => {
                    setReviewData(null)
                    setSubmitError(null)
                }}
                data={reviewData}
                token={selectedToken}
                nativeToken={nativeToken}
                networkFeeData={recommendedFees?.[reviewData?.fee as FeeType]}
                isLoading={isSubmitting}
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
    networkFeeData?: MempoolRecommendedFeesLevelDtoV1
    isLoading: boolean
    error: Error | null
}

const TxSubmitConfirm = ({ onConfirm, onCancel, data, token, nativeToken, networkFeeData, isLoading, error }: TxSubmitConfirmProps) => {

    const totalFee = BigInt(networkFeeData?.totalForAverageTx || '0')
    // We already checked this in calculateFee but for display purposes logic is similar
    const feeDisplay = nativeToken ? formatWei(totalFee.toString(), nativeToken.numberOfDecimals) : '0'

    return (
        <Drawer open={!!data && !!token} onOpenChange={(open) => !open && onCancel()}>
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
                        Review Transaction
                    </DrawerTitle>
                </DrawerHeader>

                {/* Scrollable key-value list */}
                {!!data && !!token && !!nativeToken && (
                    <div className="px-4 overflow-y-auto max-h-[60vh] flex flex-col gap-1">
                        <DataRow label="Recipient" value={shortenAddress(data.recipient)} copyable />
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
                        <Button variant="outline" className="w-full" {...props}>
                            Cancel
                        </Button>
                    )} />
                    <Button
                        size="lg"
                        className="w-full"
                        onClick={onConfirm}
                        disabled={isLoading}
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