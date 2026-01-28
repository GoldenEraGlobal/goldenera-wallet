import { useWalletStore } from "../../store/WalletStore"
import { UnlockCard } from "./UnlockCard"

export const UnlockWallet = () => {
    const unlockWallet = useWalletStore((state) => state.unlockWallet)

    return (
        <UnlockCard
            title='Welcome Back'
            description='Enter your password to unlock'
            onSuccess={async (result) => {
                await unlockWallet(result.mnemonic)
            }}
        />
    )
}