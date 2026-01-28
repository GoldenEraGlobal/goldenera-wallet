import { ActivityComponentType } from "@stackflow/react"
import { Shield } from "lucide-react"
import { UnlockCard } from '../components/auth/UnlockCard'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from "../router/useFlow"
import { useWalletStore } from '../store/WalletStore'

export const ToggleBiometricPage: ActivityComponentType = () => {
    const { pop } = useFlow()
    const biometric = useWalletStore(state => state.biometric)
    const toggleBiometric = useWalletStore(state => state.toggleBiometric)

    return (
        <AppLayout title={biometric.enabled ? 'Disable Biometric' : 'Enable Biometric'} centered>
            <UnlockCard
                description={`Enter your password to ${biometric.enabled ? 'disable' : 'enable'} biometric`}
                icon={<Shield />}
                biometric={false}
                btnLabel={biometric.enabled ? 'Disable Biometric' : 'Enable Biometric'}
                onSuccess={async ({ password }) => {
                    await toggleBiometric(!biometric.enabled, password)
                    pop()
                }}
            />
        </AppLayout>
    )
}
