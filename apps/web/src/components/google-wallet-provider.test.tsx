// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleWalletProvider, useGoogleWallet } from './google-wallet-provider'

const sdk = vi.hoisted(() => ({
  ready: true,
  authenticated: false,
  user: null as null | { id: string; google: { email: string; name: string } },
  wallets: [] as {
    address: string
    walletClientType: string
    getEthereumProvider(): Promise<object>
  }[],
  walletsReady: true,
  initOAuth: vi.fn(),
  createWallet: vi.fn(),
  logout: vi.fn(),
  end: vi.fn(),
  vault: new Uint8Array(32),
  deriveVault: vi.fn(),
}))

vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => children,
  usePrivy: () => ({
    ready: sdk.ready,
    authenticated: sdk.authenticated,
    user: sdk.user,
    logout: sdk.logout,
  }),
  useWallets: () => ({ ready: sdk.walletsReady, wallets: sdk.wallets }),
  useCreateWallet: () => ({ createWallet: sdk.createWallet }),
  useLoginWithOAuth: () => ({ initOAuth: sdk.initOAuth }),
}))
vi.mock('@kova/monad', () => ({
  providerSigningSession: (address: string) => ({
    session: { end: sdk.end },
    account: { address },
  }),
  providerVaultSecret: () => sdk.deriveVault(),
}))

const ADDRESS = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const PENDING = 'kova.google.signin.v1'

function Consumer({ expected }: { expected?: `0x${string}` }) {
  const google = useGoogleWallet()
  const [address, setAddress] = useState('')
  const [failure, setFailure] = useState('')
  useEffect(() => {
    setAddress(google.connection?.account.address ?? '')
  }, [google.connection])
  return (
    <>
      <button
        type="button"
        disabled={google.busy}
        onClick={() => {
          void google.connect(expected).catch((error: Error) => setFailure(error.message))
        }}
      >
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => {
          void google.logout()
        }}
      >
        Sign out
      </button>
      <output data-testid="address">{address}</output>
      <output data-testid="error">{failure || google.error}</output>
      <output data-testid="resumed">{String(google.connection?.resumed ?? false)}</output>
    </>
  )
}
const app = (expected?: `0x${string}`) => (
  <GoogleWalletProvider appId="public-test-app-id" network="mainnet">
    <Consumer expected={expected} />
  </GoogleWalletProvider>
)

function authenticated() {
  sdk.authenticated = true
  sdk.user = { id: 'user-one', google: { email: 'person@example.com', name: 'Sam' } }
  sdk.wallets = [
    { address: ADDRESS, walletClientType: 'privy', getEthereumProvider: async () => ({}) },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.ready = true
  sdk.authenticated = false
  sdk.user = null
  sdk.wallets = []
  sdk.walletsReady = true
  sdk.vault = new Uint8Array(32).fill(7)
  sdk.deriveVault.mockResolvedValue(sdk.vault)
  sdk.initOAuth.mockResolvedValue(undefined)
  sdk.createWallet.mockResolvedValue(undefined)
  sdk.logout.mockResolvedValue(undefined)
  sessionStorage.clear()
  window.history.replaceState({}, '', '/wallet')
})
afterEach(cleanup)

describe('Google wallet sign-in', () => {
  it('starts Google OAuth once and waits for authentication before creating a wallet', async () => {
    const view = render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(sdk.initOAuth).toHaveBeenCalledWith({ provider: 'google' }))
    view.rerender(app())
    expect(sdk.initOAuth).toHaveBeenCalledTimes(1)
    expect(sdk.createWallet).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem(PENDING) ?? 'null')).toMatchObject({
      network: 'mainnet',
    })
  })

  it('reopens an existing Google wallet without creating another wallet', async () => {
    authenticated()
    render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS))
    expect(sdk.createWallet).not.toHaveBeenCalled()
    expect(sdk.initOAuth).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING)).toBeNull()
  })

  it('creates a wallet only after a new Google user is authenticated', async () => {
    authenticated()
    sdk.wallets = []
    const view = render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(sdk.createWallet).toHaveBeenCalledTimes(1))
    authenticated()
    view.rerender(app())
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS))
    expect(sdk.createWallet).toHaveBeenCalledTimes(1)
  })

  it('lets the SDK finish an OAuth return without starting another Google login', async () => {
    sessionStorage.setItem(PENDING, JSON.stringify({ network: 'mainnet', startedAt: Date.now() }))
    window.history.replaceState(
      {},
      '',
      '/wallet?privy_oauth_code=test-code&privy_oauth_state=test-state',
    )
    const view = render(app())
    expect(sdk.initOAuth).not.toHaveBeenCalled()
    authenticated()
    view.rerender(app())
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS))
    expect(screen.getByTestId('resumed').textContent).toBe('true')
    expect(sdk.initOAuth).not.toHaveBeenCalled()
  })

  it('refuses a different Google wallet and clears that identity for a retry', async () => {
    authenticated()
    render(app(OTHER))
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toContain('different wallet'),
    )
    expect(screen.getByTestId('address').textContent).toBe('')
    expect(sdk.logout).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(PENDING)).toBeNull()
  })

  it('clears wallet signing access and vault material on sign-out', async () => {
    authenticated()
    render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS))
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(''))
    expect(sdk.end).toHaveBeenCalled()
    expect(sdk.vault.every((byte) => byte === 0)).toBe(true)
    expect(sdk.logout).toHaveBeenCalledTimes(1)
  })

  it('reports cancelled or failed OAuth without leaving sign-in stuck', async () => {
    sdk.initOAuth.mockRejectedValue(new Error('Google sign-in cancelled'))
    render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('cancelled'))
    expect((screen.getByText('Continue with Google') as HTMLButtonElement).disabled).toBe(false)
    expect(sessionStorage.getItem(PENDING)).toBeNull()
  })

  it('locks cached signing access when another screen ends the provider session', async () => {
    authenticated()
    const view = render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS))
    sdk.authenticated = false
    sdk.user = null
    sdk.wallets = []
    view.rerender(app())
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(''))
    expect(sdk.end).toHaveBeenCalled()
    expect(sdk.vault.every((byte) => byte === 0)).toBe(true)
  })

  it('does not resume an abandoned sign-in on an ordinary page load', async () => {
    sessionStorage.setItem(PENDING, JSON.stringify({ network: 'mainnet', startedAt: Date.now() }))
    await act(async () => {
      render(app())
    })
    expect(sdk.initOAuth).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING)).toBeNull()
  })

  it('does not restore a wallet after the authenticated Google user changes mid-sign-in', async () => {
    authenticated()
    let finish!: (value: Uint8Array) => void
    sdk.deriveVault.mockReturnValue(
      new Promise<Uint8Array>((resolve) => {
        finish = resolve
      }),
    )
    const view = render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(sdk.deriveVault).toHaveBeenCalled())
    sdk.user = { id: 'different-user', google: { email: 'other@example.com', name: 'Other' } }
    view.rerender(app())
    await act(async () => {
      finish(sdk.vault)
    })
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toContain('account changed'),
    )
    expect(screen.getByTestId('address').textContent).toBe('')
    expect(sdk.end).toHaveBeenCalled()
    expect(sdk.vault.every((byte) => byte === 0)).toBe(true)
  })

  it('discards a wallet that finishes opening after sign-out', async () => {
    authenticated()
    let finish!: (value: Uint8Array) => void
    sdk.deriveVault.mockReturnValue(
      new Promise<Uint8Array>((resolve) => {
        finish = resolve
      }),
    )
    render(app())
    fireEvent.click(screen.getByText('Continue with Google'))
    await waitFor(() => expect(sdk.deriveVault).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Sign out'))
    await act(async () => {
      finish(sdk.vault)
    })
    expect(screen.getByTestId('address').textContent).toBe('')
    expect(sdk.end).toHaveBeenCalled()
    expect(sdk.vault.every((byte) => byte === 0)).toBe(true)
  })
})
