import { ActivityComponentType } from "@stackflow/react"
import { UnlockWallet } from "../components/auth/UnlockWallet"
import { WelcomeCard } from "../components/WelcomeCard"
import { BasicLayout } from '../layouts/Layouts'
import { useWalletStore } from '../store/WalletStore'

export const WelcomePage: ActivityComponentType = () => {
    const hasWallet = useWalletStore((state) => state.status !== 'no_wallet')

    return (
        <BasicLayout>
            {hasWallet ? <UnlockWallet /> : <WelcomeCard />}
        </BasicLayout>
    )
}
