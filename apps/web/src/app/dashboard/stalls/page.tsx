import type { Metadata } from 'next'
import { StallsHome } from '@/components/stalls-home'
import { type CatalogItem, kova, type Order, type Stall } from '@/lib/api'

export const metadata: Metadata = { title: 'Stalls' }

export default async function StallsPage() {
  const [stalls, orders, items] = await Promise.all([
    kova<{ data: Stall[] }>('/v1/stalls'),
    kova<{ data: Order[] }>('/v1/orders?limit=30&source=stall'),
    kova<{ data: CatalogItem[] }>('/v1/catalog/items'),
  ])
  return (
    <StallsHome
      stalls={stalls.data}
      initialOrders={orders.data}
      catalogueSize={items.data.length}
    />
  )
}
