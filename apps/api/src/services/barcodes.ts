/**
 * What a barcode is, from open product databases, so scanning a product can fill in its name and
 * photo. Open Food Facts covers food and drink worldwide; UPCitemdb's free tier covers other
 * packaged goods. Neither needs a key. A barcode neither knows just comes back unnamed.
 */

export interface BarcodeSuggestion {
  name: string
  brand: string | null
  image_url: string | null
  source: 'open_food_facts' | 'upcitemdb'
}

const TIMEOUT = 4_000
const HEADERS = { 'user-agent': 'Kova/1.0 (https://github.com/kova; payments for small shops)' }

/** EAN-8, UPC-A, EAN-13 or GTIN-14, digits only. */
export const isBarcode = (code: string) => /^\d{8,14}$/.test(code)

async function openFoodFacts(code: string): Promise<BarcodeSuggestion | null> {
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity,image_front_small_url`,
    { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) },
  )
  if (!response.ok) return null
  const body = (await response.json()) as {
    status?: number
    product?: {
      product_name?: string
      brands?: string
      quantity?: string
      image_front_small_url?: string
    }
  }
  const p = body.product
  if (body.status !== 1 || !p?.product_name) return null
  const brand = p.brands?.split(',')[0]?.trim() || null
  // Pack sizes often end in the ℮ estimate mark ("400 g ℮"); it means nothing to a buyer.
  const quantity = p.quantity?.replace(/\s*[e℮]$/u, '').trim()
  const name = [
    brand && !p.product_name.toLowerCase().includes(brand.toLowerCase()) ? brand : null,
    p.product_name,
    quantity,
  ]
    .filter(Boolean)
    .join(' ')
  return { name, brand, image_url: p.image_front_small_url ?? null, source: 'open_food_facts' }
}

async function upcItemDb(code: string): Promise<BarcodeSuggestion | null> {
  const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!response.ok) return null
  const body = (await response.json()) as {
    items?: { title?: string; brand?: string; images?: string[] }[]
  }
  const item = body.items?.[0]
  if (!item?.title) return null
  return {
    name: item.title,
    brand: item.brand ?? null,
    image_url: item.images?.[0] ?? null,
    source: 'upcitemdb',
  }
}

/** A day of memory, so scanning the same tin twice does not ask the internet twice. */
const cache = new Map<string, { at: number; value: BarcodeSuggestion | null }>()

export async function lookupBarcode(code: string): Promise<BarcodeSuggestion | null> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < 86_400_000) return hit.value
  let value: BarcodeSuggestion | null = null
  for (const source of [openFoodFacts, upcItemDb]) {
    try {
      value = await source(code)
    } catch {
      value = null
    }
    if (value) break
  }
  cache.set(code, { at: Date.now(), value })
  return value
}
