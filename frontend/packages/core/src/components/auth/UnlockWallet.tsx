import { UnlockCard } from './UnlockCard'

export const UnlockWallet = () => (
    <UnlockCard
        title='Welcome Back'
        description='Enter your password to unlock'
        onSuccess={async () => undefined}
    />
)
