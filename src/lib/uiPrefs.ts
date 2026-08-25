import { applyAppIcon, applyAppTheme } from '../components/PrismaSettings'

export const PREFS_KEY = 'nexo.uiPrefs'

export type UiPrefs = {
  messageSounds: boolean
  callSounds: boolean
  desktopNotifs: boolean
  compactMode: boolean
  reduceMotion: boolean
  chatFontScale: number
  appTheme?: string
  appIcon?: string
}

export const defaultUiPrefs: UiPrefs = {
  messageSounds: true,
  callSounds: true,
  desktopNotifs: true,
  compactMode: false,
  reduceMotion: false,
  chatFontScale: 100,
}

export function readUiPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return { ...defaultUiPrefs, ...raw }
  } catch {
    return { ...defaultUiPrefs }
  }
}

export function saveUiPrefs(patch: Partial<UiPrefs>) {
  const merged = { ...readUiPrefs(), ...patch }
  localStorage.setItem(PREFS_KEY, JSON.stringify(merged))
  applyUiPrefs(merged)
  return merged
}

export function applyUiPrefs(prefs: UiPrefs) {
  document.documentElement.dataset.compact = prefs.compactMode ? '1' : '0'
  document.documentElement.dataset.reduceMotion = prefs.reduceMotion ? '1' : '0'
  document.documentElement.style.setProperty('--chat-font-scale', `${prefs.chatFontScale / 100}`)
  if (prefs.appTheme) applyAppTheme(prefs.appTheme)
  if (prefs.appIcon) applyAppIcon(prefs.appIcon)
}

export function applyStoredUiPrefs() {
  applyUiPrefs(readUiPrefs())
}
