import { Button, Spinner } from '@project/ui'
import { Fingerprint, ScanFace, Shield } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useRef, useState } from 'react'
import { useWalletStore } from '../../store/WalletStore'

export type BiometricUnlockProps = ComponentProps<typeof Button> & {
    onSuccess: (result: { password: string, mnemonic: string }) => void | Promise<void>
    onPendingChange?: (pending: boolean) => void
    onFailed: (error?: unknown) => void
}

export const BiometricUnlock = ({ onSuccess, onFailed, onPendingChange, onClick: onClickProp, disabled, ...props }: BiometricUnlockProps) => {
    const unlockWithBiometric = useWalletStore(state => state.unlockWithBiometric)
    const biometricType = useWalletStore(state => state.biometric.type)
    const biometricEnabled = useWalletStore(state => state.biometric.enabled && state.biometric.available)
    const [loading, setLoading] = useState(false)
    const busy = useRef(false)

    const getBiometricLabel = () => {
        return 'Use Biometrics'
    }

    const getBiometricButtonIcon = () => {
        switch (biometricType) {
            case 'face': return <ScanFace />
            case 'fingerprint': return <Fingerprint />
            default: return <Shield />
        }
    }

    const onClick: NonNullable<ComponentProps<typeof Button>['onClick']> = (e) => {
        if (busy.current || disabled) return
        busy.current = true
        onPendingChange?.(true)
        onClickProp?.(e)
        setLoading(true)
        unlockWithBiometric()
            .then(onSuccess)
            .catch((error) => {
                onFailed(error)
            })
            .finally(() => {
                busy.current = false
                setLoading(false)
                onPendingChange?.(false)
            })
    }

    if (!biometricEnabled) {
        return null
    }

    return (
        <Button
            {...props}
            type="button"
            disabled={loading || disabled}
            onClick={onClick}
        >
            {loading ? (
                <Spinner />
            ) : (
                getBiometricButtonIcon()
            )}
            {loading ? 'Verifying...' : getBiometricLabel()}
        </Button>
    )
}