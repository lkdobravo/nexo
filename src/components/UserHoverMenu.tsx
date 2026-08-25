import { useEffect, useRef } from 'react'
import { MessageCircle, Phone, User } from 'lucide-react'
import { useAppStore, startCall } from '../store'
import type { User as AppUser } from '../types'
import { Avatar } from './Avatar'

export function UserHoverMenu({
  user,
  onClose,
  onViewProfile,
}: {
  user: AppUser
  onClose: () => void
  onViewProfile: (user: AppUser) => void
}) {
  const me = useAppStore((s) => s.me)
  const view = useAppStore((s) => s.view)
  const openDm = useAppStore((s) => s.openDm)
  const menuRef = useRef<HTMLDivElement>(null)

  const inThisDm = view.kind === 'dm' && view.userId === user.id
  const isSelf = user.id === me?.id

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="call-user-menu-back" onClick={onClose}>
      <div
        ref={menuRef}
        className="call-user-menu call-user-menu-centered"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="call-user-menu-head">
          <Avatar name={user.name} color={user.color} avatar={user.avatar} status={user.status} size="lg" />
          <div>
            <b>{user.name}</b>
            <span>@{user.username}</span>
          </div>
        </div>

        <div className="call-user-menu-sep" />

        <button
          type="button"
          className="call-user-menu-item"
          onClick={() => {
            onViewProfile(user)
            onClose()
          }}
        >
          <User size={16} /> Perfil
        </button>

        {!isSelf && !inThisDm ? (
          <button
            type="button"
            className="call-user-menu-item"
            onClick={() => {
              openDm(user.id)
              onClose()
            }}
          >
            <MessageCircle size={16} /> Mensagem
          </button>
        ) : null}

        {!isSelf ? (
          <button
            type="button"
            className="call-user-menu-item"
            onClick={() => {
              if (!inThisDm) openDm(user.id)
              startCall(user.id, 'audio')
              onClose()
            }}
          >
            <Phone size={16} /> Ligar
          </button>
        ) : null}
      </div>
    </div>
  )
}
