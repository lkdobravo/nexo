import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Pin } from 'lucide-react'
import { callManager } from '../lib/webrtc'
import { useAppStore } from '../store'
import type { User as AppUser } from '../types'

function menuPosition(anchor: { x: number; y: number }): CSSProperties {
  const width = 256
  const height = 480
  const margin = 8
  let left = anchor.x + 10
  let top = anchor.y + 6
  if (left + width > window.innerWidth - margin) {
    left = anchor.x - width - 10
  }
  if (top + height > window.innerHeight - margin) {
    top = anchor.y - height - 6
  }
  return {
    left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(top, window.innerHeight - margin)),
  }
}

export function CallUserMenu({
  user,
  anchor = { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  inDm = false,
  onClose,
  onEditProfile,
  onViewProfile,
  isSelf,
}: {
  user: AppUser
  anchor?: { x: number; y: number }
  inDm?: boolean
  onClose: () => void
  onEditProfile?: () => void
  onViewProfile?: (user: AppUser) => void
  isSelf?: boolean
}) {
  const openDm = useAppStore((s) => s.openDm)
  const removeFriend = useAppStore((s) => s.removeFriend)
  const friendIds = useAppStore((s) => s.friendIds)
  const setView = useAppStore((s) => s.setView)
  const mediaTick = useAppStore((s) => s.call.mediaTick)
  const menuRef = useRef<HTMLDivElement>(null)
  const vol = Math.round(callManager.getPeerVolume(user.id) * 100)
  const hiddenVideo = callManager.isPeerVideoHidden(user.id)
  const locallyMuted = vol === 0
  const style = useMemo(() => menuPosition(anchor), [anchor.x, anchor.y])

  useEffect(() => {
    void mediaTick
  }, [mediaTick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onClick, true)
    }, 16)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick, true)
    }
  }, [onClose])

  const menu = isSelf ? (
    <div className="call-ctx-root">
      <div className="call-ctx-backdrop" onMouseDown={onClose} aria-hidden />
      <div
        ref={menuRef}
        className="call-ctx-menu discord-ctx-menu"
        style={style}
        role="menu"
        aria-label="Suas opções"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="call-ctx-item"
          onClick={() => {
            onEditProfile?.()
            onClose()
          }}
        >
          Editar perfil
        </button>
      </div>
    </div>
  ) : (
    <div className="call-ctx-root">
      <div className="call-ctx-backdrop" onMouseDown={onClose} aria-hidden />
      <div
        ref={menuRef}
        className="call-ctx-menu discord-ctx-menu"
        style={style}
        role="menu"
        aria-label={`Opções de ${user.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {inDm ? (
          <>
            <button type="button" className="call-ctx-item muted" disabled>
              Marcar como lida
            </button>
            <button type="button" className="call-ctx-item">
              <Pin size={16} /> Desafixar
            </button>
            <div className="call-ctx-sep" />
          </>
        ) : null}

        <button
          type="button"
          className="call-ctx-item"
          onClick={() => {
            onViewProfile?.(user)
            onClose()
          }}
        >
          Perfil
        </button>

        {inDm ? (
          <button
            type="button"
            className="call-ctx-item"
            onClick={() => {
              setView({ kind: 'friends' })
              onClose()
            }}
          >
            Fechar DM
          </button>
        ) : (
          <button
            type="button"
            className="call-ctx-item"
            onClick={() => {
              openDm(user.id)
              setView({ kind: 'dm', userId: user.id })
              onClose()
            }}
          >
            Mensagem direta
          </button>
        )}

        <div className="call-ctx-sep" />

        <div className="call-ctx-vol discord-ctx-vol">
          <span>Volume do usuário</span>
          <input
            type="range"
            min={0}
            max={200}
            value={vol}
            onChange={(e) => callManager.setPeerVolume(user.id, Number(e.target.value) / 100)}
          />
        </div>

        <div className="call-ctx-sep" />

        <label className="call-ctx-check discord-ctx-check">
          <span>Silenciar</span>
          <input
            type="checkbox"
            checked={locallyMuted}
            onChange={() => callManager.setPeerVolume(user.id, locallyMuted ? 1 : 0)}
          />
        </label>

        <label className="call-ctx-check discord-ctx-check">
          <span>Desativar vídeo</span>
          <input
            type="checkbox"
            checked={hiddenVideo}
            onChange={() => callManager.setPeerVideoHidden(user.id, !hiddenVideo)}
          />
        </label>

        <div className="call-ctx-sep" />

        {friendIds.includes(user.id) ? (
          <button
            type="button"
            className="call-ctx-item"
            onClick={() => {
              removeFriend(user.id)
              onClose()
            }}
          >
            Remover amigo
          </button>
        ) : null}

        <button type="button" className="call-ctx-item danger">
          Bloquear
        </button>

        <div className="call-ctx-sep" />

        <button
          type="button"
          className="call-ctx-item call-ctx-item-id"
          onClick={() => {
            void navigator.clipboard.writeText(user.id)
            onClose()
          }}
        >
          Copiar ID do usuário
          <span className="call-ctx-id-badge">ID</span>
        </button>
      </div>
    </div>
  )

  return createPortal(menu, document.body)
}
