import { PRODUCTION_ORIGIN, isDesktopApp } from './apiOrigin'

export type DesktopReleaseInfo = {
  version: string
  installer: string
  url: string
  available?: boolean
}

export type VersionInfo = {
  version: string
  build: number
  deployedAt: string
  desktop?: DesktopReleaseInfo
}

const SEEN_BUILD_KEY = 'nexo_seen_build'
const SEEN_DESKTOP_KEY = 'nexo_seen_desktop_version'

export function getSeenBuild(): number {
  const raw = localStorage.getItem(SEEN_BUILD_KEY)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function markBuildSeen(build: number) {
  localStorage.setItem(SEEN_BUILD_KEY, String(build))
}

export function getSeenDesktopVersion(): string {
  return localStorage.getItem(SEEN_DESKTOP_KEY) || ''
}

export function markDesktopVersionSeen(version: string) {
  if (version) localStorage.setItem(SEEN_DESKTOP_KEY, version)
}

async function fetchVersion(url: string): Promise<VersionInfo | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as VersionInfo
  } catch {
    return null
  }
}

export async function fetchLocalVersion(): Promise<VersionInfo | null> {
  return fetchVersion(`/version.json?ts=${Date.now()}`)
}

export async function fetchRemoteVersion(): Promise<VersionInfo | null> {
  return fetchVersion(`${PRODUCTION_ORIGIN}/version.json?ts=${Date.now()}`)
}

/** Compara versões semver simples (1.2.3). */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export { isDesktopApp }
