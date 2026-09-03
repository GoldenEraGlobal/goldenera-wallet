import { getApiErrorMessage } from '@project/api'

export interface ApiErrorMessageProps {
    error: unknown
    fallbackMessage?: string
}

export const ApiErrorMessage = ({ error, fallbackMessage }: ApiErrorMessageProps) => (
    <span>{getApiErrorMessage(error, fallbackMessage)}</span>
)
