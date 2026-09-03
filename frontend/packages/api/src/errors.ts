export interface ApiErrorDtoV1 {
  code: string
  message: string
  details: Record<string, unknown>
}

const FALLBACK_CODE = 'REQUEST_FAILED'
const FALLBACK_MESSAGE = 'The request could not be completed.'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function containsUnsafeCharacters(value: string): boolean {
  if (value.includes('<') || value.includes('>')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true
  }
  return false
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > 500 || containsUnsafeCharacters(text)) return null
  return text
}

function details(value: unknown): Record<string, unknown> {
  return record(value) ?? {}
}

function parseBody(value: unknown): ApiErrorDtoV1 | null {
  const text = safeText(value)
  if (text) return { code: FALLBACK_CODE, message: text, details: {} }

  const body = record(value)
  if (!body) return null
  const message = safeText(body.message) ?? safeText(body.error)
  if (!message) return null
  const code = safeText(body.code)
  return {
    code: code && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : FALLBACK_CODE,
    message,
    details: details(body.details),
  }
}

/** Parses Kubb ResponseError, AxiosError and transitional backend payloads safely. */
export function parseApiError(error: unknown, fallbackMessage = FALLBACK_MESSAGE): ApiErrorDtoV1 {
  const root = record(error)
  const response = record(root?.response)
  for (const candidate of [root?.data, response?.data, error]) {
    const parsed = parseBody(candidate)
    if (parsed) return parsed
  }

  if (error instanceof Error) {
    const message = safeText(error.message)
    if (message) return { code: FALLBACK_CODE, message, details: {} }
  }
  return { code: FALLBACK_CODE, message: fallbackMessage, details: {} }
}

export function getApiErrorMessage(error: unknown, fallbackMessage?: string): string {
  return parseApiError(error, fallbackMessage).message
}
