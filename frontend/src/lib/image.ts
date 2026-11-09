/** The size to draw an image at so its long side is at most `max` pixels; never zero, never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const k = max / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/**
 * Shrinks a photo before it is uploaded (long side 2000 px, JPEG). PDFs, and browsers without canvas support,
 * send the file as it is: the server re-encodes and limits sizes anyway.
 */
export async function downscale(file: File, maxSide = 2000, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide)
    if (width === bitmap.width && height === bitmap.height && file.type === 'image/jpeg') return file
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}
