import { createPhoneClient } from '@kova/monad'
import { apiUrl, network } from './config'
export const phoneClient = createPhoneClient(
  network.chainId,
  async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.error?.message ?? 'Kova is unreachable.')
    return json as T
  },
)
