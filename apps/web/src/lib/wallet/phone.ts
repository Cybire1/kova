import { createPhoneClient } from '@kova/monad'
export const phoneClient = (chainId: number) =>
  createPhoneClient(
    chainId,
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`/api/phone${path.slice('/v1/phone'.length)}`, {
        method,
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok)
        throw new Error(
          typeof json.error === 'string'
            ? json.error
            : (json.error?.message ?? 'Kova is unreachable.'),
        )
      return json as T
    },
  )
