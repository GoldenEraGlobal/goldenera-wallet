import { CryptoUtil, EncryptedPayloadCorruptionError, bufferToHex, parsePasswordEncryptedPayload } from '../utils/CryptoUtil'
import { WalletUtil } from '../utils/WalletUtil'
import { getBasicStorage, getStorage, STORAGE_MNEMONIC_KEY, STORAGE_PHRASE_BACKEDUP_KEY } from './StorageService'

export interface WalletVault {
  version: 2
  id: string
  revision: number
  address: string | null
  encryptedMnemonic: string
  backedUp: boolean
}

export type WalletVaultSource = 'v2' | 'raw-v1' | 'outer-v2'
export interface WalletVaultRecord {
  vault: WalletVault
  source: WalletVaultSource
}

/** A persisted encrypted envelope cannot be safely unlocked or mutated. */
export class WalletVaultCorruptionError extends Error {
  readonly code = 'WALLET_VAULT_CORRUPTED'

  constructor() {
    super('Wallet storage is corrupted. Do not delete or replace it; recover this wallet with its recovery phrase.')
    this.name = 'WalletVaultCorruptionError'
  }
}

export const isWalletVaultCorruptionError = (error: unknown): error is WalletVaultCorruptionError =>
  error instanceof WalletVaultCorruptionError

interface WalletVaultMetadataSnapshot {
  id: string
  revision: number
  address: string | null
  backedUp: boolean
  ciphertextDigest: string
}
interface WalletVaultMetadata extends WalletVaultMetadataSnapshot {
  version: 2
  pending?: WalletVaultMetadataSnapshot
}
interface StoredSeed {
  stored: string
  ciphertext: string
  outerVault: WalletVault | null
}

const STORAGE_VAULT_METADATA_KEY = 'wallet_vault_v2'
const WALLET_MUTATION_LOCK_NAME = 'goldenera-wallet-vault-mutation'
let mutationQueue: Promise<unknown> = Promise.resolve()
const walletMutationScopeKey: unique symbol = Symbol('wallet-mutation-scope')
export interface WalletMutationScope { readonly [walletMutationScopeKey]: true }
const activeMutationScopes = new WeakSet<object>()

async function runWalletMutation<T>(operation: (scope: WalletMutationScope) => Promise<T>): Promise<T> {
  const scope = Object.freeze({ [walletMutationScopeKey]: true }) as WalletMutationScope
  activeMutationScopes.add(scope)
  try { return await operation(scope) } finally { activeMutationScopes.delete(scope) }
}

export function assertWalletMutationScope(scope: WalletMutationScope): void {
  if (!activeMutationScopes.has(scope)) throw new Error('Wallet mutation scope is not active')
}

/** Serializes the read/check/write across tabs; never use a localStorage lease. */
export function withWalletMutation<T>(operation: (scope: WalletMutationScope) => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(WALLET_MUTATION_LOCK_NAME, () => runWalletMutation(operation))
  }
  // Modern PWA browsers support Web Locks. Without it, reading/unlocking is
  // still safe, but silently permitting competing browser writes is not.
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    return Promise.reject(new Error('This browser cannot safely update a wallet across tabs. Update your browser and retry.'))
  }
  const run = () => runWalletMutation(operation)
  const result = mutationQueue.then(run, run)
  mutationQueue = result.catch(() => undefined)
  return result
}

function validAddress(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value))
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseSnapshot(value: unknown): WalletVaultMetadataSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<WalletVaultMetadataSnapshot>
  if (typeof record.id !== 'string' || !record.id
    || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0
    || !validAddress(record.address)
    || typeof record.backedUp !== 'boolean'
    || !validDigest(record.ciphertextDigest)) return null
  return record as WalletVaultMetadataSnapshot
}

function parseMetadata(value: unknown): WalletVaultMetadata | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<WalletVaultMetadata>
  const snapshot = parseSnapshot(record)
  if (record.version !== 2 || !snapshot) return null
  if (record.pending === undefined) return { version: 2, ...snapshot }
  const pending = parseSnapshot(record.pending)
  // The committed snapshot is independently authoritative when its digest still
  // matches the seed. Corruption in the optional crash-recovery candidate must
  // not poison that valid committed state; inspect() still fails closed if the
  // committed digest does not match and no valid pending snapshot is available.
  if (!pending || pending.id !== snapshot.id) return { version: 2, ...snapshot }
  return { version: 2, ...snapshot, pending }
}

function parseV2(value: Record<string, unknown>): WalletVault {
  if (typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || typeof value.encryptedMnemonic !== 'string' || typeof value.backedUp !== 'boolean'
    || !validAddress(value.address)) {
    throw new Error('Invalid wallet metadata')
  }
  parseRawCiphertext(value.encryptedMnemonic)
  return value as unknown as WalletVault
}

function parseRawCiphertext(raw: string): void {
  try {
    parsePasswordEncryptedPayload(raw)
  } catch (error) {
    if (error instanceof EncryptedPayloadCorruptionError) throw new WalletVaultCorruptionError()
    throw error
  }
}

async function digestCiphertext(raw: string): Promise<string> {
  return bufferToHex(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))
}

async function readStoredSeed(): Promise<StoredSeed | null> {
  const storage = getStorage()
  if (!await storage.exists(STORAGE_MNEMONIC_KEY)) return null
  const stored = await storage.get(STORAGE_MNEMONIC_KEY)
  // exists() already established that a record is present. A null read is an
  // unavailable/unstable transport result, while every returned string is bytes
  // that must be parsed and classified without rewriting them.
  if (stored === null) throw new Error('The stored wallet is unreadable. Retry without creating another wallet.')
  let parsed: unknown
  try { parsed = JSON.parse(stored) } catch { throw new WalletVaultCorruptionError() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new WalletVaultCorruptionError()
  const value = parsed as Record<string, unknown>
  if (value.version === 2) {
    try {
      const outerVault = parseV2(value)
      return { stored, ciphertext: outerVault.encryptedMnemonic, outerVault }
    } catch (error) {
      if (isWalletVaultCorruptionError(error)) throw error
      throw new WalletVaultCorruptionError()
    }
  }
  parseRawCiphertext(stored)
  return { stored, ciphertext: stored, outerVault: null }
}

function metadataSnapshot(vault: WalletVault, ciphertextDigest: string): WalletVaultMetadataSnapshot {
  return {
    id: vault.id,
    revision: vault.revision,
    address: vault.address,
    backedUp: vault.backedUp,
    ciphertextDigest,
  }
}

async function writeMetadata(metadata: WalletVaultMetadata): Promise<void> {
  const basic = getBasicStorage()
  await basic.setItem(STORAGE_VAULT_METADATA_KEY, metadata)
  const saved = parseMetadata(await basic.getItem(STORAGE_VAULT_METADATA_KEY))
  if (!saved || JSON.stringify(saved) !== JSON.stringify(metadata)) throw new Error('Wallet metadata persistence verification failed')
}

async function inspectStoredSeed(seed: StoredSeed): Promise<WalletVaultRecord> {
  const basic = getBasicStorage()
  const [legacyBackedUp, rawMetadata, digest] = await Promise.all([
    basic.getItem<boolean>(STORAGE_PHRASE_BACKEDUP_KEY).then(value => value === true),
    basic.getItem(STORAGE_VAULT_METADATA_KEY),
    digestCiphertext(seed.ciphertext),
  ])

  // A cached v2 bundle can wrap a sidecar-managed raw ciphertext back into an
  // outer object. The digest-bound sidecar remains authoritative in that case;
  // otherwise identity/revision could roll back to the cached bundle's view.
  if (rawMetadata !== null) {
    const metadata = parseMetadata(rawMetadata)
    if (!metadata) throw new Error('Invalid wallet metadata')
    const selected = metadata.ciphertextDigest === digest
      ? metadata
      : metadata.pending?.ciphertextDigest === digest
        ? metadata.pending
        : null
    if (!selected) throw new Error('Wallet ciphertext no longer matches its metadata. Restore the original wallet data before retrying.')
    return {
      source: selected === metadata ? 'v2' : 'raw-v1',
      vault: {
        version: 2,
        id: selected.id,
        revision: selected.revision,
        address: selected.address,
        encryptedMnemonic: seed.ciphertext,
        backedUp: selected.backedUp || seed.outerVault?.backedUp === true || legacyBackedUp,
      },
    }
  }

  // Outer-v2 was the format written by the immediately previous production
  // bundle. Preserve it byte-for-byte unless an explicit wallet update occurs.
  if (seed.outerVault) {
    return {
      source: 'outer-v2',
      vault: { ...seed.outerVault, backedUp: seed.outerVault.backedUp || legacyBackedUp },
    }
  }

  // Raw ciphertext remains at the original key so an older cached production
  // PWA can continue decrypting it during the compatibility rollout.
  return {
    source: 'raw-v1',
    vault: {
      version: 2,
      id: `legacy-${digest}`,
      revision: 0,
      address: null,
      encryptedMnemonic: seed.ciphertext,
      backedUp: legacyBackedUp,
    },
  }
}

async function hasWalletMetadataResidue(): Promise<boolean> {
  const basic = getBasicStorage()
  const [metadata, legacyBackedUp] = await Promise.all([
    basic.getItem(STORAGE_VAULT_METADATA_KEY),
    basic.getItem(STORAGE_PHRASE_BACKEDUP_KEY),
  ])
  return metadata !== null || legacyBackedUp !== null
}

async function clearOrphanedMetadata(): Promise<void> {
  const basic = getBasicStorage()
  await basic.removeItem(STORAGE_VAULT_METADATA_KEY)
  await basic.removeItem(STORAGE_PHRASE_BACKEDUP_KEY)
  if (await basic.getItem(STORAGE_VAULT_METADATA_KEY) !== null
    || await basic.getItem(STORAGE_PHRASE_BACKEDUP_KEY) !== null) {
    throw new Error('Older wallet metadata could not be removed before creating a wallet')
  }
}

async function inspectOrCleanOrphanedMetadata(scope: WalletMutationScope): Promise<WalletVaultRecord | null> {
  assertWalletMutationScope(scope)
  const confirmedSeed = await readStoredSeed()
  if (confirmedSeed) return inspectStoredSeed(confirmedSeed)
  if (!await hasWalletMetadataResidue()) return null

  // Raw-v1, outer-v2, and pending-sidecar ciphertext commits all use the sole
  // mnemonic key. Re-prove its absence immediately before deleting only the
  // non-secret sidecar/backup markers. Any transport failure or corrupt present
  // seed throws before a metadata mutation, and the enclosing lock excludes writers.
  const finalSeedCheck = await readStoredSeed()
  if (finalSeedCheck) return inspectStoredSeed(finalSeedCheck)
  await clearOrphanedMetadata()
  return null
}

export const WalletVaultService = {
  async inspect(scope?: WalletMutationScope): Promise<WalletVaultRecord | null> {
    if (scope !== undefined) assertWalletMutationScope(scope)
    const seed = await readStoredSeed()
    if (seed) return inspectStoredSeed(seed)
    if (!await hasWalletMetadataResidue()) return null
    if (scope) return inspectOrCleanOrphanedMetadata(scope)

    if (typeof navigator !== 'undefined' && navigator.locks) {
      let acquired = false
      const result = await navigator.locks.request(
        WALLET_MUTATION_LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        lock => {
          if (!lock) return null
          acquired = true
          return runWalletMutation(inspectOrCleanOrphanedMetadata)
        },
      )
      if (!acquired) throw new Error('Wallet storage is changing in another tab. Retry after it finishes.')
      return result
    }
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      throw new Error('This browser cannot safely remove orphaned wallet metadata. Update your browser and retry.')
    }
    // Non-browser/test environments have no cross-tab writer to race.
    return runWalletMutation(inspectOrCleanOrphanedMetadata)
  },

  async read(scope?: WalletMutationScope): Promise<WalletVault | null> {
    return (await this.inspect(scope))?.vault ?? null
  },

  async write(vault: WalletVault): Promise<void> {
    parseV2(vault as unknown as Record<string, unknown>)
    const storage = getStorage()
    const basic = getBasicStorage()
    const existingSeed = await readStoredSeed()
    const existingMetadata = await basic.getItem(STORAGE_VAULT_METADATA_KEY)

    // Keep an established outer-v2 wallet in the representation understood by
    // the immediately previous production bundle. Raw-only legacy wallets use
    // the digest-bound sidecar path below instead.
    if (existingSeed?.outerVault && existingMetadata === null) {
      const current = await this.inspect()
      if (!current || current.source !== 'outer-v2' || current.vault.id !== vault.id) {
        throw new Error('Wallet changed during persistence')
      }
      const raw = JSON.stringify(vault)
      await storage.save(STORAGE_MNEMONIC_KEY, raw)
      if (await storage.get(STORAGE_MNEMONIC_KEY) !== raw) throw new Error('Wallet persistence verification failed')
      await basic.setItem(STORAGE_PHRASE_BACKEDUP_KEY, vault.backedUp)
      const saved = await this.inspect()
      if (!saved || saved.source !== 'outer-v2'
        || saved.vault.id !== vault.id
        || saved.vault.revision !== vault.revision
        || saved.vault.address !== vault.address
        || saved.vault.encryptedMnemonic !== vault.encryptedMnemonic
        || saved.vault.backedUp !== vault.backedUp) {
        throw new Error('Wallet persistence verification failed')
      }
      return
    }

    const targetDigest = await digestCiphertext(vault.encryptedMnemonic)
    const targetMetadata: WalletVaultMetadata = { version: 2, ...metadataSnapshot(vault, targetDigest) }

    if (existingSeed) {
      const current = await this.inspect()
      if (!current || current.vault.id !== vault.id) throw new Error('Wallet changed during persistence')
      const currentDigest = await digestCiphertext(existingSeed.ciphertext)
      if (existingSeed.ciphertext !== vault.encryptedMnemonic) {
        await writeMetadata({
          version: 2,
          ...metadataSnapshot(current.vault, currentDigest),
          pending: metadataSnapshot(vault, targetDigest),
        })
      } else if (existingSeed.outerVault) {
        // Commit the sidecar first. If externalizing the old outer-v2 record is
        // interrupted, either representation still retains the same identity.
        await writeMetadata(targetMetadata)
      }
    } else {
      if (existingMetadata !== null) {
        const parsedExisting = parseMetadata(existingMetadata)
        if (!parsedExisting || JSON.stringify(parsedExisting) !== JSON.stringify(targetMetadata)) {
          throw new Error('Orphaned wallet metadata must be inspected and removed before saving a different wallet')
        }
      }
      // On the initial commit, the digest-bound identity and backup state become
      // authoritative before the encrypted seed. A crash after the seed write can
      // therefore never reinterpret an imported wallet as an unbacked raw-v1 seed.
      await writeMetadata(targetMetadata)
    }

    if (!existingSeed || existingSeed.stored !== vault.encryptedMnemonic) {
      await storage.save(STORAGE_MNEMONIC_KEY, vault.encryptedMnemonic)
      if (await storage.get(STORAGE_MNEMONIC_KEY) !== vault.encryptedMnemonic) throw new Error('Wallet persistence verification failed')
    }

    // Existing-wallet replacements retain the pending-sidecar protocol. Initial
    // commits already installed this exact authoritative snapshot before the seed.
    if (existingSeed) await writeMetadata(targetMetadata)
    await getBasicStorage().setItem(STORAGE_PHRASE_BACKEDUP_KEY, vault.backedUp)
    const saved = await this.inspect()
    if (!saved || saved.source !== 'v2'
      || saved.vault.id !== vault.id
      || saved.vault.revision !== vault.revision
      || saved.vault.address !== vault.address
      || saved.vault.encryptedMnemonic !== vault.encryptedMnemonic
      || saved.vault.backedUp !== vault.backedUp) {
      throw new Error('Wallet persistence verification failed')
    }
  },

  /** Removes compatibility metadata only after the authoritative seed is gone. */
  async removeMetadataAfterSeedDeletion(scope: WalletMutationScope): Promise<void> {
    assertWalletMutationScope(scope)
    // Parsing a present record is deliberate: corrupt seed bytes are never
    // treated as absence and can never authorize metadata deletion.
    if (await readStoredSeed()) throw new Error('Wallet metadata cannot be removed while its seed remains')
    await clearOrphanedMetadata()
  },

  async decrypt(vault: WalletVault, password: string): Promise<string | null> {
    try {
      // Validate even for an empty submitted password so callers never mistake
      // malformed persistence for a failed credential.
      parseRawCiphertext(vault.encryptedMnemonic)
      if (!password) return null
      return await CryptoUtil.decrypt(vault.encryptedMnemonic, password)
    } catch (error) {
      if (error instanceof EncryptedPayloadCorruptionError) throw new WalletVaultCorruptionError()
      throw error
    }
  },

  /** Commits compatible v2 metadata while preserving the old ciphertext key. */
  async promoteLegacy(record: WalletVaultRecord, password: string, mnemonic: string): Promise<WalletVault> {
    if (record.source !== 'raw-v1') return record.vault
    let derivedAddress: string
    try { derivedAddress = WalletUtil.restoreFromMnemonic(mnemonic).address } catch {
      throw new Error('Legacy wallet recovery phrase is invalid')
    }
    if (await this.decrypt(record.vault, password) !== mnemonic) {
      throw new Error('Legacy wallet password verification failed')
    }
    const current = await this.inspect()
    if (!current || current.vault.id !== record.vault.id
      || current.vault.revision !== record.vault.revision
      || current.vault.encryptedMnemonic !== record.vault.encryptedMnemonic
      || current.vault.backedUp !== record.vault.backedUp) {
      throw new Error('Wallet changed during legacy storage migration')
    }
    if (await this.decrypt(current.vault, password) !== mnemonic) {
      throw new Error('Legacy wallet password verification failed')
    }
    if (current.vault.address && current.vault.address.toLowerCase() !== derivedAddress.toLowerCase()) {
      throw new Error('Wallet identity changed during legacy storage migration')
    }

    // A sidecar or outer-v2 record may have appeared while a cached bundle was
    // running. It is authoritative only when it proves the same password, seed,
    // immutable identity, and address; never overwrite it.
    if (current.source !== 'raw-v1') {
      return current.vault
    }
    if (current.vault.address !== null) {
      // inspect() labels a digest-matched pending sidecar raw-v1 until its
      // ciphertext commit is finalized. Its bound address is authoritative;
      // commit that exact record without changing any vault field.
      await this.write(current.vault)
      const saved = await this.inspect()
      if (!saved || saved.source !== 'v2'
        || saved.vault.version !== current.vault.version
        || saved.vault.id !== current.vault.id
        || saved.vault.revision !== current.vault.revision
        || saved.vault.address !== current.vault.address
        || saved.vault.encryptedMnemonic !== current.vault.encryptedMnemonic
        || saved.vault.backedUp !== current.vault.backedUp
        || await this.decrypt(saved.vault, password) !== mnemonic) {
        throw new Error('Legacy wallet migration persistence could not be verified')
      }
      return saved.vault
    }

    const promoted: WalletVault = { ...current.vault, address: derivedAddress }
    await this.write(promoted)
    const saved = await this.inspect()
    if (!saved || saved.source !== 'v2'
      || saved.vault.version !== promoted.version
      || saved.vault.id !== promoted.id
      || saved.vault.revision !== promoted.revision
      || saved.vault.address !== promoted.address
      || saved.vault.encryptedMnemonic !== promoted.encryptedMnemonic
      || saved.vault.backedUp !== promoted.backedUp
      || await this.decrypt(saved.vault, password) !== mnemonic) {
      throw new Error('Legacy wallet migration persistence could not be verified')
    }
    return saved.vault
  },

  async create(
    mnemonic: string,
    address: string,
    password: string,
    backedUp: boolean,
    scope?: WalletMutationScope,
  ): Promise<WalletVault> {
    if (scope !== undefined) assertWalletMutationScope(scope)
    if (!password) throw new Error('A password is required')
    if (await this.read(scope)) throw new Error('A wallet already exists. Unlock it or explicitly delete it first.')
    const encryptedMnemonic = await CryptoUtil.encrypt(mnemonic, password)
    const vault: WalletVault = {
      version: 2,
      // The cached production v2 bundle derives this same identity when it sees
      // raw ciphertext and ignores the sidecar.
      id: `legacy-${await digestCiphertext(encryptedMnemonic)}`,
      revision: 0,
      address,
      encryptedMnemonic,
      backedUp,
    }
    await this.write(vault)
    const saved = await this.inspect(scope)
    if (!saved || saved.source !== 'v2'
      || saved.vault.version !== vault.version
      || saved.vault.id !== vault.id
      || saved.vault.revision !== vault.revision
      || saved.vault.address !== vault.address
      || saved.vault.encryptedMnemonic !== vault.encryptedMnemonic
      || saved.vault.backedUp !== vault.backedUp
      || await this.decrypt(saved.vault, password) !== mnemonic) {
      throw new Error('Wallet encryption persistence could not be verified')
    }
    return saved.vault
  },
}
