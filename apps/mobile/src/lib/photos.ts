import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

export type PhotoSource = 'camera' | 'library'

/**
 * A photo from the camera or the library, shrunk to what it's for: item photos are cropped
 * square and kept small (Kova stores them, up to 1.5 MB), menu photos stay large enough to read.
 * Returns null when the person cancels.
 */
export async function takePhoto(
  from: PhotoSource,
  purpose: 'item' | 'menu',
): Promise<{ uri: string; width: number; height: number; base64?: string } | null> {
  if (from === 'camera') {
    // The library needs no permission (the system picker only hands over what's chosen); the camera does.
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted)
      throw new Error('Kova needs the camera for this. Allow it in Settings.')
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: purpose === 'item',
    aspect: [1, 1],
    quality: 1,
  }
  let result: ImagePicker.ImagePickerResult
  try {
    result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options)
  } catch {
    throw new Error(
      from === 'camera'
        ? 'This phone’s camera isn’t available. Choose a photo instead.'
        : 'Your photos aren’t available right now.',
    )
  }
  const asset = result.canceled ? null : result.assets[0]
  if (!asset) return null
  return shrink(asset.uri, asset.width, purpose === 'item' ? 900 : 1800, purpose === 'menu')
}

/** Resizes to at most `max` points wide and saves a JPEG. */
export async function shrink(uri: string, width: number, max: number, base64 = false) {
  const context = ImageManipulator.manipulate(uri)
  if (width > max) context.resize({ width: max })
  const image = await context.renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64 })
  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    base64: saved.base64 ?? undefined,
  }
}
