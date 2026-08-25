const staticFrameCache = new Map<string, string>()

export function isAnimatedGif(url: string | null | undefined): boolean {
  if (!url) return false
  return /^data:image\/gif/i.test(url) || /\.gif(\?|#|$)/i.test(url)
}

/** Extrai o primeiro frame de um GIF como JPEG estático (cache em memória). */
export async function gifStaticFrame(gifUrl: string): Promise<string> {
  const cached = staticFrameCache.get(gifUrl)
  if (cached) return cached

  const blob = gifUrl.startsWith('data:')
    ? await (await fetch(gifUrl)).blob()
    : await (await fetch(gifUrl)).blob()

  const bitmap = await createImageBitmap(blob)
  const side = Math.min(bitmap.width, bitmap.height, 512)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas indisponível')
  }
  const sx = Math.floor((bitmap.width - Math.min(bitmap.width, bitmap.height)) / 2)
  const sy = Math.floor((bitmap.height - Math.min(bitmap.width, bitmap.height)) / 2)
  const crop = Math.min(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, sx, sy, crop, crop, 0, 0, side, side)
  bitmap.close()

  const staticUrl = canvas.toDataURL('image/jpeg', 0.9)
  staticFrameCache.set(gifUrl, staticUrl)
  return staticUrl
}
