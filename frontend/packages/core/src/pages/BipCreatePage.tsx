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
} from '@goldenera/cryptoj'
import type { Address, TxPayload } from '@goldenera/cryptoj'
import { useGetAuthorityStatusHook } from '@project/api'
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
import { DataRow } from '../components/DataRow'
import { AppLayout } from '../layouts/Layouts'
import { confirmGovernanceTransaction, prepareGovernanceTransaction, type GovernanceReview } from '../services/GovernanceSubmission'
import { useWalletStore } from '../store/WalletStore'
import { bipTypeLabels, displayPayloadKey, displayPayloadValue } from '../utils/GovernanceUtil'

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
  kind?: 'text' | 'number' | 'url' | 'checkbox' | 'miningMode'
  optional?: boolean
}

const addressField = (key: string, label: string): FieldDefinition => ({ key, label, placeholder: '0x…' })
const fields: Record<BipKind, FieldDefinition[]> = {
  AUTHORITY_ADD: [addressField('authorityAddress', 'Authority address')],
  AUTHORITY_REMOVE: [addressField('authorityAddress', 'Authority address')],
  ADDRESS_ALIAS_ADD: [addressField('address', 'Address'), { key: 'alias', label: 'Alias' }],
  ADDRESS_ALIAS_REMOVE: [{ key: 'alias', label: 'Alias' }],
  TOKEN_CREATE: [
    { key: 'name', label: 'Token name' },
    { key: 'smallestUnitName', label: 'Symbol / smallest unit name' },
    { key: 'numberOfDecimals', label: 'Decimals', kind: 'number' },
    { key: 'websiteUrl', label: 'Website URL', kind: 'url', optional: true },
    { key: 'logoUrl', label: 'Logo URL', kind: 'url', optional: true },
    { key: 'maxSupply', label: 'Maximum supply (base units)', kind: 'number', optional: true },
    { key: 'userBurnable', label: 'Users may burn this token', kind: 'checkbox', optional: true },
  ],
  TOKEN_UPDATE: [
    addressField('tokenAddress', 'Token address'),
    { key: 'name', label: 'New token name', optional: true },
    { key: 'smallestUnitName', label: 'New symbol / smallest unit name', optional: true },
    { key: 'websiteUrl', label: 'New website URL', kind: 'url', optional: true },
    { key: 'logoUrl', label: 'New logo URL', kind: 'url', optional: true },
  ],
  TOKEN_MINT: [
    addressField('tokenAddress', 'Token address'), addressField('recipient', 'Recipient address'),
    { key: 'amount', label: 'Amount (base units)', kind: 'number' },
  ],
  TOKEN_BURN: [
    addressField('tokenAddress', 'Token address'), addressField('sender', 'Address to burn from'),
    { key: 'amount', label: 'Amount (base units)', kind: 'number' },
  ],
  VALIDATOR_ADD: [
    addressField('validatorAddress', 'Validator address'),
    { key: 'miningMode', label: 'Mining limit', kind: 'miningMode' },
    { key: 'maxMiningShareBps', label: 'Maximum mining share (basis points, 1–4000)', kind: 'number', optional: true },
  ],
  VALIDATOR_REMOVE: [addressField('validatorAddress', 'Validator address')],
  NETWORK_PARAMS_SET: [
    { key: 'blockReward', label: 'Block reward (base units)', kind: 'number', optional: true },
    { key: 'blockRewardPoolAddress', label: 'Block reward pool address', optional: true },
    { key: 'targetMiningTimeMs', label: 'Target mining time (ms)', kind: 'number', optional: true },
    { key: 'asertHalfLifeBlocks', label: 'ASERT half-life (blocks)', kind: 'number', optional: true },
    { key: 'minDifficulty', label: 'Minimum difficulty', kind: 'number', optional: true },
    { key: 'minTxBaseFee', label: 'Minimum transaction base fee', kind: 'number', optional: true },
    { key: 'minTxByteFee', label: 'Minimum transaction byte fee', kind: 'number', optional: true },
    { key: 'validatorMiningWindowBlocks', label: 'Validator mining window (100–10000 blocks)', kind: 'number', optional: true },
    { key: 'miningRewardVestingBlocks', label: 'Mining reward vesting (0–1000000 blocks)', kind: 'number', optional: true },
  ],
  VALIDATOR_MINING_POLICY_SET: [
    addressField('validatorAddress', 'Validator address'),
    { key: 'miningMode', label: 'Mining limit', kind: 'miningMode' },
    { key: 'maxMiningShareBps', label: 'Maximum mining share (basis points, 1–4000)', kind: 'number', optional: true },
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

function positiveUint(values: Values, key: string, label: string): bigint {
  const value = uint(values, key, label)
  if (value === null || value === 0n) throw new Error(`${label} must be greater than zero.`)
  return value
}

function miningPolicy(values: Values) {
  const unlimited = values.miningMode === 'UNLIMITED'
  return {
    miningLimitMode: unlimited ? MiningLimitMode.UNLIMITED : MiningLimitMode.LIMITED,
    maxMiningShareBps: unlimited ? 0n : uint(values, 'maxMiningShareBps', 'Maximum mining share') ?? 0n,
  }
}

function createPayload(kind: BipKind, values: Values): TxPayload {
  switch (kind) {
    case 'AUTHORITY_ADD': return createAuthorityAddPayload(address(values, 'authorityAddress', 'Authority address'))
    case 'AUTHORITY_REMOVE': return createAuthorityRemovePayload(address(values, 'authorityAddress', 'Authority address'))
    case 'ADDRESS_ALIAS_ADD': return createAddressAliasAddPayload(address(values, 'address', 'Address'), required(values, 'alias', 'Alias'))
    case 'ADDRESS_ALIAS_REMOVE': return createAddressAliasRemovePayload(required(values, 'alias', 'Alias'))
    case 'TOKEN_CREATE': {
      const decimals = Number(uint(values, 'numberOfDecimals', 'Decimals'))
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Decimals must be between 0 and 255.')
      return createTokenCreatePayload({
        name: required(values, 'name', 'Token name'),
        smallestUnitName: required(values, 'smallestUnitName', 'Smallest unit name'),
        numberOfDecimals: decimals,
        websiteUrl: optionalText(values, 'websiteUrl'),
        logoUrl: optionalText(values, 'logoUrl'),
        maxSupply: uint(values, 'maxSupply', 'Maximum supply', true),
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
    case 'TOKEN_MINT': return createTokenMintPayload(
      address(values, 'tokenAddress', 'Token address'), address(values, 'recipient', 'Recipient address'),
      positiveUint(values, 'amount', 'Amount'),
    )
    case 'TOKEN_BURN': return createTokenBurnPayload(
      address(values, 'tokenAddress', 'Token address'), address(values, 'sender', 'Sender address'),
      positiveUint(values, 'amount', 'Amount'),
    )
    case 'VALIDATOR_ADD': return createValidatorAddPayload(address(values, 'validatorAddress', 'Validator address'), miningPolicy(values))
    case 'VALIDATOR_REMOVE': return createValidatorRemovePayload(address(values, 'validatorAddress', 'Validator address'))
    case 'VALIDATOR_MINING_POLICY_SET': return createValidatorMiningPolicySetPayload(address(values, 'validatorAddress', 'Validator address'), miningPolicy(values))
    case 'NETWORK_PARAMS_SET': {
      const parameters = {
        blockReward: uint(values, 'blockReward', 'Block reward', true),
        blockRewardPoolAddress: optionalText(values, 'blockRewardPoolAddress')
          ? address(values, 'blockRewardPoolAddress', 'Block reward pool address') : null,
        targetMiningTimeMs: uint(values, 'targetMiningTimeMs', 'Target mining time', true),
        asertHalfLifeBlocks: uint(values, 'asertHalfLifeBlocks', 'ASERT half-life', true),
        minDifficulty: uint(values, 'minDifficulty', 'Minimum difficulty', true),
        minTxBaseFee: uint(values, 'minTxBaseFee', 'Minimum transaction base fee', true),
        minTxByteFee: uint(values, 'minTxByteFee', 'Minimum transaction byte fee', true),
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
  const [kind, setKind] = useState<BipKind>('AUTHORITY_ADD')
  const [values, setValues] = useState<Values>({ miningMode: 'LIMITED' })
  const [review, setReview] = useState<GovernanceReview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submittedHash, setSubmittedHash] = useState<string | null>(null)

  const setValue = (key: string, value: string | boolean) => setValues(current => ({ ...current, [key]: value }))
  const prepare = async () => {
    setError(null)
    try { setReview(await prepareGovernanceTransaction(createPayload(kind, values))) }
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
                  <SelectTrigger className="w-full"><SelectValue>{bipTypeLabels[kind]}</SelectValue></SelectTrigger>
                  <SelectContent>{bipKinds.map(option => <SelectItem key={option} value={option}>{bipTypeLabels[option]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {fields[kind].map(field => field.kind === 'checkbox' ? (
                <label key={field.key} className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={values[field.key] === true} onChange={event => setValue(field.key, event.target.checked)} />
                  {field.label}
                </label>
              ) : field.kind === 'miningMode' ? (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  <Select value={String(values[field.key] ?? 'LIMITED')} onValueChange={value => setValue(field.key, value ?? 'LIMITED')}>
                    <SelectTrigger className="w-full"><SelectValue>{values[field.key] === 'UNLIMITED' ? 'Unlimited' : 'Limited'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="LIMITED">Limited</SelectItem><SelectItem value="UNLIMITED">Unlimited</SelectItem></SelectContent>
                  </Select>
                </div>
              ) : field.key === 'maxMiningShareBps' && values.miningMode === 'UNLIMITED' ? null : (
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
                .map(([key, value]) => <DataRow key={key} label={displayPayloadKey(key)} value={displayPayloadValue(value)} />)}
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
