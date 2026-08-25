import { useEffect, useRef, type RefObject } from 'react'
import { Pencil, Plus, Settings, X } from 'lucide-react'
import { profileBannerStyle } from '../lib/profileBanner'
import { boardForUser } from '../lib/profileBoard'
import { useAppStore } from '../store'
import type { PresenceStatus, User } from '../types'
import { Avatar } from './Avatar'
import { UserBadges } from './UserBadges'

const STATUS_OPTIONS: {
  id: PresenceStatus
  label: string
  hint?: string
}[] = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Ausente' },
  { id: 'dnd', label: 'Ocupado', hint: 'Você não receberá notificações.' },
  { id: 'offline', label: 'Offline', hint: 'Você aparecerá como offline.' },
]

function statusLabel(s: PresenceStatus) {
  return STATUS_OPTIONS.find((o) => o.id === s)?.label || 'Online'
}

export function SelfProfilePopover({
  user,
  anchorRect,
  ignoreRef,
  onClose,
  onOpenSettings,
  onExpandProfile,
}: {
  user: User
  anchorRect: DOMRect
  ignoreRef?: RefObject<HTMLElement | null>
  onClose: () => void
  onOpenSettings: () => void
  onExpandProfile: () => void
}) {
  const setStatus = useAppStore((s) => s.setStatus)
  const call = useAppStore((s) => s.call)
  const cardRef = useRef<HTMLDivElement>(null)
  const board = boardForUser(user)
  const gameWidget = board.widgets.find((w) => w.type === 'favorite_game' || w.type === 'collection')

  const inCall = call.status !== 'idle' && !call.channelId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: Event) => {
      const target = e.target as Node
      if (cardRef.current?.contains(target)) return
      if (ignoreRef?.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose, ignoreRef])

  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320))
  const bottom = window.innerHeight - anchorRect.top + 8

  return (
    <div className="profile-card-back self-profile-layer">
      <div
        ref={cardRef}
        className="profile-pop self-profile-pop discord-mini-pop"
        style={{ left, bottom }}
        role="dialog"
        aria-label="Seu perfil"
      >
        <button type="button" className="profile-pop-close" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="profile-pop-banner discord-mini-banner" style={profileBannerStyle(user)}>
          {board.activityText ? (
            <div className="discord-activity-pill">
              <Plus size={12} /> {board.activityText}
            </div>
          ) : null}
        </div>
        <div className="profile-pop-body discord-mini-body">
          <button type="button" className="profile-pop-av discord-mini-av-btn" onClick={onExpandProfile} title="Abrir perfil completo">
            <Avatar
              name={user.name}
              color={user.color}
              avatar={user.avatar}
              status={user.status}
              size="xl"
              user={user}
              gifMotion="always"
            />
          </button>
          <div className="profile-pop-head">
            <h3>{user.name}</h3>
            <p className="profile-pop-user">
              <span className="profile-pop-user-line">
                {user.username} · {statusLabel(user.status)}
                <UserBadges user={user} />
              </span>
            </p>
          </div>

          {user.bio ? <blockquote className="discord-mini-quote">&ldquo;{user.bio}&rdquo;</blockquote> : null}

          {gameWidget ? (
            <div className="discord-game-collection">
              <span>Game Collection</span>
              <strong>{gameWidget.gameName || '—'}</strong>
            </div>
          ) : null}

          {inCall ? (
            <div className="profile-pop-call">
              <h4>Em ligação</h4>
              <p>Chamada ativa</p>
            </div>
          ) : null}

          <div className="self-profile-status">
            <h4>Status</h4>
            <ul>
              {STATUS_OPTIONS.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    className={user.status === opt.id ? 'on' : ''}
                    onClick={() => setStatus(opt.id)}
                  >
                    <i className={`status ${opt.id}`} aria-hidden />
                    <span className="self-status-text">
                      <b>{opt.label}</b>
                      {opt.hint ? <small>{opt.hint}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="profile-pop-actions self-profile-actions discord-mini-actions">
            <button type="button" className="profile-pop-btn discord-edit-profile" onClick={onExpandProfile}>
              <Pencil size={16} /> Edit Profile
            </button>
            <button type="button" className="profile-pop-btn" onClick={onOpenSettings}>
              <Settings size={16} /> Configurações
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
