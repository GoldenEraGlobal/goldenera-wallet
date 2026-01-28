import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cn, Field, FieldError, FieldLabel, PasswordInput, Spinner } from "@project/ui"
import { Lock } from "lucide-react"
import { ReactNode } from "react"
import { useForm } from "react-hook-form"
import z from "zod/v4"
import { useWalletStore } from "../../store/WalletStore"
import { BiometricUnlock } from "./BiometricUnlock"

const unlockSchema = z.object({
    password: z.string().min(1, 'Password is required'),
})

type UnlockForm = z.infer<typeof unlockSchema>

export interface UnlockCardProps {
    onSuccess: (result: { password: string, mnemonic: string }) => Promise<void>
    onFailed?: () => void
    title?: ReactNode
    description?: ReactNode
    icon?: ReactNode
    biometric?: boolean
    btnLabel?: string
}

export const UnlockCard = ({ onSuccess, onFailed, title, description, icon, biometric = true, btnLabel }: UnlockCardProps) => {
    const checkPassword = useWalletStore((state) => state.checkPassword)
    const form = useForm<UnlockForm>({
        resolver: standardSchemaResolver(unlockSchema),
        defaultValues: {
            password: '',
        },
        mode: 'onChange',
    })

    const handleBiometricUnlockFailed = () => {
        form.setError('password', {
            type: 'manual',
            message: 'Biometric authentication cancelled',
        })
    }

    const handleBiometricUnlock = async (pass: string) => {
        try {
            const result = await checkPassword(pass)
            if (!result) {
                handleBiometricUnlockFailed()
                onFailed?.()
                return
            }
            await onSuccess({ password: pass, mnemonic: result })
        } catch {
            handleBiometricUnlockFailed()
            onFailed?.()
        } finally {
            form.setValue('password', '')
        }
    }

    const onSubmit = async (data: UnlockForm) => {
        try {
            const result = await checkPassword(data.password)
            if (result) {
                await onSuccess({ password: data.password, mnemonic: result })
                return
            }
            form.setError('password', {
                type: 'manual',
                message: 'Invalid password',
            })
            onFailed?.()
        } catch {
            form.setError('password', {
                type: 'manual',
                message: 'Failed to unlock',
            })
            onFailed?.()
        } finally {
            form.setValue('password', '')
        }
    }

    const passwordError = form.formState.errors.password?.message

    return (
        <form className="w-full" onSubmit={form.handleSubmit(onSubmit)}>
            <Card className={cn("w-full")}>
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 [&_svg]:size-7 [&_svg]:text-primary">
                        {icon || <Lock />}
                    </div>
                    {title && (
                        <CardTitle>{title}</CardTitle>
                    )}
                    {description && (
                        <CardDescription>{description}</CardDescription>
                    )}
                </CardHeader>
                <CardContent>
                    <Field className='w-full'>
                        <FieldLabel className='sr-only'>Password</FieldLabel>
                        <PasswordInput
                            placeholder="Enter your password"
                            {...form.register('password')}
                        />
                        {passwordError && <FieldError>{passwordError}</FieldError>}
                    </Field>
                </CardContent>
                <CardFooter className="flex flex-col gap-3">
                    <Button
                        type="submit"
                        size="lg"
                        className="w-full"
                        disabled={!form.formState.isValid || form.formState.isLoading || form.formState.disabled}
                    >
                        {form.formState.isLoading ? (
                            <>
                                <Spinner />
                                Unlocking...
                            </>
                        ) : (
                            btnLabel || 'Unlock'
                        )}
                    </Button>
                    {biometric && (
                        <BiometricUnlock
                            onSuccess={handleBiometricUnlock}
                            onFailed={handleBiometricUnlockFailed}
                            disabled={form.formState.isLoading}
                            size="lg"
                            className="w-full"
                            variant='outline'
                        />
                    )}
                </CardFooter>
            </Card>
        </form>
    )
}