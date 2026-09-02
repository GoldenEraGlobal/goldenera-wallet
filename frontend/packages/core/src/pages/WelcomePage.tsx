import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@project/ui'
import type { ActivityComponentType } from '@stackflow/react'
import { LegacyBiometricMigration } from '../components/auth/LegacyBiometricMigration'
import { UnlockWallet } from '../components/auth/UnlockWallet'
import { WelcomeCard } from '../components/WelcomeCard'
import { BasicLayout } from '../layouts/Layouts'
import { useWalletStore } from '../store/WalletStore'

export const WelcomePage: ActivityComponentType<'WelcomePage'> = () => {
  const status = useWalletStore(state => state.status)
  const error = useWalletStore(state => state.error)
  const initialize = useWalletStore(state => state.initialize)

  return (
    <BasicLayout>
      {status === 'error' ? (
        <Card className="w-full">
          <CardHeader><CardTitle>Wallet storage unavailable</CardTitle><CardDescription>{error}</CardDescription></CardHeader>
          <CardContent><Button className="w-full" onClick={() => void initialize()}>Retry loading wallet</Button></CardContent>
        </Card>
      ) : status === 'no_wallet' ? (
        <div className="w-full space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <WelcomeCard />
        </div>
      ) : (
        <div className="w-full space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <UnlockWallet />
          <LegacyBiometricMigration />
        </div>
      )}
    </BasicLayout>
  )
}
