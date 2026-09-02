import { ZERO_ADDRESS } from '@goldenera/cryptoj'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  getApiErrorMessage,
  normalizeApiInteger,
  useGetBalancesHook,
  useGetMempoolRecommendedFeesHook,
  useGetTokensHook,
  type TokenDtoV1,
} from '@project/api'
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
  Spinner,
} from '@project/ui'
import { Send, TriangleAlertIcon, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { NumericFormat } from 'react-number-format'
import z from 'zod/v4'
import { useFlow } from '../router/useFlow'
import { TransferDurableUnknownError, type TransferReview } from '../services/TransferCoordinator'
import { reconcileTransfers, transferCoordinator } from '../services/TransferCoordinatorService'
import { useWalletStore } from '../store/WalletStore'
import { parseTokenAmount } from '../utils/TokenAmount'
import { compareAddress, formatWei, isNativeToken, isZeroAddress } from '../utils/WalletUtil'
import { ApiErrorMessage } from './ApiErrorMessage'
import { DataRow } from './DataRow'
import { TokenSelect } from './TokenSelect'

const txSubmitSchema = z.object({
  tokenAddress: z.string().min(1, 'Please select a token'),
  recipient: z
    .string()
    .min(42, 'Invalid address')
    .max(42, 'Invalid address')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format'),
  amount: z.string().min(1, 'Amount is required'),
  fee: z.enum(['fast', 'standard', 'slow']).default('standard'),
})

type FeeType = 'fast' | 'standard' | 'slow'

type FeeOption = {
  value: FeeType
  label: string
}

const feeOptions: FeeOption[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'standard', label: 'Standard' },
  { value: 'slow', label: 'Slow' },
]

export type TxSubmitForm = z.infer<typeof txSubmitSchema>

export interface TxSubmitCardProps {
  onSuccess?: (txHash: string) => void
  onError?: (error: Error) => void
  initialData?: Partial<TxSubmitForm>
}

interface TransferDisplayToken {
  name: string
  symbol: string
  decimals: number
}

function requireDisplayToken(token: TokenDtoV1 | undefined, label: string): TransferDisplayToken {
  if (!token) throw new Error(`${label} details are unavailable`)
  const decimals = token.numberOfDecimals
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`${label} decimal precision is unavailable`)
  }
  const name = token.name?.trim() || token.smallestUnitName?.trim()
  const symbol = token.smallestUnitName?.trim() || token.name?.trim()
  if (!name || !symbol) throw new Error(`${label} display details are unavailable`)
  return Object.freeze({ name, symbol, decimals })
}

function requestSubmissionReconciliation(): void {
  void reconcileTransfers('submission').catch(() => undefined)
}

/**
 * A balance response is only displayable when the selected token has an
 * explicit, canonical available balance. Missing and malformed data must not
 * be presented as a zero balance.
 */
function getAvailableBalance(data: unknown, tokenAddress: string): string | null {
  if (!Array.isArray(data) || !tokenAddress) return null

  let selectedBalance: unknown = undefined
  let hasSelectedBalance = false
  for (const item of data) {
    if (!item || typeof item !== 'object') return null
    const record = item as { tokenAddress?: unknown; balance?: unknown }
    if (typeof record.tokenAddress !== 'string' || record.tokenAddress.length === 0) return null
    if (!compareAddress(record.tokenAddress, tokenAddress)) continue
    if (hasSelectedBalance) return null
    hasSelectedBalance = true
    selectedBalance = record.balance
  }

  try {
    return !hasSelectedBalance ? null : normalizeApiInteger(selectedBalance, 'Available balance')
  } catch {
    return null
  }
}

export const TxSubmitCard = ({ onSuccess, onError, initialData }: TxSubmitCardProps) => {
  const { pop } = useFlow()
  const address = useWalletStore((state) => state.address)
  const { data: recommendedFees } = useGetMempoolRecommendedFeesHook()

  // Fetch available tokens
  const { data: tokensData, isLoading: isLoadingTokens } = useGetTokensHook()

  const amountSchema = useMemo(
    () =>
      txSubmitSchema.superRefine((data, context) => {
        const token = tokensData?.find((item) => compareAddress(item.address, data.tokenAddress))
        try {
          parseTokenAmount(data.amount, token?.numberOfDecimals)
        } catch (error) {
          context.addIssue({
            code: 'custom',
            path: ['amount'],
            message: error instanceof Error ? error.message : 'Invalid amount',
          })
        }
      }),
    [tokensData]
  )

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
  const {
    data: balanceData,
    error: balanceError,
    isError: isBalanceError,
    isLoading: isLoadingBalance,
    isSuccess: isBalanceSuccess,
  } = useGetBalancesHook(
    {
      query: {
        addresses: [address!],
        tokenAddresses:
          selectedTokenAddress.length === 0 || isZeroAddress(selectedTokenAddress)
            ? [ZERO_ADDRESS]
            : [selectedTokenAddress, ZERO_ADDRESS],
      },
    },
    {
      query: {
        enabled: !!address,
      },
    }
  )

  const tokens = useMemo(() => tokensData || [], [tokensData])
  const selectedToken = useMemo(
    () => tokens.find((t) => compareAddress(t.address, selectedTokenAddress)),
    [tokens, selectedTokenAddress]
  )
  const nativeToken = useMemo(() => tokens.find((t) => isNativeToken(t.address)), [tokens])
  const tokenDecimals = selectedToken?.numberOfDecimals
  const tokenSymbol = selectedToken?.smallestUnitName || selectedToken?.name || ''
  const nativeTokenDecimals = nativeToken?.numberOfDecimals
  const nativeTokenSymbol = nativeToken?.smallestUnitName || nativeToken?.name || ''

  const availableBalance = useMemo(
    () => getAvailableBalance(balanceData, selectedTokenAddress),
    [balanceData, selectedTokenAddress]
  )
  const isBalanceUnavailable = !isLoadingBalance && (!isBalanceSuccess || availableBalance === null)

  interface ReviewState {
    authorization: TransferReview
    token: TransferDisplayToken
    nativeToken: TransferDisplayToken
  }
  const [review, setReview] = useState<ReviewState | null>(null)
  const reviewRef = useRef<ReviewState | null>(null)
  const preparationRef = useRef<symbol | null>(null)
  const confirmationRef = useRef(false)
  const mounted = useRef(true)
  const [isPreparingReview, setIsPreparingReview] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isFinalOutcome, setIsFinalOutcome] = useState(false)
  const [reviewNotice, setReviewNotice] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<Error | null>(null)

  const invalidateReview = useCallback(() => {
    preparationRef.current = null
    confirmationRef.current = false
    reviewRef.current = null
    if (mounted.current) {
      setReview(null)
      setIsPreparingReview(false)
      setIsConfirming(false)
      setIsFinalOutcome(false)
      setReviewNotice(null)
      setSubmitError(null)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = useWalletStore.subscribe((state, previous) => {
      if (state.sessionRevision !== previous.sessionRevision || state.status !== 'unlocked')
        invalidateReview()
    })
    return () => {
      mounted.current = false
      unsubscribe()
      invalidateReview()
    }
  }, [invalidateReview])

  const feeEstimate = useCallback(
    (type: FeeType): bigint | null => {
      const value = recommendedFees?.[type]?.totalForAverageTx
      return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null
    },
    [recommendedFees]
  )
  const feeEstimateLabel = useCallback(
    (type: FeeType): string => {
      const estimate = feeEstimate(type)
      if (
        estimate === null ||
        nativeTokenDecimals === undefined ||
        !Number.isInteger(nativeTokenDecimals) ||
        nativeTokenDecimals < 0 ||
        nativeTokenDecimals > 255 ||
        !nativeTokenSymbol
      )
        return 'estimate unavailable'
      return `estimated ${formatWei(estimate.toString(), nativeTokenDecimals)} ${nativeTokenSymbol}`
    },
    [feeEstimate, nativeTokenDecimals, nativeTokenSymbol]
  )

  const onFormSubmit = async (data: TxSubmitForm) => {
    if (preparationRef.current || reviewRef.current) return
    const preparation = Symbol('transfer-review')
    preparationRef.current = preparation
    const snapshot = useWalletStore.getState().getSessionSnapshot()
    setIsPreparingReview(true)
    setSubmitError(null)
    form.clearErrors('root')
    try {
      if (!snapshot) throw new Error('Unlock the wallet before preparing a transaction')
      const selected = tokens.find((item) => compareAddress(item.address, data.tokenAddress))
      if (!selected || !nativeToken) throw new Error('Token details are not loaded yet')
      const token = requireDisplayToken(selected, 'Token')
      const nativeDisplayToken = requireDisplayToken(nativeToken, 'Native token')
      const amount = parseTokenAmount(data.amount, token.decimals)
      if (selected.userBurnable === false && isZeroAddress(data.recipient))
        throw new Error('Token is not burnable')
      if (compareAddress(data.recipient, snapshot.address)) throw new Error('Cannot send to self')

      const authorization = await transferCoordinator.prepare({
        sender: snapshot.address,
        recipient: data.recipient,
        tokenAddress: data.tokenAddress,
        amount: amount.toString(),
        feeLevel: data.fee,
      })
      if (
        !mounted.current ||
        preparationRef.current !== preparation ||
        !useWalletStore.getState().isSessionCurrent(snapshot)
      )
        return
      const nextReview = Object.freeze({ authorization, token, nativeToken: nativeDisplayToken })
      reviewRef.current = nextReview
      setReview(nextReview)
      setIsFinalOutcome(false)
      setReviewNotice(null)
    } catch (error) {
      if (mounted.current && preparationRef.current === preparation) {
        form.setError('root', {
          message: getApiErrorMessage(error, 'Could not prepare transaction'),
        })
      }
    } finally {
      if (preparationRef.current === preparation) {
        preparationRef.current = null
        if (mounted.current) setIsPreparingReview(false)
      }
    }
  }

  const onConfirm = async () => {
    const current = reviewRef.current
    if (!current || confirmationRef.current || isFinalOutcome) return
    confirmationRef.current = true
    setIsConfirming(true)
    setReviewNotice(null)
    setSubmitError(null)
    try {
      const result = await transferCoordinator.confirm(current.authorization)
      if (result.kind === 'unknown') requestSubmissionReconciliation()
      if (!mounted.current || reviewRef.current !== current) return
      if (result.kind === 'reconfirm') {
        const updated = Object.freeze({ ...current, authorization: result.review })
        reviewRef.current = updated
        setReview(updated)
        setReviewNotice(
          'Network or wallet conditions changed. Review the updated transaction before confirming again.'
        )
        return
      }
      if (result.kind === 'accepted') {
        reviewRef.current = null
        setReview(null)
        onSuccess?.(result.record.hash)
        pop()
        return
      }

      setIsFinalOutcome(true)
      const failure =
        result.kind === 'unknown'
          ? new Error(
              'The submission outcome is unknown. Do not retry; wait for transaction reconciliation.'
            )
          : new Error(
              'The transaction was rejected. Close this review and prepare a new transaction before retrying.'
            )
      setSubmitError(failure)
      onError?.(failure)
    } catch (error) {
      const durableUnknown = error instanceof TransferDurableUnknownError
      if (durableUnknown) requestSubmissionReconciliation()
      if (!mounted.current || reviewRef.current !== current) return
      if (durableUnknown) {
        setIsFinalOutcome(true)
        const failure = new Error(
          `${getApiErrorMessage(error, 'Transaction could not be completed safely')}. Close this review and wait for any unresolved attempt to reconcile before retrying.`,
          { cause: error }
        )
        setSubmitError(failure)
        onError?.(failure)
        return
      }
      const failure = new Error(
        getApiErrorMessage(error, 'Transaction could not be completed safely'),
        { cause: error }
      )
      setSubmitError(failure)
      onError?.(failure)
    } finally {
      confirmationRef.current = false
      if (mounted.current && reviewRef.current) setIsConfirming(false)
    }
  }

  const onCancel = () => {
    if (confirmationRef.current) return
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
            <CardDescription>Transfer tokens to another address</CardDescription>
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
                    onChange={field.onChange}
                    disabled={isLoadingTokens || field.disabled}
                    name={field.name}
                  />
                  {!!selectedToken &&
                    tokenDecimals !== undefined &&
                    Number.isInteger(tokenDecimals) &&
                    tokenDecimals >= 0 &&
                    tokenDecimals <= 255 && (
                      <div className="mt-1 space-y-1">
                        {isBalanceError && availableBalance !== null ? (
                          <p className="text-xs text-muted-foreground">
                            Balance: {formatWei(availableBalance, tokenDecimals)} {tokenSymbol}
                          </p>
                        ) : isBalanceError ? (
                          <p className="text-xs text-muted-foreground">Balance unavailable</p>
                        ) : isLoadingBalance ? (
                          <p className="text-xs text-muted-foreground" role="status">
                            Balance: Loading balance…
                          </p>
                        ) : isBalanceSuccess && availableBalance !== null ? (
                          <p className="text-xs text-muted-foreground">
                            Balance: {formatWei(availableBalance, tokenDecimals)} {tokenSymbol}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Balance unavailable</p>
                        )}
                        {isBalanceError && (
                          <p className="text-xs text-destructive" role="alert">
                            <ApiErrorMessage
                              error={balanceError}
                              fallbackMessage="Balance could not be refreshed"
                            />
                          </p>
                        )}
                        {(isBalanceError || isBalanceUnavailable) && (
                          <p className="text-xs text-muted-foreground">
                            Balance will be verified before transaction review.
                          </p>
                        )}
                      </div>
                    )}
                  {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                </Field>
              )}
            />

            {/* Recipient Address */}
            <Field className="w-full">
              <FieldLabel>Recipient Address</FieldLabel>
              <Input placeholder="0x..." {...form.register('recipient')} />
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
                    placeholder={
                      tokenDecimals !== undefined &&
                      Number.isInteger(tokenDecimals) &&
                      tokenDecimals >= 0 &&
                      tokenDecimals <= 255
                        ? formatWei('0', tokenDecimals)
                        : '0'
                    }
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
                const selectedOption = feeOptions.find(
                  (feeOption) => feeOption.value === field.value
                )
                const selectedLabel = selectedOption
                  ? `${selectedOption.label} (${feeEstimateLabel(selectedOption.value)})`
                  : 'Select fee'
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
                          <span>{selectedLabel}</span>
                        </SelectValue>
                      </SelectTrigger>

                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Network fee</SelectLabel>
                          {feeOptions.map((feeOption) => (
                            <SelectItem
                              key={feeOption.value}
                              value={feeOption.value}
                              className="flex items-center gap-2"
                            >
                              {feeOption.label} ({feeEstimateLabel(feeOption.value)})
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
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" size="lg" className="w-full" disabled={isDisabled}>
              {isLoading ? (
                <>
                  <Spinner />
                  Preparing...
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
        review={review?.authorization ?? null}
        token={review?.token}
        nativeToken={review?.nativeToken}
        isLoading={isConfirming}
        finalOutcome={isFinalOutcome}
        notice={reviewNotice}
        error={submitError}
      />
    </>
  )
}

interface TxSubmitConfirmProps {
  onConfirm: () => void
  onCancel: () => void
  review: TransferReview | null
  token?: TransferDisplayToken
  nativeToken?: TransferDisplayToken
  isLoading: boolean
  finalOutcome: boolean
  notice: string | null
  error: Error | null
}

const TxSubmitConfirm = ({
  onConfirm,
  onCancel,
  review,
  token,
  nativeToken,
  isLoading,
  finalOutcome,
  notice,
  error,
}: TxSubmitConfirmProps) => {
  const feeDisplay = review && nativeToken ? formatWei(review.fee, nativeToken.decimals) : null
  const amountDisplay = review && token ? formatWei(review.amount, token.decimals) : null

  return (
    <Drawer
      open={!!review && !!token && !!nativeToken}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DrawerContent>
        <DrawerHeader className="relative pb-4">
          <DrawerClose
            render={(props) => (
              <button
                {...props}
                type="button"
                disabled={isLoading}
                aria-label="Close transaction review"
                className="absolute right-4 -top-2 p-2 rounded-full hover:bg-muted transition-colors"
              >
                <X className="size-4" />
              </button>
            )}
          />

          <DrawerTitle>Review Transaction</DrawerTitle>
        </DrawerHeader>

        {!!review && !!token && !!nativeToken && feeDisplay !== null && amountDisplay !== null && (
          <div className="px-4 overflow-y-auto max-h-[60vh] flex flex-col gap-1">
            <DataRow
              label="Recipient"
              value={review.recipient}
              valueToCopy={review.recipient}
              copyable
            />
            <DataRow label="Network Fee" value={`${feeDisplay} ${nativeToken.symbol}`} />
            <DataRow label="Fee Level" value={review.feeLevel} />
            <DataRow label="Token" value={token.name} />
            <DataRow label="Amount" value={`${amountDisplay} ${token.symbol}`} />
          </div>
        )}

        {notice && (
          <div className="px-4 mt-4">
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          </div>
        )}

        {error && (
          <div className="px-4 mt-4">
            <Alert variant="destructive">
              <TriangleAlertIcon className="h-4 w-4" />
              <AlertDescription>
                <ApiErrorMessage error={error} />
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DrawerFooter>
          <DrawerClose
            render={(props) => (
              <Button variant="outline" className="w-full" {...props} disabled={isLoading}>
                {finalOutcome ? 'Close' : 'Cancel'}
              </Button>
            )}
          />
          {!finalOutcome && (
            <Button size="lg" className="w-full" onClick={onConfirm} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner />
                  Finalizing...
                </>
              ) : (
                <>
                  <Send className="size-4 mr-2" />
                  Confirm
                </>
              )}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
