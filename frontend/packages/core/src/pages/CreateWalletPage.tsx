import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  Button,
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Field, FieldError, FieldLabel,
  PasswordInput,
  Switch
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import { ChevronLeft, Fingerprint, KeyRound, ScanFace, Shield } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { BasicLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'

// Schema for Password
const passwordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z.string(),
  enableBiometric: z.boolean(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type PasswordForm = z.infer<typeof passwordSchema>

export const CreateWalletPage: ActivityComponentType = () => {
  const { pop } = useFlow()
  const createWallet = useWalletStore((state) => state.createWallet)
  const biometric = useWalletStore((state) => state.biometric)

  const form = useForm<PasswordForm>({
    resolver: standardSchemaResolver(passwordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
      enableBiometric: biometric.available,
    },
    mode: 'onChange',
  })

  const onSubmit = async (data: PasswordForm) => {
    try {
      await createWallet(data.password, data.enableBiometric && biometric.available)
    } catch (error) {
      form.setError('password', {
        type: 'manual',
        message: error instanceof Error ? error.message : 'Failed to create wallet',
      })
    }
  }

  const getBiometricLabel = () => {
    return biometric.type === 'face' ? 'Face ID' : 'Biometric'
  }

  const getBiometricIcon = () => {
    switch (biometric.type) {
      case 'face': return <ScanFace className="h-4 w-4" />
      case 'fingerprint': return <Fingerprint className="h-4 w-4" />
      default: return <Shield className="h-4 w-4" />
    }
  }

  const passwordError = form.formState.errors.password?.message
  const confirmError = form.formState.errors.confirmPassword?.message

  // Password Step
  return (
    <BasicLayout>
      <form className='w-full' onSubmit={form.handleSubmit(onSubmit)}>
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-7 w-7 text-primary" />
            </div>
            <CardTitle>Create Password</CardTitle>
            <CardDescription>Set a strong password to secure your wallet</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid gap-4'>
              <Field>
                <FieldLabel>Password</FieldLabel>
                <PasswordInput
                  placeholder="Enter your password"
                  disabled={form.formState.isSubmitting}
                  {...form.register('password')}
                />
                {passwordError && <FieldError>{passwordError}</FieldError>}
              </Field>

              <Field>
                <FieldLabel>Confirm Password</FieldLabel>
                <PasswordInput
                  placeholder="Confirm your password"
                  disabled={form.formState.isSubmitting}
                  {...form.register('confirmPassword')}
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
                    name="enableBiometric"
                    control={form.control}
                    render={({ field }) => (
                      <Switch
                        id="biometric"
                        {...field as any}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={!form.formState.isValid || form.formState.isSubmitting || form.formState.disabled}
            >
              {form.formState.isSubmitting ? 'Creating Wallet...' : 'Set Password'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={form.formState.isSubmitting}
              onClick={() => pop()}
            >
              <ChevronLeft />
              Go Back
            </Button>
          </CardFooter>
        </Card>
      </form>
    </BasicLayout>
  )
}
