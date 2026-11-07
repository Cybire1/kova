/**
 * Kova's provider, in the page itself (a MAIN-world content script): what a website talks to.
 * EIP-1193 (request, events) and announced with EIP-6963, so wallet pickers list "Kova" on their
 * own. It holds nothing: every request goes to Kova's background through the content script.
 */

type Listener = (...args: unknown[]) => void

const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="46" fill="#0B1A1D"/><path d="M62 46V154" stroke="#ECE8E1" stroke-width="19" stroke-linecap="round" fill="none"/><path d="M92.6 74.3A40 40 0 0 1 92.6 125.7M115.6 55A70 70 0 0 1 115.6 145M138.6 35.7A100 100 0 0 1 138.6 164.3" stroke="#D46558" stroke-width="17" stroke-linecap="round" fill="none"/></svg>',
  )

const INFO = Object.freeze({
  uuid: crypto.randomUUID(),
  name: 'Kova',
  icon: ICON,
  rdns: 'app.mykova',
})

class ProviderError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
  }
}

let next = 0
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<Listener>>()

function emit(event: string, ...args: unknown[]) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(...args)
    } catch {
      // A site's own listener failing is its business.
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as {
    target?: string
    id?: number
    result?: unknown
    error?: { code: number; message: string }
    event?: string
    payload?: unknown
  }
  if (data?.target !== 'kova-inpage') return
  if (typeof data.id === 'number') {
    const entry = waiting.get(data.id)
    if (!entry) return
    waiting.delete(data.id)
    if (data.error) entry.reject(new ProviderError(data.error.code, data.error.message))
    else entry.resolve(data.result)
    return
  }
  if (data.event === 'accountsChanged') {
    emit('accountsChanged', data.payload)
    provider.selectedAddress = (data.payload as string[])[0] ?? null
  }
})

const provider = {
  isKova: true,
  isMetaMask: false,
  chainId: null as string | null,
  selectedAddress: null as string | null,

  request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    if (typeof method !== 'string' || !method)
      return Promise.reject(new ProviderError(-32602, 'Expected a method.'))
    const id = ++next
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      window.postMessage({ target: 'kova-bridge', id, method, params }, window.location.origin)
    }).then((result) => {
      if (method === 'eth_chainId') provider.chainId = result as string
      if (
        (method === 'eth_requestAccounts' || method === 'eth_accounts') &&
        Array.isArray(result)
      ) {
        const before = provider.selectedAddress
        provider.selectedAddress = (result[0] as string | undefined) ?? null
        if (before !== provider.selectedAddress) emit('accountsChanged', result)
      }
      return result
    })
  },

  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)?.add(fn)
    return provider
  },
  removeListener(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn)
    return provider
  },
  off(event: string, fn: Listener) {
    return provider.removeListener(event, fn)
  },

  // Older sites still call these.
  enable() {
    return provider.request({ method: 'eth_requestAccounts' })
  },
  isConnected() {
    return true
  },
}

function announce() {
  window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info: INFO, provider }),
    }),
  )
}

window.addEventListener('eip6963:requestProvider', announce)
announce()

// Sites that only look for window.ethereum find Kova, unless another wallet is already there.
if (!(window as { ethereum?: unknown }).ethereum)
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    configurable: true,
    writable: false,
  })

void provider.request({ method: 'eth_chainId' }).then((chainId) => emit('connect', { chainId }))
