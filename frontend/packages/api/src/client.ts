import axios from 'axios'
import { client } from './gen/.kubb/client'

// The generated Kubb 5 transport must use the same origin and JSON defaults
// as the previous custom client. Consumers may still configure this instance.
export const axiosInstance = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
})
client.setConfig({ transport: axiosInstance, baseURL: '/', throwOnError: true })
