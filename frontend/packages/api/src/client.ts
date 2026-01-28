import axios, { type AxiosRequestConfig } from 'axios';

export const axiosInstance = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json',
  },
});

export type RequestConfig<TData = unknown> = {
  url?: string;
  method?: string;
  data?: TData;
  params?: unknown;
} & AxiosRequestConfig;

export type ResponseErrorConfig<TError = unknown> = TError;

export const customClient = async <TData, _TError = unknown, TVariables = unknown>(
  config: RequestConfig<TVariables>
) => {
  const promise = axiosInstance.request<TData>(config);
  const response = await promise;
  return response;
};

export default customClient;
