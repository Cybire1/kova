/** Public deposit instructions. Amounts are decimal strings, never floating point. */
export interface DepositToken {
  address: string
  symbol: string
  decimals: number
}

export interface DepositChain {
  id: number
  name: string
  vm: 'evm' | 'svm' | 'tvm' | 'bvm'
  tokens: DepositToken[]
}

export interface ChainDepositSources {
  live: boolean
  tracking: boolean
  network: 'mainnet' | 'testnet'
  reason: string | null
  arrives_as: 'AUSD'
  chains: DepositChain[]
}

export interface ChainDepositRequest {
  chain_id: number
  token: string
  amount: string
  /** A wallet controlled by the user on the sending network, including for exchange withdrawals. */
  refund_to: string
}

export interface ChainDepositQuote {
  provider: 'relay'
  request_id: string
  address: string
  chain: DepositChain
  token: DepositToken
  amount: string
  expected_ausd: string
  minimum_ausd: string
  route_fee_usd: string | null
  time_estimate_seconds: number | null
  refund_to: string
  quoted_at: string
  /** This is an estimate: open addresses get a fresh price when funds arrive. */
  pricing: 'estimate'
}

export interface ChainDepositActivity {
  id: string
  status: 'waiting' | 'depositing' | 'pending' | 'submitted' | 'success' | 'refund' | 'failure'
  source_chain_id: number | null
  deposit_address: string
  deposit_tx: string | null
  destination_tx: string | null
  /** Confirmed AUSD received, from the actual route, only after success. */
  received_ausd: string | null
  created_at: string
}
