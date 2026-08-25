import { Download, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDesktopApi, isDesktopApp } from '../lib/apiOrigin'
import { useAppStore } from '../store'
import {
  fetchRemoteVersion,
  getSeenBuild,
  getSeenDesktopVersion,
  isNewerVersion,
  markBuildSeen,
  markDesktopVersionSeen,
  type VersionInfo,
} from '../lib/version'

const POLL_MS = 45_000

type PromptKind = 'ui' | 'shell'

/**
 * Modelo Discord:
 * - UI nova → faixa discreta “Reiniciar” (não bloqueia chamada)
 * - Casca Electron mais antiga + instalador hospedado → “Baixar e instalar”
 * - Casca antiga sem instalador na nuvem → silêncio (UI já atualiza pelo hub)
 */
export function UpdateNotifier() {
  const callStatus = useAppStore((s) => s.call.status)
  const [update, setUpdate] = useState<VersionInfo | null>(null)
  const [kind, setKind] = useState<PromptKind>('ui')
  const [dismissedBuild, setDismissedBuild] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localDesktopVersion, setLocalDesktopVersion] = useState<string | null>(null)
  const applyingRef = useRef(false)

  const busyCall =
    callStatus === 'incoming' || callStatus === 'outgoing' || callStatus === 'connecting'

  const check = useCallback(async () => {
    if (applyingRef.current) return

    const remote = await fetchRemoteVersion()
    if (!remote?.build) return
    if (applyingRef.current) return

    let shellNewer = false
    let installerReady = false
    if (isDesktopApp() && remote.desktop?.version) {
      const seenDesktop = getSeenDesktopVersion()
      if (seenDesktop !== remote.desktop.version) {
        const api = getDesktopApi()
        const info = await api?.info?.().catch(() => null)
        const localVer = info?.version || localDesktopVersion || '0.0.0'
        if (info?.version) setLocalDesktopVersion(info.version)
        shellNewer = isNewerVersion(remote.desktop.version, localVer)
        installerReady =
          shellNewer &&
          remote.desktop.available === true &&
          Boolean(remote.desktop.url) &&
          (await probeInstallerUrl(remote.desktop.url))
      }
    }

    const seen = getSeenBuild()
    // Primeira visita: marca build atual, sem prompt (UI já é a do servidor).
    if (seen === 0 && !installerReady) {
      markBuildSeen(remote.build)
      setUpdate(null)
      return
    }

    const uiNewer = remote.build > seen && remote.build !== dismissedBuild

    // Prioridade Discord: instalador da casca só se realmente baixável.
    if (installerReady) {
      setKind('shell')
      setUpdate(remote)
      return
    }

    // Casca desatualizada sem host de .exe → não enche o saco; UI já vem da nuvem.
    if (shellNewer && !installerReady) {
      if (!uiNewer) {
        setUpdate(null)
        return
      }
    }

    if (uiNewer) {
      setKind('ui')
      setUpdate(remote)
      return
    }

    setUpdate(null)
  }, [dismissedBuild, localDesktopVersion])

  useEffect(() => {
    void check()
    const id = window.setInterval(() => void check(), POLL_MS)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [check])

  if (!update || busyCall) return null

  const dismiss = () => {
    setDismissedBuild(update.build)
    markBuildSeen(update.build)
    if (kind === 'shell' && update.desktop?.version) {
      markDesktopVersionSeen(update.desktop.version)
    }
    setUpdate(null)
    setError(null)
    setProgress(null)
  }

  const apply = () => {
    applyingRef.current = true
    setApplying(true)
    setError(null)
    markBuildSeen(update.build)
    const api = getDesktopApi()

    if (kind === 'shell') {
      if (update.desktop?.version) markDesktopVersionSeen(update.desktop.version)
      if (!update.desktop?.url || !api?.downloadAndInstallUpdate) {
        applyingRef.current = false
        setApplying(false)
        setError('Não foi possível baixar o instalador automaticamente.')
        return
      }
      setProgress('Baixando…')
      void api
        .downloadAndInstallUpdate({
          url: update.desktop.url,
          version: update.desktop.version,
        })
        .then(() => setProgress('Instalando… o Nexo vai reiniciar.'))
        .catch((err: unknown) => {
          applyingRef.current = false
          setApplying(false)
          setProgress(null)
          setError(err instanceof Error ? err.message : 'Falha ao baixar/instalar.')
        })
      return
    }

    // UI: recarrega (igual Discord “Restart”)
    if (api?.applyUpdate) {
      void api.applyUpdate()
      return
    }
    window.location.reload()
  }

  const label =
    kind === 'shell'
      ? `Nova versão do app (v${update.desktop?.version || update.version})`
      : 'Atualização pronta'

  const actionLabel =
    applying && kind === 'shell'
      ? 'Baixando…'
      : applying
        ? 'Atualizando…'
        : kind === 'shell'
          ? 'Baixar e instalar'
          : 'Reiniciar'

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-inner">
        {kind === 'shell' ? <Download size={18} aria-hidden /> : <RefreshCw size={18} aria-hidden />}
        <span>
          {label}
          {progress ? ` — ${progress}` : ''}
          {error ? ` — ${error}` : ''}
        </span>
        <button type="button" className="update-banner-btn" disabled={applying} onClick={apply}>
          {actionLabel}
        </button>
        <button
          type="button"
          className="update-banner-dismiss"
          disabled={applying}
          aria-label="Depois"
          onClick={dismiss}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}

async function probeInstallerUrl(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (head.ok) return true
    // Alguns hosts não aceitam HEAD
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Range: 'bytes=0-0' },
      })
      return get.ok || get.status === 206
    }
    return false
  } catch {
    return false
  }
}
