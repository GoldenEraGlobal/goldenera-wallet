"use client"

import { Eye, EyeOff } from "lucide-react"
import * as React from "react"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group"

interface PasswordInputProps extends Omit<React.ComponentProps<typeof InputGroupInput>, 'type'> {
    showPasswordButton?: boolean
}

function PasswordInput({ showPasswordButton = true, className, ...props }: PasswordInputProps) {
    const [showPassword, setShowPassword] = React.useState(false)

    return (
        <InputGroup className={className}>
            <InputGroupInput
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                {...props}
            />
            {showPasswordButton && (
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </InputGroupButton>
                </InputGroupAddon>
            )}
        </InputGroup>
    )
}

export { PasswordInput }
export type { PasswordInputProps }

