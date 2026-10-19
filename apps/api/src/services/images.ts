import { encodeId } from '../ids.js'

/** Photos are resized on the phone or in the browser first; this is a ceiling, not a target. */
export const MAX_IMAGE_BYTES = 1_500_000

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** Trust the bytes, not the header: only real JPEG, PNG or WebP files are stored. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png'
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp'
  return null
}

export const imageUrl = (origin: string, uuid: string | null | undefined) =>
  uuid ? `${origin}/v1/public/images/${encodeId('image', uuid)}` : null
