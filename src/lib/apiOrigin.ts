/** Origem do hub online (WebSocket / version.json). */
export const PRODUCTION_ORIGIN = 'https://nexo.nexo-app.workers.dev'

export type CaptureSource = {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string | null
  appIcon: string | null
}

export type NexoDesktopApi = {
  engine?: string
  isDesktop?: boolean
  minimize?: () => Promise<void>
  toggleMaximize?: () => Promise<boolean | void>
  isMaximized?: () => Promise<boolean>
  close?: () => Promise<void>
  hide?: () => Promise<void>
  show?: () => Promise<void>
  quit?: () => Promise<void>
  applyUpdate?: () => Promise<void>
  downloadAndInstallUpdate?: (opts: { url: string; version?: string }) => Promise<void>
  setFullscreen?: (enabled: boolean) => Promise<void>
  getAutostart?: () => Promise<boolean>
  setAutostart?: (enabled: boolean) => Promise<boolean>
  setMinimizeToBackground?: (enabled: boolean) => Promise<boolean>
  getMinimizeToBackground?: () => Promise<boolean>
  info?: () => Promise<{ engine: string; version: string; hub: string }>
  listCaptureSources?: () => Promise<CaptureSource[]>
  prepareCapture?: (sourceId: string) => Promise<boolean>
}

declare global {
  interface Window {
    nexoDesktop?: NexoDesktopApi
  }
}

export function getDesktopApi(): NexoDesktopApi | null {
  if (typeof window === 'undefined') return null
  return window.nexoDesktop ?? null
}

export function isDesktopApp() {
  if (typeof window === 'undefined') return false
  if (window.nexoDesktop?.isDesktop) return true
  if (navigator.userAgent.includes('Electron')) return true
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    Boolean((window as Window & { isTauri?: boolean }).isTauri)
  )
}

/** API/WebSocket origin: desktop → produção; web → mesmo host; override via VITE_NEXO_API. */
export function resolveApiOrigin(): string {
  const fromEnv = (import.meta.env.VITE_NEXO_API as string | undefined)?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (isDesktopApp() && !import.meta.env.DEV) return PRODUCTION_ORIGIN
  // Protocolo custom nexo:// também usa o hub online
  if (typeof window !== 'undefined' && window.location?.protocol === 'nexo:') return PRODUCTION_ORIGIN
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin
  }
  return PRODUCTION_ORIGIN
}

export function resolveWsUrl(): string {
  const origin = resolveApiOrigin()
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}/ws`
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}/ws`
  return `wss://${PRODUCTION_ORIGIN.slice('https://'.length)}/ws`
}
