import type { Metadata } from 'next'
import { SuppliersPanel } from '@/components/business'
import { kova, kovaPublic, type Merchant } from '@/lib/api'
import type { Supplier, SupplierPayment } from '@/lib/business'
import type { LiveRates } from '@/lib/wallet/money'
import { businessShop } from '../shop'
import '@/styles/business.css'

export const metadata: Metadata = { title: 'Suppliers' }

/** The people and companies the business buys from, paying them, and every payment. */
export default async function SuppliersPage() {
  const [merchant, suppliers, payments, live] = await Promise.all([
    kova<Merchant>('/v1/account'),
    kova<{ data: Supplier[] }>('/v1/business/suppliers').then((r) => r.data),
    kova<{ data: SupplierPayment[] }>('/v1/business/supplier_payments').then((r) => r.data),
    kovaPublic<LiveRates>('/v1/rates').catch(() => null),
  ])
  return (
    <SuppliersPanel
      shop={businessShop(merchant)}
      initialSuppliers={suppliers}
      initialPayments={payments}
      live={live}
    />
  )
}
