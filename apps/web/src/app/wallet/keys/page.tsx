import type { Metadata } from 'next'
import { KeysScreen } from '@/components/wallet/keys'

export const metadata: Metadata = { title: 'Keys' }
export const dynamic = 'force-dynamic'

export default function KeysPage() {
  // The address an AI agent's MCP client reaches: Kova's public API.
  const api = process.env.KOVA_PUBLIC_API_URL ?? process.env.KOVA_API_URL ?? 'https://api.mykova.app'
  return <KeysScreen api={api} />
}
