import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { client } from '../../packages/api/src'
import { axiosInstance } from '../../packages/api/src/client'
import { parseApiError } from '../../packages/api/src/errors'
import { getBalances } from '../../packages/api/src/gen/clients/getBalances'
import { submitTransaction } from '../../packages/api/src/gen/clients/submitTransaction'
import { getBalancesQueryOptions } from '../../packages/api/src/gen/hooks/walletAPIV1/useGetBalancesHook'
import golden from '../fixtures/crypto-v0.2.0.json'

const originalAdapter = axiosInstance.defaults.adapter
const addresses = [golden.seeds[0].address, golden.seeds[1].address]
const token = '0x0000000000000000000000000000000000000000'
afterEach(() => { axiosInstance.defaults.adapter = originalAdapter })

describe('Kubb 5 transport integration', () => {
  it('preserves query arrays, same-origin routing and decimal string response data', async () => {
    let actualUrl = ''
    axiosInstance.defaults.adapter = async config => {
      actualUrl = axiosInstance.getUri(config)
      return { data: [{ address: addresses[0], tokenAddress: token, balance: '123456789012345678901234567890' }], status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config }
    }
    const response = await getBalances({ query: { addresses, tokenAddresses: [token] } })
    const url = new URL(actualUrl, 'http://local-test.invalid')
    expect(url.pathname).toBe('/api/core/v1/wallet/balances')
    expect(url.searchParams.getAll('addresses')).toEqual(addresses)
    expect(url.searchParams.getAll('tokenAddresses')).toEqual([token])
    expect(response.data[0].balance).toBe('123456789012345678901234567890')
  })

  it('serializes the handwritten transaction-status observation through the configured client', async () => {
    const controller = new AbortController()
    const request = {
      hash: `0x${'ab'.repeat(32)}`,
      sender: addresses[0]!.toLowerCase(),
      nonce: '42',
    }
    let actualUrl = ''
    let actualSignal: AbortSignal | undefined
    axiosInstance.defaults.adapter = async config => {
      actualUrl = axiosInstance.getUri(config)
      actualSignal = config.signal
      return {
        data: { status: 'PENDING', ...request, nextNonce: null },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config,
      }
    }
    const response = await client({
      method: 'GET',
      url: '/api/core/v1/wallet/transaction-status',
      query: request,
      signal: controller.signal,
      throwOnError: true,
    })
    const url = new URL(actualUrl, 'http://local-test.invalid')
    expect(url.pathname).toBe('/api/core/v1/wallet/transaction-status')
    expect(Object.fromEntries(url.searchParams)).toEqual(request)
    expect(actualSignal).toBe(controller.signal)
    expect(response.data).toEqual({ status: 'PENDING', ...request, nextNonce: null })
  })

  it('sends signed bytes in the existing JSON hexData envelope', async () => {
    let sent: unknown
    let contentType: unknown
    let path: unknown
    axiosInstance.defaults.adapter = async config => {
      sent = JSON.parse(config.data as string)
      contentType = config.headers.get('Content-Type')
      path = config.url
      return { data: { status: 'SUCCESS' }, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config }
    }
    const response = await submitTransaction({ body: { hexData: golden.transfers[0].hex } })
    expect(path).toBe('/api/core/v1/wallet/submit-tx')
    expect(sent).toEqual({ hexData: golden.transfers[0].hex })
    expect(contentType).toContain('application/json')
    expect(response.data.status).toBe('SUCCESS')
  })

  it('rejects HTTP failures rather than resolving an undefined success payload', async () => {
    axiosInstance.defaults.adapter = async config => {
      throw Object.assign(new Error('Synthetic backend rejection'), {
        config,
        response: { status: 400, statusText: 'Bad Request', data: { message: 'Synthetic invalid request' }, headers: { 'content-type': 'application/json' }, config },
      })
    }
    await expect(getBalances({ query: { addresses } })).rejects.toMatchObject({ status: 400, data: { message: 'Synthetic invalid request' } })
  })

  it('parses typed and transitional API errors without rendering arbitrary objects or HTML', () => {
    expect(parseApiError({
      status: 400,
      data: { code: 'VALIDATION_ERROR', message: 'Invalid address.', details: { field: 'address' } },
    })).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid address.', details: { field: 'address' } })
    expect(parseApiError({ response: { data: { error: 'Legacy rejection.' } } }).message).toBe('Legacy rejection.')
    expect(parseApiError({ data: 'Plain transitional rejection.' }).message).toBe('Plain transitional rejection.')
    expect(parseApiError({ data: { arbitrary: { secret: true } } }).message).toBe('The request could not be completed.')
    expect(parseApiError({ data: '<html>proxy error</html>' }).message).toBe('The request could not be completed.')
  })

  it('propagates TanStack cancellation to the HTTP request signal', async () => {
    let adapterStarted!: () => void
    const started = new Promise<void>(resolve => { adapterStarted = resolve })
    let aborted = false
    axiosInstance.defaults.adapter = config => new Promise((_resolve, reject) => {
      config.signal?.addEventListener?.('abort', () => {
        aborted = true
        reject(new Error('Synthetic abort'))
      })
      adapterStarted()
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const queryOptions = getBalancesQueryOptions({ query: { addresses } })
    const observer = new QueryObserver(client, { ...queryOptions, enabled: false })
    const unsubscribe = observer.subscribe(() => undefined)
    try {
      const pending = observer.refetch()
      await started
      await client.cancelQueries({ queryKey: queryOptions.queryKey })
      await pending
      expect(aborted).toBe(true)
      expect(observer.getCurrentResult().data).toBeUndefined()
    } finally {
      unsubscribe()
      client.clear()
    }
  })
})
