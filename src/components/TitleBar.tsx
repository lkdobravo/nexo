import { useCallback, useEffect, useState } from 'react'
import { getDesktopApi, isDesktopApp } from '../lib/apiOrigin'
import { readDesktopPrefs } from '../lib/desktopPrefs'
import { useAppStore } from '../store'

function titleFromView(): string {
  const view = useAppStore.getState().view
  const users = useAppStore.getState().users
  const me = useAppStore.getState().me
  const servers = useAppStore.getState().servers

  if (view.kind === 'friends') return 'Amigos'
  if (view.kind === 'dm') {
    const peer = users.find((u) => u.id === view.userId) || (me?.id === view.userId ? me : null)
    return peer?.name || 'Mensagens diretas'
  }
  if (view.kind === 'channel') {
    const server = servers.find((s) => s.id === view.serverId)
    const channel = server?.channels.find((c) => c.id === view.channelId)
    if (channel) return channel.type === 'voice' ? channel.name : `#${channel.name}`
    return server?.name || 'Nexo'
  }
  return 'Nexo'
}

async function desktopMinimize() {
  const api = getDesktopApi()
  const toBackground = readDesktopPrefs().minimizeToBackground
  if (toBackground) {
    if (api?.hide) return api.hide()
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return getCurrentWindow().hide()
  }
  if (api?.minimize) return api.minimize()
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().minimize()
}

async function desktopToggleMaximize(): Promise<boolean | void> {
  const api = getDesktopApi()
  if (api?.toggleMaximize) return api.toggleMaximize()
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  const max = await win.isMaximized()
  if (max) await win.unmaximize()
  else await win.maximize()
  return !(await win.isMaximized()) ? false : true
}

async function desktopIsMaximized(): Promise<boolean> {
  const api = getDesktopApi()
  if (api?.isMaximized) return api.isMaximized()
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().isMaximized()
}

async function desktopClose() {
  const api = getDesktopApi()
  if (api?.close) return api.close()
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

export function TitleBar() {
  const [desktop, setDesktop] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [title, setTitle] = useState('Nexo')
  const view = useAppStore((s) => s.view)
  const users = useAppStore((s) => s.users)
  const servers = useAppStore((s) => s.servers)

  useEffect(() => {
    const on = isDesktopApp()
    setDesktop(on)
    if (on) document.body.classList.add('desktop-app')
    return () => document.body.classList.remove('desktop-app')
  }, [])

  useEffect(() => {
    setTitle(titleFromView())
  }, [view, users, servers])

  useEffect(() => {
    if (!desktop) return
    void desktopIsMaximized().then(setMaximized).catch(() => {})
  }, [desktop])

  const onMinimize = useCallback(() => {
    void desktopMinimize()
  }, [])

  useEffect(() => {
    if (!desktop) return
    const sync = () => {
      void getDesktopApi()?.setMinimizeToBackground?.(readDesktopPrefs().minimizeToBackground)
    }
    sync()
    window.addEventListener('nexo-desktop-prefs', sync)
    return () => window.removeEventListener('nexo-desktop-prefs', sync)
  }, [desktop])

  const onToggleMaximize = useCallback(() => {
    void desktopToggleMaximize().then((v) => {
      if (typeof v === 'boolean') setMaximized(v)
      else void desktopIsMaximized().then(setMaximized)
    })
  }, [])

  const onClose = useCallback(() => {
    void desktopClose()
  }, [])

  if (!desktop) return null

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-brand" data-tauri-drag-region>
          Nexo
        </span>
      </div>
      <div className="titlebar-center" data-tauri-drag-region onDoubleClick={onToggleMaximize}>
        <span className="titlebar-title" data-tauri-drag-region>
          {title}
        </span>
      </div>
      <div className="titlebar-right">
        <button type="button" className="titlebar-btn" title="Minimizar" onClick={onMinimize}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect y="5.5" width="12" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={onToggleMaximize}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                d="M3.5 2.5h6v6h-6zM2.5 3.5v6h6"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button type="button" className="titlebar-btn titlebar-close" title="Fechar" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2.2 2.2l7.6 7.6M9.8 2.2L2.2 9.8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
