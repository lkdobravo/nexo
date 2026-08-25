const KEY = 'nexo_desktop_prefs'

export type DesktopPrefs = {
  /** Minimizar → bandeja / 2º plano (economia de CPU, mantém só a voz). */
  minimizeToBackground: boolean
}

const DEFAULTS: DesktopPrefs = {
  minimizeToBackground: true,
}

export function readDesktopPrefs(): DesktopPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '')
    return {
      minimizeToBackground:
        typeof raw.minimizeToBackground === 'boolean'
          ? raw.minimizeToBackground
          : DEFAULTS.minimizeToBackground,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeDesktopPrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  const next = { ...readDesktopPrefs(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('nexo-desktop-prefs', { detail: next }))
  return next
}

const NR_KEY = 'nexo_noise_reduction'

/** @deprecated Preferências antigas — redução de ruído foi removida da UI. */
export function readNoiseReductionPref(): boolean {
  return false
}

export function writeNoiseReductionPref(_on: boolean) {
  try {
    localStorage.removeItem(NR_KEY)
  } catch {
    /* */
  }
}
