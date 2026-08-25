import type { PrismaTier, User, VideoFps, VideoQuality } from '../types'

/** Nomes de usuário que recebem admin automaticamente (bootstrap). */
export const ADMIN_BOOTSTRAP_USERNAMES = ['lkbravo']

export const PRISMA_LABEL: Record<PrismaTier, string> = {
  none: 'Grátis',
  basic: 'Prisma Basic',
  full: 'Prisma',
}

export interface PrismaLimits {
  uploadBytes: number
  messageChars: number
  maxServers: number
  maxVideoQuality: VideoQuality
  maxFps: VideoFps
  gifAvatar: boolean
  banner: boolean
  profileThemes: boolean
  customStatus: boolean
  customEmojis: number
  customStickers: number
  superReactions: boolean
  hdStreaming: boolean
  serverBoosts: number
  appThemes: boolean
  appIcons: boolean
  displayNameStyles: boolean
  badge: boolean
  bioChars: number
  avatarGifBytes: number
  avatarGifDataUrl: number
  avatarStaticDataUrl: number
}

export const PRISMA_LIMITS: Record<PrismaTier, PrismaLimits> = {
  none: {
    uploadBytes: 8 * 1024 * 1024,
    messageChars: 2000,
    maxServers: 100,
    maxVideoQuality: '720p',
    maxFps: 30,
    gifAvatar: false,
    banner: false,
    profileThemes: false,
    customStatus: false,
    customEmojis: 0,
    customStickers: 0,
    superReactions: false,
    hdStreaming: false,
    serverBoosts: 0,
    appThemes: false,
    appIcons: false,
    displayNameStyles: false,
    badge: false,
    bioChars: 190,
    avatarGifBytes: 0,
    avatarGifDataUrl: 0,
    avatarStaticDataUrl: 140_000,
  },
  basic: {
    uploadBytes: 50 * 1024 * 1024,
    messageChars: 2000,
    maxServers: 100,
    maxVideoQuality: '720p',
    maxFps: 30,
    gifAvatar: true,
    banner: true,
    profileThemes: true,
    customStatus: true,
    customEmojis: 50,
    customStickers: 50,
    superReactions: false,
    hdStreaming: false,
    serverBoosts: 0,
    appThemes: true,
    appIcons: true,
    displayNameStyles: false,
    badge: true,
    bioChars: 300,
    avatarGifBytes: 2 * 1024 * 1024,
    avatarGifDataUrl: 1_500_000,
    avatarStaticDataUrl: 200_000,
  },
  full: {
    uploadBytes: 500 * 1024 * 1024,
    messageChars: 4000,
    maxServers: 200,
    maxVideoQuality: '1080p',
    maxFps: 60,
    gifAvatar: true,
    banner: true,
    profileThemes: true,
    customStatus: true,
    customEmojis: 200,
    customStickers: 300,
    superReactions: true,
    hdStreaming: true,
    serverBoosts: 2,
    appThemes: true,
    appIcons: true,
    displayNameStyles: true,
    badge: true,
    bioChars: 400,
    avatarGifBytes: 4 * 1024 * 1024,
    avatarGifDataUrl: 2_500_000,
    avatarStaticDataUrl: 200_000,
  },
}

export function tierOf(user: User | null | undefined): PrismaTier {
  return user?.prismaTier || 'none'
}

export function limitsOf(user: User | null | undefined): PrismaLimits {
  return PRISMA_LIMITS[tierOf(user)]
}

export function hasPrisma(user: User | null | undefined): boolean {
  return tierOf(user) !== 'none'
}

export function hasFullPrisma(user: User | null | undefined): boolean {
  return tierOf(user) === 'full'
}

export function formatUploadLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function clampVideoQuality(user: User | null, q: VideoQuality): VideoQuality {
  const order: VideoQuality[] = ['360p', '480p', '720p', '1080p']
  const max = limitsOf(user).maxVideoQuality
  const maxIdx = order.indexOf(max)
  const idx = order.indexOf(q)
  return order[Math.min(idx, maxIdx)] || '480p'
}

export function clampFps(user: User | null, fps: VideoFps): VideoFps {
  const max = limitsOf(user).maxFps
  return fps > max ? max : fps
}

export const PROFILE_THEMES: { id: string; label: string; css: string }[] = [
  { id: 'default', label: 'Padrão', css: 'linear-gradient(135deg, #5865f2 0%, #3c45a5 100%)' },
  { id: 'sunset', label: 'Pôr do sol', css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'ocean', label: 'Oceano', css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'forest', label: 'Floresta', css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'ember', label: 'Brasa', css: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'midnight', label: 'Meia-noite', css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { id: 'prisma', label: 'Prisma', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f953c6 100%)' },
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
]

export const APP_THEMES: { id: string; label: string; vars: Record<string, string> }[] = [
  { id: 'dark', label: 'Escuro', vars: {} },
  {
    id: 'darker',
    label: 'Mais escuro',
    vars: { '--bg-0': '#060607', '--bg-1': '#0a0a0c', '--bg-2': '#111214' },
  },
  {
    id: 'amethyst',
    label: 'Ametista',
    vars: { '--bg-2': '#1a1525', '--brand': '#9b59b6', '--bg-3': '#2d1f3d' },
  },
  {
    id: 'crimson',
    label: 'Carmesim',
    vars: { '--bg-2': '#1f1214', '--brand': '#e74c3c', '--bg-3': '#3d1f24' },
  },
  {
    id: 'teal',
    label: 'Turquesa',
    vars: { '--bg-2': '#0f1a1a', '--brand': '#1abc9c', '--bg-3': '#1a3330' },
  },
]

export const APP_ICONS: { id: string; label: string; emoji: string }[] = [
  { id: 'default', label: 'Nexo', emoji: '💬' },
  { id: 'gem', label: 'Prisma', emoji: '💎' },
  { id: 'bolt', label: 'Raio', emoji: '⚡' },
  { id: 'star', label: 'Estrela', emoji: '⭐' },
  { id: 'moon', label: 'Lua', emoji: '🌙' },
  { id: 'fire', label: 'Fogo', emoji: '🔥' },
]

export function boostLevel(count: number): number {
  if (count >= 14) return 3
  if (count >= 7) return 2
  if (count >= 2) return 1
  return 0
}
