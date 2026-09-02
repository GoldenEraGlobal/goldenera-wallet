import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PasswordInput } from '@project/ui'
import { useEffect, useRef, useState } from 'react'
import { BiometricMigrationError } from '../../services/BiometricService'
import { WalletVaultCorruptionError } from '../../services/WalletVaultService'
import { LegacyRecoveryCompletionError, useWalletStore, type LegacyRecovery, type LegacyRecoveryNextAction } from '../../store/WalletStore'

/** One-time recovery only; legacy credentials are never a normal unlock option. */
export const LegacyBiometricMigration = () => {
  const legacy = useWalletStore(state => state.biometric.legacy)
  const revision = useWalletStore(state => state.sessionRevision)
  const recover = useWalletStore(state => state.recoverLegacyAccess)
  const complete = useWalletStore(state => state.completeLegacyRecovery)
  const cancel = useWalletStore(state => state.cancelLegacyRecovery)
  const [recovery, setRecovery] = useState<LegacyRecovery | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [nextAction, setNextAction] = useState<LegacyRecoveryNextAction | null>(null)
  const busy = useRef(false)
  const ownsRecovery = useRef(false)

  useEffect(() => {
    ownsRecovery.current = false
    setRecovery(null)
    setPassword('')
    setConfirm('')
    setNextAction(null)
  }, [revision])

  useEffect(() => () => {
    if (ownsRecovery.current) cancel()
    ownsRecovery.current = false
  }, [cancel])

  useEffect(() => {
    if (!recovery) return
    const expire = () => {
      if (Date.now() < recovery.expiresAt) return
      cancel()
      ownsRecovery.current = false
      setRecovery(null)
      setPassword('')
      setConfirm('')
      setError('Legacy verification expired. Verify your authenticator again to continue.')
    }
    const timer = setTimeout(expire, Math.max(0, recovery.expiresAt - Date.now()))
    document.addEventListener('visibilitychange', expire)
    window.addEventListener('pageshow', expire)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', expire)
      window.removeEventListener('pageshow', expire)
    }
  }, [cancel, recovery])

  if (!legacy) return null

  const start = async () => {
    if (busy.current) return
    busy.current = true
    ownsRecovery.current = true
    setPending(true)
    setError(null)
    setNextAction(null)
    try { setRecovery(await recover()) } catch (failure) {
      cancel()
      ownsRecovery.current = false
      if (failure instanceof WalletVaultCorruptionError) {
        setError(failure.message)
      } else if (failure instanceof BiometricMigrationError) {
        if (failure.code === 'BIOMETRIC_CANCELLED') setError('Legacy authenticator verification was cancelled or timed out. Retry or use your recovery phrase.')
        else if (failure.code === 'BIOMETRIC_SUPERSEDED' || failure.code === 'BIOMETRIC_GENERATION_CHANGED') setError('Wallet or biometric settings changed. Start verification again.')
        else if (failure.code === 'BIOMETRIC_GENERATION_MALFORMED') setError('Biometric metadata is damaged. Unlock with your password to reset biometric access safely.')
        else if (failure.code === 'BIOMETRIC_MALFORMED_STATE') setError('Older biometric recovery data is incomplete. Use your password or recovery phrase.')
        else setError(failure.message)
      } else {
        setError('Legacy verification is unavailable. Use your password or recovery phrase instead.')
      }
    }
    finally { busy.current = false; setPending(false) }
  }
  const finish = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!recovery || busy.current) return
    if (password !== confirm) { setError('Passwords do not match'); return }
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await complete(recovery, password)
      ownsRecovery.current = false
      setRecovery(null)
      setPassword('')
      setConfirm('')
    } catch (failure) {
      const clearForm = (action: LegacyRecoveryNextAction) => {
        // cancel() can only revoke a ticket now; it cannot defeat a redeemed
        // Store operation that is still finishing after unmount/cancellation.
        cancel()
        ownsRecovery.current = false
        setRecovery(null)
        setPassword('')
        setConfirm('')
        setNextAction(action)
      }
      if (failure instanceof LegacyRecoveryCompletionError) {
        if (failure.authorityConsumed || failure.code === 'AUTHORITY_UNAVAILABLE' || failure.code === 'DUPLICATE') {
          clearForm(failure.nextAction)
        }
        // PASSWORD_INVALID is the sole typed pre-redemption completion failure
        // that leaves the form intact for an edit.
        setError(failure.message)
      } else {
        // Never infer authority ownership from a short exception list. Unknown
        // Store failures fail closed rather than rendering a stale form.
        clearForm('verify-again')
        setError(failure instanceof Error ? failure.message : 'Recovery upgrade could not finish. Verify your authenticator again before retrying.')
      }
    } finally { busy.current = false; setPending(false) }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Upgrade older biometric access</CardTitle>
        <CardDescription>
          The older biometric storage format needs a security upgrade. Signing in with your password removes it safely.
          If you forgot that password, verify your existing authenticator here and choose a new password for the same wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">This does not protect copies of older wallet data that somebody may already have obtained.</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {nextAction === 'reload-and-check-new-password' ? (
          <p className="text-sm">The password replacement may have been saved. Reload the wallet and check the new password before trying recovery again.</p>
        ) : nextAction === 'unlock-with-new-password' ? (
          <p className="text-sm">The new password is saved. Unlock the wallet with that password, then retry Biometrics in Settings.</p>
        ) : recovery ? (
          <form onSubmit={finish} className="space-y-3">
            <p className="text-sm">Your recovery phrase and address stay unchanged. Store the new password safely; the wallet will then ask your authenticator to upgrade biometric access.</p>
            <PasswordInput aria-label="New wallet password" placeholder="New wallet password" value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
            <PasswordInput aria-label="Confirm new wallet password" placeholder="Confirm new wallet password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={pending} />
            <Button type="submit" className="w-full" disabled={pending || !password || !confirm}>{pending ? 'Upgrading...' : 'Save new password and upgrade biometrics'}</Button>
            <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => { cancel(); ownsRecovery.current = false; setRecovery(null); setPassword(''); setConfirm('') }}>Cancel recovery</Button>
          </form>
        ) : (
          <>
            {nextAction === 'verify-again' && <p className="text-sm">Verify your authenticator again before choosing a new password.</p>}
            <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => void start()}>{pending ? 'Verifying...' : 'Recover legacy biometric access'}</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
