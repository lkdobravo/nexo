import { useEffect, useMemo, useRef } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { profileBannerStyle } from '../lib/profileBanner'
import { boardForUser } from '../lib/profileBoard'
import { useAppStore } from '../store'
import type { User } from '../types'
import { Avatar } from './Avatar'
import { UserBadges } from './UserBadges'

function statusLabel(s: User['status']) {
  if (s === 'online') return 'Online'
  if (s === 'idle') return 'Ausente'
  if (s === 'dnd') return 'Não perturbe'
  return 'Offline'
}

function miniProfilePosition(anchorRect: DOMRect | null) {
  const width = 320
  const margin = 8
  if (!anchorRect) {
    return {
      left: Math.max(margin, (window.innerWidth - width) / 2),
      top: Math.max(margin, (window.innerHeight - 420) / 2),
    }
  }

  let left = anchorRect.right + 12
  if (left + width > window.innerWidth - margin) {
    left = anchorRect.left - width - 12
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))

  let top = anchorRect.top - 16
  const maxTop = window.innerHeight - 440
  top = Math.max(margin, Math.min(top, maxTop))

  return { left, top }
}

export function UserProfileCard({
  user,
  anchorRect = null,
  onClose,
  onExpandProfile,
}: {
  user: User
  anchorRect?: DOMRect | null
  onClose: () => void
  onExpandProfile?: () => void
}) {
  const me = useAppStore((s) => s.me)
  const cardRef = useRef<HTMLDivElement>(null)
  const board = boardForUser(user)
  const gameWidget = board.widgets.find((w) => w.type === 'favorite_game' || w.type === 'collection')
  const isSelf = user.id === me?.id

  const style = useMemo(() => miniProfilePosition(anchorRect), [anchorRect])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const openExpanded = () => {
    onClose()
    onExpandProfile?.()
  }

  return (
    <div className="profile-card-back discord-mini-layer" aria-hidden={false}>
      <div
        ref={cardRef}
        className="profile-pop discord-mini-pop discord-mini-floating"
        style={style}
        role="dialog"
        aria-label={`Perfil de ${user.name}`}
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
          <button
            type="button"
            className="profile-pop-av discord-mini-av-btn"
            onClick={openExpanded}
            title="Abrir perfil completo"
          >
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
            {user.customStatus ? <p className="profile-pop-status">{user.customStatus}</p> : null}
          </div>

          {user.bio ? <blockquote className="discord-mini-quote">&ldquo;{user.bio}&rdquo;</blockquote> : null}

          {gameWidget ? (
            <div className="discord-game-collection">
              <span>Game Collection</span>
              <strong>{gameWidget.gameName || '—'}</strong>
            </div>
          ) : null}

          <button type="button" className="profile-pop-btn discord-edit-profile" onClick={openExpanded}>
            <Pencil size={16} /> {isSelf ? 'Edit Profile' : 'Ver perfil completo'}
          </button>
        </div>
      </div>
    </div>
  )
}
