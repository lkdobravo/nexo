import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { callManager } from '../lib/webrtc'
import { useAppStore } from '../store'
import type { User as AppUser } from '../types'

function menuPosition(anchor: { x: number; y: number }): CSSProperties {
  const width = 280
  const height = 280
  const margin = 8
  let left = anchor.x + 8
  let top = anchor.y + 8
  if (left + width > window.innerWidth - margin) left = anchor.x - width - 8
  if (top + height > window.innerHeight - margin) top = anchor.y - height - 8
  return {
    left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
  }
}

export function PresentStreamMenu({
  user,
  anchor,
  onClose,
}: {
  user: AppUser
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const mediaTick = useAppStore((s) => s.call.mediaTick)
  const menuRef = useRef<HTMLDivElement>(null)
  const userVol = Math.round(callManager.getPeerVolume(user.id) * 100)
  const streamVol = Math.round(callManager.getStreamVolume(user.id) * 100)
  const streamMuted = callManager.isStreamMuted(user.id)
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
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onClick, true), 16)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick, true)
    }
  }, [onClose])

  return createPortal(
    <div className="call-ctx-root">
      <div className="call-ctx-backdrop" onMouseDown={onClose} aria-hidden />
      <div
        ref={menuRef}
        className="call-ctx-menu discord-ctx-menu present-stream-menu"
        style={style}
        role="menu"
        aria-label={`Transmissão de ${user.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="call-ctx-vol discord-ctx-vol">
          <span>Volume do usuário</span>
          <input
            type="range"
            min={0}
            max={200}
            value={userVol}
            onChange={(e) => callManager.setPeerVolume(user.id, Number(e.target.value) / 100)}
          />
        </div>

        <div className="call-ctx-sep" />

        <div className="call-ctx-vol discord-ctx-vol">
          <span>Volume da transmissão</span>
          <input
            type="range"
            min={0}
            max={200}
            value={streamMuted ? 0 : streamVol}
            disabled={streamMuted}
            onChange={(e) => callManager.setStreamVolume(user.id, Number(e.target.value) / 100)}
          />
        </div>

        <div className="call-ctx-sep" />

        <label className="call-ctx-check discord-ctx-check">
          <span>Mutar transmissão</span>
          <input
            type="checkbox"
            checked={streamMuted}
            onChange={() => callManager.setStreamMuted(user.id, !streamMuted)}
          />
        </label>

        <label className="call-ctx-check discord-ctx-check">
          <span>Silenciar usuário</span>
          <input
            type="checkbox"
            checked={userVol === 0}
            onChange={() => callManager.setPeerVolume(user.id, userVol === 0 ? 1 : 0)}
          />
        </label>
      </div>
    </div>,
    document.body,
  )
}
