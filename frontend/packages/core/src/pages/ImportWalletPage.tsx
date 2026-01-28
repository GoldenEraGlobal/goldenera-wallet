import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
    Alert, AlertDescription,
    Button,
    Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
    Field, FieldError, FieldLabel,
    PasswordInput,
    Spinner,
    Switch, Textarea
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import { AlertCircle, ChevronLeft, Download, Fingerprint, KeyRound, ScanFace, Shield } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { BasicLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { WalletUtil } from '../utils/WalletUtil'

// Schema for mnemonic input
const mnemonicSchema = z.object({
    mnemonic: z.string()
        .min(1, 'Recovery phrase is required')
        .refine((val) => {
            const words = val.trim().split(/\s+/)
            return words.length === 12 || words.length === 24
        }, 'Recovery phrase must be 12 or 24 words')
        .refine((val) => WalletUtil.isValidMnemonic(val.trim()), 'Invalid recovery phrase'),
})

// Schema for Password
// We rely on standard schema but can relax it for import if we just want to set ONE password
// Or enforce same rules. Enforcing rules is safer.
const passwordSchema = z.object({
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string(),
    biometric: z.boolean(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
})

type MnemonicForm = z.infer<typeof mnemonicSchema>
type PasswordForm = z.infer<typeof passwordSchema>

type Step = 'mnemonic' | 'password'

export const ImportWalletPage: ActivityComponentType = () => {
    const { pop } = useFlow()
    const importWallet = useWalletStore((state) => state.importWallet)
    const [step, setStep] = useState<Step>('mnemonic')
    const [mnemonic, setMnemonic] = useState('')
    const biometric = useWalletStore((state) => state.biometric)
    const [error, setError] = useState<string | null>(null)

    const mnemonicForm = useForm<MnemonicForm>({
        resolver: standardSchemaResolver(mnemonicSchema),
        defaultValues: {
            mnemonic: '',
        },
        mode: 'onChange',
    })

    const passwordForm = useForm<PasswordForm>({
        resolver: standardSchemaResolver(passwordSchema),
        defaultValues: {
            password: '',
            confirmPassword: '',
            biometric: biometric.available,
        },
        mode: 'onChange',
    })

    const handleMnemonicSubmit = (data: MnemonicForm) => {
        setMnemonic(data.mnemonic.trim().toLowerCase().replace(/\s+/g, ' '))
        setStep('password')
        setError(null)
    }

    const handleImport = async (data: PasswordForm) => {
        setError(null)
        try {
            await importWallet(mnemonic, data.password, data.biometric)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to import wallet')
        }
    }

    const handleBack = () => {
        setError(null)
        if (step === 'password') {
            setStep('mnemonic')
            passwordForm.reset()
        } else {
            pop()
        }
    }

    const getBiometricLabel = () => 'Biometric'

    const getBiometricIcon = () => {
        switch (biometric.type) {
            case 'face': return <ScanFace className="h-4 w-4" />
            case 'fingerprint': return <Fingerprint className="h-4 w-4" />
            default: return <Shield className="h-4 w-4" />
        }
    }

    const passwordError = passwordForm.formState.errors.password?.message
    const confirmError = passwordForm.formState.errors.confirmPassword?.message

    // Mnemonic step
    if (step === 'mnemonic') {
        const mnemonicFieldError = mnemonicForm.formState.errors.mnemonic?.message

        return (
            <BasicLayout>
                <Card className="w-full max-w-sm">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                            <Download className="h-7 w-7 text-primary" />
                        </div>
                        <CardTitle>Import Wallet</CardTitle>
                        <CardDescription>Enter your 12 or 24 word recovery phrase</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className='grid gap-4'>
                            {error && <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>}
                            <Field>
                                <FieldLabel htmlFor="mnemonic">Recovery Phrase</FieldLabel>
                                <Textarea
                                    id="mnemonic"
                                    placeholder="Enter your recovery phrase..."
                                    className="min-h-[120px] resize-none font-mono text-sm"
                                    {...mnemonicForm.register('mnemonic')}
                                />
                                {mnemonicFieldError && <FieldError>{mnemonicFieldError}</FieldError>}
                            </Field>

                            <Alert variant="default" className="bg-muted/50">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                    Your recovery phrase will be encrypted and stored securely on this device.
                                </AlertDescription>
                            </Alert>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3">
                        <Button
                            type="button"
                            size="lg"
                            className="w-full"
                            disabled={!mnemonicForm.formState.isValid}
                            onClick={mnemonicForm.handleSubmit(handleMnemonicSubmit)}
                        >
                            Continue
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1 mx-auto"
                            onClick={handleBack}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                        </Button>
                    </CardFooter>
                </Card>
            </BasicLayout>
        )
    }

    // Password step
    return (
        <BasicLayout>
            <Card className="w-full max-w-sm">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <KeyRound className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle>Create Password</CardTitle>
                    <CardDescription>Set a strong password to secure your wallet</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className='grid gap-4'>
                        {error && <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>}
                        <Field>
                            <FieldLabel>Password</FieldLabel>
                            <PasswordInput
                                placeholder="Enter your password"
                                {...passwordForm.register('password')}
                                disabled={passwordForm.formState.disabled || passwordForm.formState.isLoading}
                            />
                            {passwordError && <FieldError>{passwordError}</FieldError>}
                        </Field>

                        <Field>
                            <FieldLabel>Confirm Password</FieldLabel>
                            <PasswordInput
                                placeholder="Confirm your password"
                                {...passwordForm.register('confirmPassword')}
                                disabled={passwordForm.formState.disabled || passwordForm.formState.isLoading}
                            />
                            {confirmError && <FieldError>{confirmError}</FieldError>}
                        </Field>

                        {biometric.available && (
                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <div className="flex items-center gap-3">
                                    {getBiometricIcon()}
                                    <FieldLabel htmlFor="biometric" className="text-sm font-medium cursor-pointer">
                                        Enable {getBiometricLabel()}
                                    </FieldLabel>
                                </div>
                                <Controller
                                    render={({ field }) => (
                                        <Switch
                                            {...field as any}
                                            id="biometric"
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    )}
                                    name="biometric"
                                    control={passwordForm.control}
                                />
                            </div>
                        )}
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3">
                    <Button
                        type="button"
                        size="lg"
                        className="w-full"
                        disabled={passwordForm.formState.disabled || passwordForm.formState.isLoading || !passwordForm.formState.isValid}
                        onClick={passwordForm.handleSubmit(handleImport)}
                    >
                        {passwordForm.formState.isLoading ? (
                            <>
                                <Spinner />
                                Importing Wallet...
                            </>
                        ) : (
                            'Import Wallet'
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        onClick={handleBack}
                    >
                        <ChevronLeft />
                        Go Back
                    </Button>
                </CardFooter>
            </Card>
        </BasicLayout >
    )
}
