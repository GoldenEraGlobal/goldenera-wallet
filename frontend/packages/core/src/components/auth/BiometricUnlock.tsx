import { Button, Spinner } from '@project/ui'
import { Fingerprint, ScanFace, Shield } from 'lucide-react'
import type { ComponentProps} from 'react'
import { useRef, useState } from 'react'
import { useWalletStore } from '../../store/WalletStore'

export type BiometricUnlockProps = ComponentProps<typeof Button> & {
    onSuccess: (pass: string) => void | Promise<void>
    onPendingChange?: (pending: boolean) => void
    onFailed: () => void
}

export const BiometricUnlock = ({ onSuccess, onFailed, onPendingChange, onClick: onClickProp, disabled, ...props }: BiometricUnlockProps) => {
    const resolvePasswordWithBiometric = useWalletStore(state => state.resolvePasswordWithBiometric)
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

    const onClick = (e: any) => {
        if (busy.current || disabled) return
        busy.current = true
        onPendingChange?.(true)
        onClickProp?.(e)
        setLoading(true)
        resolvePasswordWithBiometric()
            .then((pass) => {
                if (!pass) {
                    onFailed()
                    return
                }
                return onSuccess(pass)
            })
            .catch(() => {
                onFailed()
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