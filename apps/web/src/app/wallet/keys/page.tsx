import { publicApiUrl } from '@/lib/network'
import type { Metadata } from 'next'
import { KeysScreen } from '@/components/wallet/keys'

export const metadata: Metadata = { title: 'Keys' }
export const dynamic = 'force-dynamic'

export default function KeysPage() {
  // The address an AI agent's MCP client reaches: Kova's public API.
  const api = publicApiUrl
  return <KeysScreen api={api} />
}
