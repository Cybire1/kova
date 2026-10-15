'use client'

/**
 * Photos leave the browser small: a phone's 12 MB camera shot becomes a few hundred KB before
 * it is uploaded, which keeps stall pages fast on a market's mobile data.
 */

async function draw(file: Blob, max: number) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser can’t resize photos')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))),
      type,
      quality,
    ),
  )
}

/** Resize and upload a photo for an item or a stall cover. */
export async function uploadPhoto(file: File): Promise<{ id: string; url: string }> {
  const blob = await toBlob(await draw(file, 1200), 'image/jpeg', 0.84)
  const response = await fetch('/api/images', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  })
  const body = (await response.json()) as { id?: string; url?: string; error?: string }
  if (!response.ok || !body.id || !body.url) throw new Error(body.error ?? 'Upload failed')
  return { id: body.id, url: body.url }
}

/** A menu photo as base64 JPEG, big enough to read small print. */
export async function menuPhoto(file: File): Promise<{ data: string; media_type: 'image/jpeg' }> {
  const blob = await toBlob(await draw(file, 1800), 'image/jpeg', 0.86)
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.length; i += 0x8000)
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
  return { data: btoa(binary), media_type: 'image/jpeg' }
}
