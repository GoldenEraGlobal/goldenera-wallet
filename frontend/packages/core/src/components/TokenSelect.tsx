import { Address, NATIVE_TOKEN } from "@goldenera/cryptoj";
import { useGetTokensHook } from "@project/api";
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
    cn,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    Spinner
} from "@project/ui";
import { useUncontrolledProp } from "uncontrollable";
import { compareAddress } from "../utils/WalletUtil";

export interface TokenSelectProps {
    value?: Address | null | string
    onChange?: (value?: Address | null | string) => void
    disabled?: boolean
    className?: string
    name?: string
}

export const TokenSelect = ({ value, onChange, disabled, className, name }: TokenSelectProps) => {
    const [selectedToken, setSelectedToken] = useUncontrolledProp(value, NATIVE_TOKEN, onChange)
    const { data: tokensData, isLoading: isLoadingTokens } = useGetTokensHook()
    const tokens = tokensData || []
    const token = tokens.find(t => compareAddress(t.address, selectedToken))
    const tokenName = isLoadingTokens ? "Loading tokens..." : (token ? `${token.name} (${token.smallestUnitName})` : "Select a token")

    return (
        <Select
            value={selectedToken}
            onValueChange={setSelectedToken as any}
            disabled={disabled || isLoadingTokens}
            name={name}
        >
            <SelectTrigger className={cn("w-full h-9", className)} size="lg">
                <SelectValue className="flex items-center gap-2">
                    {token && (
                        <Avatar className="size-5 after:border-none">
                            <AvatarImage src={token.logoUrl} alt={token.name} />
                            <AvatarFallback className="text-xs">{token.smallestUnitName?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                    )}
                    {isLoadingTokens ? <Spinner /> : null}
                    <span>{tokenName}</span>
                </SelectValue>
            </SelectTrigger>

            <SelectContent>
                <SelectGroup>
                    <SelectLabel>Tokens</SelectLabel>
                    {tokens.map((token) => (
                        <SelectItem key={token.address} value={token.address || ''} className='flex items-center gap-2'>
                            <Avatar className="size-5 after:border-none">
                                <AvatarImage src={token.logoUrl} alt={token.name} />
                                <AvatarFallback className="text-xs">{token.smallestUnitName?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span>
                                {token.name} ({token.smallestUnitName})
                            </span>
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}