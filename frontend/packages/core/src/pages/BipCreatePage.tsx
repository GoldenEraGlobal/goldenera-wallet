import {
  createAddressAliasAddPayload,
  createAddressAliasRemovePayload,
  createAuthorityAddPayload,
  createAuthorityRemovePayload,
  createNetworkParamsSetPayload,
  createTokenBurnPayload,
  createTokenCreatePayload,
  createTokenMintPayload,
  createTokenUpdatePayload,
  createValidatorAddPayload,
  createValidatorMiningPolicySetPayload,
  createValidatorRemovePayload,
  isAddress,
  MiningLimitMode,
  ZERO_ADDRESS,
} from '@goldenera/cryptoj'
import type { Address, TxPayload } from '@goldenera/cryptoj'
import { useGetAuthorityStatusHook, useGetOptionsHook, useGetTokensHook, type TokenDtoV1 } from '@project/api'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@project/ui'
import type { ActivityComponentType } from '@stackflow/react'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { NumericFormat } from 'react-number-format'
import { DataRow } from '../components/DataRow'
import { TokenSelect } from '../components/TokenSelect'
import { AppLayout } from '../layouts/Layouts'
import { confirmGovernanceTransaction, prepareGovernanceTransaction, type GovernanceReview } from '../services/GovernanceSubmission'
import { useWalletStore } from '../store/WalletStore'
import { compareAddress, formatWei } from '../utils/WalletUtil'
import {
  bipTypeLabels,
  displayedAmountToBaseUnits,
  displayPayloadKey,
  displayPayloadValue,
  miningShareBpsToPercentage,
  miningSharePercentageToBps,
} from '../utils/GovernanceUtil'

const bipKinds = [
  'AUTHORITY_ADD', 'AUTHORITY_REMOVE', 'ADDRESS_ALIAS_ADD', 'ADDRESS_ALIAS_REMOVE',
  'TOKEN_CREATE', 'TOKEN_UPDATE', 'TOKEN_MINT', 'TOKEN_BURN',
  'VALIDATOR_ADD', 'VALIDATOR_REMOVE', 'NETWORK_PARAMS_SET', 'VALIDATOR_MINING_POLICY_SET',
] as const
type BipKind = (typeof bipKinds)[number]
type Values = Record<string, string | boolean>

interface FieldDefinition {
  key: string
  label: string
  placeholder?: string
  kind?: 'text' | 'number' | 'url' | 'checkbox' | 'miningMode' | 'percentage'
    | 'token' | 'authority' | 'alias' | 'validator' | 'tokenAmount' | 'nativeAmount' | 'createdTokenAmount'
  optional?: boolean
}

const addressField = (key: string, label: string): FieldDefinition => ({ key, label, placeholder: '0x…' })
const fields: Record<BipKind, FieldDefinition[]> = {
  AUTHORITY_ADD: [addressField('authorityAddress', 'Authority address')],
  AUTHORITY_REMOVE: [{ key: 'authorityAddress', label: 'Authority', kind: 'authority' }],
  ADDRESS_ALIAS_ADD: [addressField('address', 'Address'), { key: 'alias', label: 'Alias' }],
  ADDRESS_ALIAS_REMOVE: [{ key: 'alias', label: 'Alias', kind: 'alias' }],
  TOKEN_CREATE: [
    { key: 'name', label: 'Token name' },
    { key: 'smallestUnitName', label: 'Symbol / smallest unit name' },
    { key: 'numberOfDecimals', label: 'Decimals', kind: 'number' },
    { key: 'websiteUrl', label: 'Website URL', kind: 'url', optional: true },
    { key: 'logoUrl', label: 'Logo URL', kind: 'url', optional: true },
    { key: 'maxSupply', label: 'Maximum supply', kind: 'createdTokenAmount', optional: true },
    { key: 'userBurnable', label: 'Users may burn this token', kind: 'checkbox', optional: true },
  ],
  TOKEN_UPDATE: [
    { key: 'tokenAddress', label: 'Token', kind: 'token' },
    { key: 'name', label: 'New token name', optional: true },
    { key: 'smallestUnitName', label: 'New symbol / smallest unit name', optional: true },
    { key: 'websiteUrl', label: 'New website URL', kind: 'url', optional: true },
    { key: 'logoUrl', label: 'New logo URL', kind: 'url', optional: true },
  ],
  TOKEN_MINT: [
    { key: 'tokenAddress', label: 'Token', kind: 'token' }, addressField('recipient', 'Recipient address'),
    { key: 'amount', label: 'Amount', kind: 'tokenAmount' },
  ],
  TOKEN_BURN: [
    { key: 'tokenAddress', label: 'Token', kind: 'token' }, addressField('sender', 'Address to burn from'),
    { key: 'amount', label: 'Amount', kind: 'tokenAmount' },
  ],
  VALIDATOR_ADD: [
    addressField('validatorAddress', 'Validator address'),
    { key: 'miningMode', label: 'Mining limit', kind: 'miningMode' },
    { key: 'maxMiningSharePercent', label: 'Maximum mining share (0.01–40%)', kind: 'percentage', optional: true },
  ],
  VALIDATOR_REMOVE: [{ key: 'validatorAddress', label: 'Validator', kind: 'validator' }],
  NETWORK_PARAMS_SET: [
    { key: 'blockReward', label: 'Block reward', kind: 'nativeAmount', optional: true },
    { key: 'blockRewardPoolAddress', label: 'Block reward pool address', optional: true },
    { key: 'targetMiningTimeMs', label: 'Target mining time (ms)', kind: 'number', optional: true },
    { key: 'asertHalfLifeBlocks', label: 'ASERT half-life (blocks)', kind: 'number', optional: true },
    { key: 'minDifficulty', label: 'Minimum difficulty', kind: 'number', optional: true },
    { key: 'minTxBaseFee', label: 'Minimum transaction base fee', kind: 'nativeAmount', optional: true },
    { key: 'minTxByteFee', label: 'Minimum transaction byte fee', kind: 'nativeAmount', optional: true },
    { key: 'validatorMiningWindowBlocks', label: 'Validator mining window (100–10000 blocks)', kind: 'number', optional: true },
    { key: 'miningRewardVestingBlocks', label: 'Mining reward vesting (0–1000000 blocks)', kind: 'number', optional: true },
  ],
  VALIDATOR_MINING_POLICY_SET: [
    { key: 'validatorAddress', label: 'Validator', kind: 'validator' },
    { key: 'miningMode', label: 'Mining limit', kind: 'miningMode' },
    { key: 'maxMiningSharePercent', label: 'Maximum mining share (0.01–40%)', kind: 'percentage', optional: true },
  ],
}

function required(values: Values, key: string, label: string): string {
  const value = String(values[key] ?? '').trim()
  if (!value) throw new Error(`${label} is required.`)
  return value
}

function address(values: Values, key: string, label: string): Address {
  const value = required(values, key, label).toLowerCase()
  if (!isAddress(value)) throw new Error(`${label} is invalid.`)
  return value as Address
}

function uint(values: Values, key: string, label: string, optional = false): bigint | null {
  const value = String(values[key] ?? '').trim()
  if (!value && optional) return null
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a non-negative whole number.`)
  return BigInt(value)
}

function optionalText(values: Values, key: string): string | null {
  const value = String(values[key] ?? '').trim()
  return value || null
}

function tokenDecimals(values: Values): number {
  const value = Number(uint(values, 'numberOfDecimals', 'Decimals'))
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Decimals must be between 0 and 255.')
  return value
}

function tokenDetails(tokens: TokenDtoV1[], tokenAddress: string, label: string): TokenDtoV1 & { numberOfDecimals: number } {
  const token = tokens.find(item => compareAddress(item.address, tokenAddress))
  const numberOfDecimals = token?.numberOfDecimals
  if (!token || numberOfDecimals === undefined || !Number.isInteger(numberOfDecimals)
    || numberOfDecimals < 0 || numberOfDecimals > 255) {
    throw new Error(`${label} decimal precision is unavailable.`)
  }
  return { ...token, numberOfDecimals }
}

function amountValue(
  values: Values,
  key: string,
  label: string,
  numberOfDecimals: number,
  optional = false,
  allowZero = false,
): bigint | null {
  const value = String(values[key] ?? '').trim()
  if (!value && optional) return null
  return displayedAmountToBaseUnits(value, numberOfDecimals, label, allowZero)
}

function miningPolicy(values: Values) {
  const unlimited = values.miningMode === 'UNLIMITED'
  return {
    miningLimitMode: unlimited ? MiningLimitMode.UNLIMITED : MiningLimitMode.LIMITED,
    maxMiningShareBps: unlimited
      ? 0n
      : miningSharePercentageToBps(required(values, 'maxMiningSharePercent', 'Maximum mining share')),
  }
}

function shortenAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function OptionSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const selected = options.find(option => option.value === value)
  return (
    <Select value={value} onValueChange={next => onChange(next ?? '')} disabled={disabled}>
      <SelectTrigger className="h-9 w-full px-2.5 text-sm" size="lg">
        <SelectValue>{selected?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function FormattedAmountInput({
  value,
  decimals,
  symbol,
  unavailableLabel,
  onChange,
}: {
  value: string
  decimals?: number
  symbol?: string
  unavailableLabel: string
  onChange: (value: string) => void
}) {
  const available = decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
  return (
    <>
      <NumericFormat
        customInput={Input}
        value={value}
        valueIsNumericString
        disabled={!available}
        placeholder={available ? formatWei('0', decimals) : unavailableLabel}
        allowNegative={false}
        thousandSeparator=","
        decimalSeparator="."
        inputMode="decimal"
        allowedDecimalSeparators={['.', ',']}
        onValueChange={({ value: nextValue }) => onChange(nextValue)}
      />
      {available && (
        <p className="text-xs text-muted-foreground">
          {symbol ? `${symbol} · ` : ''}up to {decimals} decimal places
        </p>
      )}
    </>
  )
}

function createPayload(kind: BipKind, values: Values, tokens: TokenDtoV1[]): TxPayload {
  switch (kind) {
    case 'AUTHORITY_ADD': return createAuthorityAddPayload(address(values, 'authorityAddress', 'Authority address'))
    case 'AUTHORITY_REMOVE': return createAuthorityRemovePayload(address(values, 'authorityAddress', 'Authority address'))
    case 'ADDRESS_ALIAS_ADD': return createAddressAliasAddPayload(address(values, 'address', 'Address'), required(values, 'alias', 'Alias'))
    case 'ADDRESS_ALIAS_REMOVE': return createAddressAliasRemovePayload(required(values, 'alias', 'Alias'))
    case 'TOKEN_CREATE': {
      const numberOfDecimals = tokenDecimals(values)
      return createTokenCreatePayload({
        name: required(values, 'name', 'Token name'),
        smallestUnitName: required(values, 'smallestUnitName', 'Smallest unit name'),
        numberOfDecimals,
        websiteUrl: optionalText(values, 'websiteUrl'),
        logoUrl: optionalText(values, 'logoUrl'),
        maxSupply: amountValue(values, 'maxSupply', 'Maximum supply', numberOfDecimals, true),
        userBurnable: values.userBurnable === true,
      })
    }
    case 'TOKEN_UPDATE': {
      const updates = {
        name: optionalText(values, 'name'), smallestUnitName: optionalText(values, 'smallestUnitName'),
        websiteUrl: optionalText(values, 'websiteUrl'), logoUrl: optionalText(values, 'logoUrl'),
      }
      if (Object.values(updates).every(value => value === null)) throw new Error('Enter at least one token field to update.')
      return createTokenUpdatePayload(address(values, 'tokenAddress', 'Token address'), updates)
    }
    case 'TOKEN_MINT': {
      const tokenAddress = address(values, 'tokenAddress', 'Token address')
      const token = tokenDetails(tokens, tokenAddress, 'Token')
      return createTokenMintPayload(
        tokenAddress,
        address(values, 'recipient', 'Recipient address'),
        amountValue(values, 'amount', 'Amount', token.numberOfDecimals) ?? 0n,
      )
    }
    case 'TOKEN_BURN': {
      const tokenAddress = address(values, 'tokenAddress', 'Token address')
      const token = tokenDetails(tokens, tokenAddress, 'Token')
      return createTokenBurnPayload(
        tokenAddress,
        address(values, 'sender', 'Sender address'),
        amountValue(values, 'amount', 'Amount', token.numberOfDecimals) ?? 0n,
      )
    }
    case 'VALIDATOR_ADD': return createValidatorAddPayload(address(values, 'validatorAddress', 'Validator address'), miningPolicy(values))
    case 'VALIDATOR_REMOVE': return createValidatorRemovePayload(address(values, 'validatorAddress', 'Validator address'))
    case 'VALIDATOR_MINING_POLICY_SET': return createValidatorMiningPolicySetPayload(address(values, 'validatorAddress', 'Validator address'), miningPolicy(values))
    case 'NETWORK_PARAMS_SET': {
      const nativeToken = tokenDetails(tokens, ZERO_ADDRESS, 'Native token')
      const parameters = {
        blockReward: amountValue(values, 'blockReward', 'Block reward', nativeToken.numberOfDecimals, true, true),
        blockRewardPoolAddress: optionalText(values, 'blockRewardPoolAddress')
          ? address(values, 'blockRewardPoolAddress', 'Block reward pool address') : null,
        targetMiningTimeMs: uint(values, 'targetMiningTimeMs', 'Target mining time', true),
        asertHalfLifeBlocks: uint(values, 'asertHalfLifeBlocks', 'ASERT half-life', true),
        minDifficulty: uint(values, 'minDifficulty', 'Minimum difficulty', true),
        minTxBaseFee: amountValue(values, 'minTxBaseFee', 'Minimum transaction base fee', nativeToken.numberOfDecimals, true, true),
        minTxByteFee: amountValue(values, 'minTxByteFee', 'Minimum transaction byte fee', nativeToken.numberOfDecimals, true, true),
        validatorMiningWindowBlocks: uint(values, 'validatorMiningWindowBlocks', 'Validator mining window', true),
        miningRewardVestingBlocks: uint(values, 'miningRewardVestingBlocks', 'Mining reward vesting', true),
      }
      if (Object.values(parameters).every(value => value === null)) throw new Error('Enter at least one network parameter to update.')
      return createNetworkParamsSetPayload(parameters)
    }
  }
}

export const BipCreatePage: ActivityComponentType<'BipCreatePage'> = () => {
  const walletAddress = useWalletStore(state => state.address)
  const authority = useGetAuthorityStatusHook(
    { query: { address: walletAddress ?? '' } },
    { query: { enabled: !!walletAddress, staleTime: 15_000 } },
  )
  const governanceOptions = useGetOptionsHook({
    query: { enabled: authority.data?.authority === true, staleTime: 15_000 },
  })
  const tokenQuery = useGetTokensHook()
  const tokens = tokenQuery.data ?? []
  const [kind, setKind] = useState<BipKind>('AUTHORITY_ADD')
  const [values, setValues] = useState<Values>({ miningMode: 'LIMITED' })
  const [review, setReview] = useState<GovernanceReview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submittedHash, setSubmittedHash] = useState<string | null>(null)

  const setValue = (key: string, value: string | boolean) => setValues(current => ({ ...current, [key]: value }))
  const selectValidator = (value: string) => {
    const validator = governanceOptions.data?.validators.find(option => option.address === value)
    setValues(current => ({
      ...current,
      validatorAddress: value,
      ...(kind === 'VALIDATOR_MINING_POLICY_SET' && validator ? {
        miningMode: validator.miningLimitMode,
        maxMiningSharePercent: miningShareBpsToPercentage(validator.maxMiningShareBps),
      } : {}),
    }))
  }
  const prepare = async () => {
    setError(null)
    try { setReview(await prepareGovernanceTransaction(createPayload(kind, values, tokens))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The BIP could not be prepared.') }
  }
  const confirm = async () => {
    if (!review || pending) return
    setPending(true)
    setError(null)
    try {
      const result = await confirmGovernanceTransaction(review)
      setSubmittedHash(result.hash)
      setReview(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The BIP could not be submitted.')
    } finally { setPending(false) }
  }

  return (
    <AppLayout title="Create BIP">
      <div className="space-y-4">
        {authority.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
        {authority.isError && <Alert variant="destructive"><AlertDescription>Authority status could not be loaded.</AlertDescription></Alert>}
        {authority.data && !authority.data.authority && <Alert><AlertDescription>This address is not a current network authority.</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {submittedHash && <Alert><Check className="h-4 w-4" /><AlertDescription>BIP submitted: <span className="font-mono break-all">{submittedHash}</span></AlertDescription></Alert>}
        {authority.data?.authority && !review && !submittedHash && (
          <Card>
            <CardHeader><CardTitle className="text-base">Proposal</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">BIP type</label>
                <Select value={kind} onValueChange={value => { setKind(value as BipKind); setValues({ miningMode: 'LIMITED' }); setError(null) }}>
                  <SelectTrigger className="h-9 w-full px-2.5 text-sm" size="lg"><SelectValue>{bipTypeLabels[kind]}</SelectValue></SelectTrigger>
                  <SelectContent>{bipKinds.map(option => <SelectItem key={option} value={option}>{bipTypeLabels[option]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {governanceOptions.isError && (
                <Alert variant="destructive"><AlertDescription>Governance selector options could not be loaded.</AlertDescription></Alert>
              )}
              {fields[kind].map(field => field.kind === 'checkbox' ? (
                <label key={field.key} className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={values[field.key] === true} onChange={event => setValue(field.key, event.target.checked)} />
                  {field.label}
                </label>
              ) : field.kind === 'miningMode' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <Select value={String(values[field.key] ?? 'LIMITED')} onValueChange={value => setValue(field.key, value ?? 'LIMITED')}>
                    <SelectTrigger className="h-9 w-full px-2.5 text-sm" size="lg"><SelectValue>{values[field.key] === 'UNLIMITED' ? 'Unlimited' : 'Limited'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="LIMITED">Limited</SelectItem><SelectItem value="UNLIMITED">Unlimited</SelectItem></SelectContent>
                  </Select>
                </div>
              ) : field.kind === 'token' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <TokenSelect className="h-9 text-sm" value={String(values[field.key] ?? '')}
                    onChange={value => setValue(field.key, value ?? '')} />
                </div>
              ) : field.kind === 'authority' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <OptionSelect value={String(values[field.key] ?? '')} placeholder={governanceOptions.isLoading ? 'Loading authorities…' : 'Select an authority'}
                    disabled={governanceOptions.isLoading} onChange={value => setValue(field.key, value)}
                    options={(governanceOptions.data?.authorities ?? []).map(value => ({ value, label: shortenAddress(value) }))} />
                </div>
              ) : field.kind === 'alias' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <OptionSelect value={String(values[field.key] ?? '')} placeholder={governanceOptions.isLoading ? 'Loading aliases…' : 'Select an alias'}
                    disabled={governanceOptions.isLoading} onChange={value => setValue(field.key, value)}
                    options={(governanceOptions.data?.addressAliases ?? []).map(option => ({ value: option.alias, label: `${option.alias} — ${shortenAddress(option.address)}` }))} />
                  {governanceOptions.data?.addressAliasesTruncated && <p className="text-xs text-muted-foreground">Showing the first 100 aliases.</p>}
                </div>
              ) : field.kind === 'validator' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <OptionSelect value={String(values[field.key] ?? '')} placeholder={governanceOptions.isLoading ? 'Loading validators…' : 'Select a validator'}
                    disabled={governanceOptions.isLoading} onChange={selectValidator}
                    options={(governanceOptions.data?.validators ?? []).map(option => ({ value: option.address, label: shortenAddress(option.address) }))} />
                </div>
              ) : field.kind === 'tokenAmount' ? (() => {
                const token = tokens.find(item => compareAddress(item.address, String(values.tokenAddress ?? '')))
                return (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}</label>
                    <FormattedAmountInput
                      value={String(values[field.key] ?? '')}
                      decimals={token?.numberOfDecimals}
                      symbol={token?.smallestUnitName}
                      unavailableLabel="Select a token first"
                      onChange={value => setValue(field.key, value)}
                    />
                  </div>
                )
              })() : field.kind === 'nativeAmount' ? (() => {
                const token = tokens.find(item => compareAddress(item.address, ZERO_ADDRESS))
                return (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}{field.optional ? ' (optional)' : ''}</label>
                    <FormattedAmountInput
                      value={String(values[field.key] ?? '')}
                      decimals={token?.numberOfDecimals}
                      symbol={token?.smallestUnitName}
                      unavailableLabel="Loading native token…"
                      onChange={value => setValue(field.key, value)}
                    />
                  </div>
                )
              })() : field.kind === 'createdTokenAmount' ? (() => {
                const parsedDecimals = /^\d+$/.test(String(values.numberOfDecimals ?? ''))
                  ? Number(values.numberOfDecimals)
                  : undefined
                return (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}{field.optional ? ' (optional)' : ''}</label>
                    <FormattedAmountInput
                      value={String(values[field.key] ?? '')}
                      decimals={parsedDecimals !== undefined && parsedDecimals <= 255 ? parsedDecimals : undefined}
                      unavailableLabel="Enter token decimals first"
                      onChange={value => setValue(field.key, value)}
                    />
                  </div>
                )
              })() : field.key === 'maxMiningSharePercent' && values.miningMode === 'UNLIMITED' ? null : field.kind === 'percentage' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <NumericFormat customInput={Input} value={String(values[field.key] ?? '')} valueIsNumericString
                    decimalScale={2} allowNegative={false} suffix=" %" placeholder="e.g. 25.00 %"
                    isAllowed={({ floatValue }) => floatValue === undefined || floatValue <= 40}
                    onValueChange={({ value }) => setValue(field.key, value)} />
                </div>
              ) : (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}{field.optional ? ' (optional)' : ''}</label>
                  <Input type={field.kind === 'number' ? 'text' : field.kind ?? 'text'} inputMode={field.kind === 'number' ? 'numeric' : undefined}
                    placeholder={field.placeholder} value={String(values[field.key] ?? '')} onChange={event => setValue(field.key, event.target.value)} />
                </div>
              ))}
              <Button className="w-full" onClick={() => void prepare()}>Review BIP transaction</Button>
            </CardContent>
          </Card>
        )}
        {review && (
          <Card className="border-primary/40">
            <CardHeader><CardTitle className="text-base">Review BIP transaction</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <DataRow label="BIP type" value={bipTypeLabels[kind]} />
              {Object.entries(review.payload)
                .filter(([key]) => key !== 'payloadType' && key !== 'payloadVersion')
                .map(([key, value]) => <DataRow key={key} label={displayPayloadKey(key)} value={displayPayloadValue(value, key)} />)}
              <DataRow label="Fee (base units)" value={review.fee.toString()} />
              <DataRow label="Nonce" value={review.nonce.toString()} />
              <div className="grid grid-cols-2 gap-3 pt-3">
                <Button variant="outline" disabled={pending} onClick={() => setReview(null)}><X className="h-4 w-4" /> Edit</Button>
                <Button disabled={pending} onClick={() => void confirm()}>{pending ? <Spinner /> : <Check className="h-4 w-4" />} Submit</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
