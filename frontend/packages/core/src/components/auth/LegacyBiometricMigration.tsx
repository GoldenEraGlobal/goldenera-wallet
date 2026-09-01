import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PasswordInput } from '@project/ui'
import { useEffect, useRef, useState } from 'react'
import { useWalletStore, type LegacyRecovery } from '../../store/WalletStore'

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
  const busy = useRef(false)
  const ownsRecovery = useRef(false)

  useEffect(() => {
    setRecovery(null)
    setPassword('')
    setConfirm('')
  }, [revision])

  useEffect(() => () => {
    if (ownsRecovery.current) cancel()
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
    try { setRecovery(await recover()) } catch {
      cancel()
      ownsRecovery.current = false
      setError('Legacy verification was cancelled or unavailable. Use your password or recovery phrase instead.')
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
      setRecovery(null)
      setPassword('')
      setConfirm('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recovery upgrade could not finish. Keep the new password and retry.')
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
        {recovery ? (
          <form onSubmit={finish} className="space-y-3">
            <p className="text-sm">Your recovery phrase and address stay unchanged. Store the new password safely; secure biometrics can be enabled in Settings afterward.</p>
            <PasswordInput aria-label="New wallet password" placeholder="New wallet password" value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
            <PasswordInput aria-label="Confirm new wallet password" placeholder="Confirm new wallet password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={pending} />
            <Button type="submit" className="w-full" disabled={pending || !password || !confirm}>{pending ? 'Upgrading...' : 'Save new password and remove old biometrics'}</Button>
            <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => { cancel(); ownsRecovery.current = false; setRecovery(null); setPassword(''); setConfirm('') }}>Cancel recovery</Button>
          </form>
        ) : (
          <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => void start()}>{pending ? 'Verifying...' : 'Recover legacy biometric access'}</Button>
        )}
      </CardContent>
    </Card>
  )
}
