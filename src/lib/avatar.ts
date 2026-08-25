import type { PrismaTier } from '../types'
import { PRISMA_LIMITS } from './prisma'

/** Prepara avatar: GIF animado preservado; outras imagens viram JPEG quadrado centralizado. */
export async function compressAvatar(
  file: File,
  maxSide = 256,
  quality = 0.85,
  tier: PrismaTier = 'none',
): Promise<string> {
  const limits = PRISMA_LIMITS[tier]

  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.')
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('A imagem deve ter no máximo 8 MB.')
  }

  if (file.type === 'image/gif') {
    if (!limits.gifAvatar) {
      throw new Error('Avatar animado requer Prisma. Assine ou peça a um administrador.')
    }
    if (file.size > limits.avatarGifBytes) {
      throw new Error(`GIF deve ter no máximo ${Math.round(limits.avatarGifBytes / (1024 * 1024))} MB.`)
    }
    const dataUrl = await readFileAsDataUrl(file)
    if (dataUrl.length > limits.avatarGifDataUrl) {
      throw new Error('GIF ainda grande demais. Tente um arquivo menor ou reduza os frames.')
    }
    return dataUrl
  }

  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = Math.floor((bitmap.width - side) / 2)
  const sy = Math.floor((bitmap.height - side) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = maxSide
  canvas.height = maxSide
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Não foi possível processar a imagem.')
  }
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, maxSide, maxSide)
  bitmap.close()

  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  if (dataUrl.length > limits.avatarStaticDataUrl) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.65)
  }
  if (dataUrl.length > limits.avatarStaticDataUrl) {
    throw new Error('Imagem ainda grande demais. Tente outra foto.')
  }
  return dataUrl
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}
