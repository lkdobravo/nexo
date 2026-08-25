import { AppWindow, Monitor, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getDesktopApi, type CaptureSource } from '../lib/apiOrigin'
import { closeScreenSharePicker, subscribeScreenSharePicker } from '../lib/screenShareUi'
import { callManager } from '../lib/webrtc'

type Tab = 'screen' | 'window'

export function ScreenSharePicker() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('screen')
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturerOk, setCapturerOk] = useState(false)

  useEffect(() => subscribeScreenSharePicker(setOpen), [])

  useEffect(() => {
    if (!open) return
    setTab('screen')
    setSelected(null)
    setError(null)
    setBusy(false)
    setSources([])

    const api = getDesktopApi()
    const canList = typeof api?.listCaptureSources === 'function'
    setCapturerOk(canList)
    if (!canList) return

    let cancelled = false
    let first = true

    const load = async () => {
      if (first) setLoading(true)
      try {
        const list = (await api?.listCaptureSources?.()) || []
        if (cancelled) return
        setSources(list)
        setSelected((prev) => {
          if (prev && list.some((s) => s.id === prev)) return prev
          return list.find((s) => s.type === 'screen')?.id || list[0]?.id || null
        })
      } catch {
        if (!cancelled) {
          setCapturerOk(false)
          setError('Não foi possível listar monitores e janelas.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          first = false
        }
      }
    }

    void load()
    const id = window.setInterval(() => void load(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [open])

  useEffect(() => {
    if (!open || !capturerOk) return
    const first = sources.find((s) => s.type === tab)
    setSelected((prev) => {
      const stillValid = prev && sources.some((s) => s.id === prev && s.type === tab)
      return stillValid ? prev : first?.id || null
    })
  }, [tab, open, capturerOk, sources])

  const filtered = useMemo(
    () => sources.filter((s) => s.type === tab),
    [sources, tab],
  )

  if (!open) return null

  const close = () => closeScreenSharePicker()

  const startWithSource = async (sourceId: string) => {
    setBusy(true)
    setError(null)
    const result = await callManager.shareScreen({ sourceId })
    setBusy(false)
    if (result === 'ok') close()
    else if (result === 'error') setError('Não foi possível iniciar o compartilhamento.')
  }

  const startWithSurface = async (surface: 'monitor' | 'window') => {
    setBusy(true)
    setError(null)
    const result = await callManager.shareScreen({ surface })
    setBusy(false)
    if (result === 'ok') close()
    else if (result === 'error') setError('Não foi possível iniciar o compartilhamento.')
  }

  return (
    <div
      className="ss-picker-back"
      role="dialog"
      aria-modal="true"
      aria-label="Compartilhar tela"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="ss-picker" onMouseDown={(e) => e.stopPropagation()}>
        <header className="ss-picker-head">
          <div>
            <h2>Compartilhar tela</h2>
            <p>
              {capturerOk
                ? 'Clique na miniatura da tela ou da janela e depois em Compartilhar.'
                : 'Escolha tela cheia ou janela — o sistema pedirá a confirmação.'}
            </p>
          </div>
          <button type="button" className="ss-picker-close" onClick={close} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="ss-picker-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'screen'}
            className={tab === 'screen' ? 'on' : ''}
            onClick={() => setTab('screen')}
          >
            <Monitor size={16} />
            Tela cheia
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'window'}
            className={tab === 'window' ? 'on' : ''}
            onClick={() => setTab('window')}
          >
            <AppWindow size={16} />
            Janela
          </button>
        </div>

        {capturerOk ? (
          <div className="ss-picker-body">
            {loading && !filtered.length ? (
              <p className="ss-picker-empty">Carregando monitores e janelas…</p>
            ) : filtered.length === 0 ? (
              <p className="ss-picker-empty">
                {tab === 'screen'
                  ? 'Nenhum monitor encontrado.'
                  : 'Nenhuma janela aberta encontrada. Abra o app que quer compartilhar e volte aqui.'}
              </p>
            ) : (
              <div className="ss-picker-grid">
                {filtered.map((source) => {
                  const isSelected = selected === source.id
                  return (
                    <button
                      key={source.id}
                      type="button"
                      className={`ss-picker-card ${isSelected ? 'selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelected(source.id)}
                      onDoubleClick={() => void startWithSource(source.id)}
                    >
                      <div className="ss-picker-thumb">
                        {source.thumbnail ? (
                          <img src={source.thumbnail} alt="" draggable={false} />
                        ) : (
                          <Monitor size={28} />
                        )}
                      </div>
                      <div className="ss-picker-meta">
                        {source.appIcon ? (
                          <img src={source.appIcon} alt="" className="ss-picker-icon" draggable={false} />
                        ) : null}
                        <span title={source.name}>{source.name}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="ss-picker-body ss-picker-simple">
            <p>
              {tab === 'screen'
                ? 'Vai compartilhar o monitor inteiro (tudo que estiver visível).'
                : 'No próximo passo, escolha a janela específica no seletor do sistema.'}
            </p>
            <button
              type="button"
              className="ss-picker-go"
              disabled={busy}
              onClick={() => void startWithSurface(tab === 'screen' ? 'monitor' : 'window')}
            >
              {busy ? 'Abrindo…' : tab === 'screen' ? 'Compartilhar tela cheia' : 'Escolher janela'}
            </button>
          </div>
        )}

        {error ? <p className="ss-picker-error">{error}</p> : null}

        {capturerOk ? (
          <footer className="ss-picker-foot">
            <button type="button" className="ss-picker-cancel" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="ss-picker-go"
              disabled={!selected || busy}
              onClick={() => selected && void startWithSource(selected)}
            >
              {busy ? 'Compartilhando…' : 'Compartilhar'}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
