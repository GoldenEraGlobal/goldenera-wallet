import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
    Alert, AlertDescription,
    Button,
    Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
    Checkbox,
    Field, FieldError, FieldLabel,
    Label,
    PasswordInput,
    Spinner
} from '@project/ui'
import { ActivityComponentType } from '@stackflow/react'
import { AlertTriangle, ChevronLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'

const deleteSchema = z.object({
    password: z.string().min(1, 'Password is required to confirm deletion'),
})

type DeleteForm = z.infer<typeof deleteSchema>

type Step = 'warning' | 'confirm'

export const DeleteWalletPage: ActivityComponentType = () => {
    const { pop } = useFlow()
    const resetWallet = useWalletStore((state) => state.resetWallet)
    const checkPassword = useWalletStore((state) => state.checkPassword)
    const [step, setStep] = useState<Step>('warning')

    const [hasBackedUp, setHasBackedUp] = useState(false)
    const [understandRisk, setUnderstandRisk] = useState(false)

    const form = useForm<DeleteForm>({
        resolver: standardSchemaResolver(deleteSchema),
        defaultValues: {
            password: '',
        },
        mode: 'onChange',
    })

    const handleProceedToPassword = () => {
        setStep('confirm')
    }

    const handleDelete = async (data: DeleteForm) => {
        try {
            const mnemonic = await checkPassword(data.password)
            if (!mnemonic) {
                form.setError('password', {
                    type: 'manual',
                    message: 'Incorrect password',
                })
                return
            }
            await resetWallet()
        } catch {
            form.setError('password', {
                type: 'manual',
                message: 'Failed to delete wallet',
            })
        } finally {
            form.setValue('password', '')
        }
    }

    const handleBack = () => {
        if (step === 'confirm') {
            setStep('warning')
            form.setValue('password', '')
        } else {
            pop()
        }
    }

    const renderContent = () => {
        switch (step) {
            case 'warning':
                return (
                    <Card className="w-full max-w-sm">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                                <Trash2 className="h-7 w-7 text-destructive" />
                            </div>
                            <CardTitle className="text-destructive">Delete Wallet</CardTitle>
                            <CardDescription>This action cannot be undone</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
                                <AlertTriangle />
                                <AlertDescription className="text-sm text-left">
                                    <strong className='font-bold'>Warning:</strong> Deleting your wallet will permanently remove all data from this device.
                                    Without your recovery phrase, you will lose access to your funds forever.
                                </AlertDescription>
                            </Alert>
                            <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                                <Checkbox
                                    id="backup-confirm"
                                    checked={hasBackedUp}
                                    onCheckedChange={setHasBackedUp}
                                    className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                                />
                                <div className="grid gap-1.5 font-normal">
                                    <p className="text-sm leading-none font-medium">
                                        I have backed up my 12-word recovery phrase and stored it safely
                                    </p>
                                </div>
                            </Label>
                            <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                                <Checkbox
                                    id="backup-confirm"
                                    checked={understandRisk}
                                    onCheckedChange={setUnderstandRisk}
                                    className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                                />
                                <div className="grid gap-1.5 font-normal">
                                    <p className="text-sm leading-none font-medium">
                                        I understand that without my recovery phrase, I will lose access to my funds permanently
                                    </p>
                                </div>
                            </Label>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-3">
                            <Button
                                variant="outline"
                                size="lg"
                                className="w-full"
                                onClick={() => pop()}
                            >
                                View Recovery Phrase First
                            </Button>
                            <Button
                                variant="destructive"
                                size="lg"
                                className="w-full"
                                disabled={!hasBackedUp || !understandRisk}
                                onClick={handleProceedToPassword}
                            >
                                Continue with Deletion
                            </Button>

                            <Button
                                variant="ghost"
                                size="lg"
                                className="gap-1 mx-auto"
                                onClick={handleBack}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Cancel
                            </Button>
                        </CardFooter>
                    </Card>
                )
            case 'confirm':
            default:
                return (
                    <Card className="w-full max-w-sm">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                                <Trash2 className="h-7 w-7 text-destructive" />
                            </div>
                            <CardTitle className="text-destructive">Confirm Deletion</CardTitle>
                            <CardDescription>Enter your password to confirm wallet deletion</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Field>
                                <FieldLabel className="sr-only">Password</FieldLabel>
                                <PasswordInput
                                    placeholder="Enter your password"
                                    {...form.register('password')}
                                    disabled={form.formState.disabled || form.formState.isLoading}
                                />
                                {form.formState.errors.password?.message && (
                                    <FieldError>{form.formState.errors.password.message}</FieldError>
                                )}
                            </Field>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-3">
                            <Button
                                variant="destructive"
                                size="lg"
                                className="w-full"
                                disabled={form.formState.disabled || form.formState.isLoading || !form.formState.isValid}
                                onClick={form.handleSubmit(handleDelete)}
                            >
                                {form.formState.isLoading && <Spinner />}
                                {form.formState.isLoading ? 'Deleting...' : 'Delete Wallet Permanently'}
                            </Button>

                            <Button
                                type="button"
                                variant="ghost"
                                size="lg"
                                className="gap-1 mx-auto"
                                onClick={handleBack}
                                disabled={form.formState.disabled || form.formState.isLoading}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Go Back
                            </Button>
                        </CardFooter>
                    </Card>
                )
        }
    }

    return (
        <AppLayout title="Delete Wallet" centered>
            {renderContent()}
        </AppLayout>
    )
}
