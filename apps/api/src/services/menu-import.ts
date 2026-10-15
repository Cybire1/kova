import { KovaError } from '../errors.js'
import { ai, aiModel, aiRequestOptions, PER_USD } from './ai.js'

/**
 * Reads a photo of a menu board or price list into catalogue items ("Snap your menu").
 *
 * The model only reads: it records names and the prices as printed, in the currency printed.
 * Converting to dollars happens here, at the same published reference rates the app shows
 * (DECISIONS D-012), rounded up so a seller is never short. The seller reviews every line
 * before anything is saved.
 */

export interface MenuLine {
  name: string
  description: string | null
  /** Dollars, as a decimal string. */
  price: string
  original: { amount: number; currency: string }
}

export const menuImportReady = () => ai !== null

export async function readMenu(image: {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}): Promise<{ currency: string; items: MenuLine[] }> {
  if (!ai)
    throw new KovaError(
      'invalid_request',
      'Menu import is not set up on this server yet (it needs an Anthropic or DeepSeek API key).',
    )

  const response = await ai.messages.create({
    model: aiModel,
    max_tokens: 4000,
    ...aiRequestOptions,
    tools: [
      {
        name: 'record_menu',
        description: 'Record every item and price that is legible in the photo.',
        input_schema: {
          type: 'object',
          properties: {
            currency: {
              type: 'string',
              enum: ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'MXN', 'UNKNOWN'],
              description:
                'The currency the prices are written in. Use the symbol or the location on the menu; NGN for naira (₦ or N).',
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The item as a customer would ask for it, in title case.',
                  },
                  description: {
                    type: 'string',
                    description: 'A short description if one is printed, else empty.',
                  },
                  price: {
                    type: 'number',
                    description: 'The price exactly as printed, as a number in that currency.',
                  },
                },
                required: ['name', 'price'],
              },
            },
          },
          required: ['currency', 'items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_menu' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
          {
            type: 'text',
            text: 'This is a photo of a small business\'s menu, price board or price list. Record each item that has a price. Skip headings, phone numbers and anything without a price. If one item has several sizes, record each size as its own item, for example "Jollof rice, large".',
          },
        ],
      },
    ],
  })

  const call = response.content.find((block) => block.type === 'tool_use')
  if (!call || call.type !== 'tool_use')
    throw new KovaError('chain_error', 'Could not read that photo. Try a closer, sharper one.')
  const input = call.input as {
    currency?: string
    items?: { name?: string; description?: string; price?: number }[]
  }
  const currency = input.currency && input.currency in PER_USD ? input.currency : 'USD'
  const rate = PER_USD[currency] ?? 1

  const items: MenuLine[] = (input.items ?? [])
    .filter(
      (i): i is { name: string; description?: string; price: number } =>
        Boolean(i.name) && typeof i.price === 'number' && i.price > 0,
    )
    .slice(0, 60)
    .map((i) => ({
      name: i.name.trim().slice(0, 80),
      description: i.description?.trim().slice(0, 200) || null,
      price: (Math.ceil((i.price / rate) * 100 - 1e-9) / 100).toFixed(2),
      original: { amount: i.price, currency },
    }))
  return { currency: input.currency ?? 'UNKNOWN', items }
}
