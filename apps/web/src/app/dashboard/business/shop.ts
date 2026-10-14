import type { BusinessShop } from '@/components/business'
import type { Merchant } from '@/lib/api'

/** What the business's pages need to know about the shop: its name and the wallet that pays. */
export const businessShop = (merchant: Merchant): BusinessShop => ({
  name: merchant.name,
  owner: merchant.owner_address,
  settlement: merchant.settlement_address,
  network: merchant.network === 'mainnet' ? 'mainnet' : 'testnet',
})
