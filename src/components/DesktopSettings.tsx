import { useEffect, useState } from 'react'
import { getDesktopApi, isDesktopApp } from '../lib/apiOrigin'
import { readDesktopPrefs, writeDesktopPrefs } from '../lib/desktopPrefs'

export function DesktopSettings() {
  const [autostart, setAutostart] = useState(false)
  const [minimizeToBackground, setMinimizeToBackground] = useState(
    () => readDesktopPrefs().minimizeToBackground,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState('desktop')

  useEffect(() => {
    if (!isDesktopApp()) return
    void (async () => {
      try {
        const api = getDesktopApi()
        if (api?.getAutostart) {
          setAutostart(await api.getAutostart())
          const info = await api.info?.()
          if (info?.engine) setEngine(info.engine)
          const prefs = readDesktopPrefs()
          setMinimizeToBackground(prefs.minimizeToBackground)
          await api.setMinimizeToBackground?.(prefs.minimizeToBackground)
        } else {
          const { isEnabled } = await import('@tauri-apps/plugin-autostart')
          setAutostart(await isEnabled())
          setEngine('tauri')
        }
      } catch {
        setError('Não foi possível ler as opções do desktop.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (!isDesktopApp()) {
    return (
      <div className="set-panel">
        <h2>Aplicativo desktop</h2>
        <p className="set-hint">Estas opções aparecem apenas no Nexo instalado no Windows.</p>
      </div>
    )
  }

  return (
    <>
      <h2>Aplicativo desktop</h2>
      <p className="set-hint">
        Programa nativo no Windows (motor {engine === 'electron' ? 'Electron — mesma base do Discord' : engine}
        ). A interface roda no seu PC; o servidor online sincroniza contas, mensagens e chamadas.
      </p>

      <h3 className="set-h">Sistema</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-meta">
            <span className="set-row-label">Inicializar com o Windows</span>
            <span className="set-row-hint">
              Abre o Nexo automaticamente ao ligar o PC (pode iniciar na bandeja).
            </span>
          </div>
          <div className="set-row-actions">
            <button
              type="button"
              role="switch"
              aria-checked={autostart}
              aria-label="Inicializar com o Windows"
              className={`set-switch ${autostart ? 'on' : ''}`}
              disabled={loading}
              onClick={() => {
                void (async () => {
                  try {
                    const next = !autostart
                    const api = getDesktopApi()
                    if (api?.setAutostart) {
                      setAutostart(await api.setAutostart(next))
                    } else {
                      const mod = await import('@tauri-apps/plugin-autostart')
                      if (next) await mod.enable()
                      else await mod.disable()
                      setAutostart(next)
                    }
                  } catch {
                    setError('Não foi possível alterar a inicialização automática.')
                  }
                })()
              }}
            >
              <span className="set-switch-knob" />
            </button>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-meta">
            <span className="set-row-label">Minimizar em segundo plano</span>
            <span className="set-row-hint">
              Ao minimizar, o Nexo vai para a bandeja, reduz o uso de CPU e mantém só a ligação de
              voz. Clique com o direito no ícone → Restaurar para voltar.
            </span>
          </div>
          <div className="set-row-actions">
            <button
              type="button"
              role="switch"
              aria-checked={minimizeToBackground}
              aria-label="Minimizar em segundo plano"
              className={`set-switch ${minimizeToBackground ? 'on' : ''}`}
              onClick={() => {
                const next = !minimizeToBackground
                setMinimizeToBackground(next)
                writeDesktopPrefs({ minimizeToBackground: next })
                void getDesktopApi()?.setMinimizeToBackground?.(next)
              }}
            >
              <span className="set-switch-knob" />
            </button>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-meta">
            <span className="set-row-label">Bandeja do sistema</span>
            <span className="set-row-hint">
              O botão X também envia o Nexo para a bandeja. Use “Sair do Nexo” no menu do ícone para
              encerrar de verdade.
            </span>
          </div>
          <div className="set-row-actions">
            <button
              type="button"
              className="set-btn"
              onClick={() => {
                void (async () => {
                  const api = getDesktopApi()
                  if (api?.hide) await api.hide()
                  else {
                    const { getCurrentWindow } = await import('@tauri-apps/api/window')
                    await getCurrentWindow().hide()
                  }
                })()
              }}
            >
              Ir para bandeja
            </button>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-meta">
            <span className="set-row-label">Encerrar</span>
            <span className="set-row-hint">Fecha o programa por completo.</span>
          </div>
          <div className="set-row-actions">
            <button
              type="button"
              className="set-btn danger"
              onClick={() => {
                void (async () => {
                  try {
                    const api = getDesktopApi()
                    if (api?.quit) await api.quit()
                    else {
                      const { invoke } = await import('@tauri-apps/api/core')
                      await invoke('quit_app')
                    }
                  } catch {
                    setError('Não foi possível encerrar o aplicativo.')
                  }
                })()
              }}
            >
              Sair do Nexo
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="set-hint" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      ) : null}
    </>
  )
}
