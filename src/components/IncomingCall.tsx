import { createPortal } from 'react-dom'
import { Phone, PhoneOff, Video } from 'lucide-react'
import { stopRingtone } from '../lib/sounds'
import { callManager } from '../lib/webrtc'
import { useAppStore } from '../store'
import { Avatar } from './Avatar'

export function IncomingCall() {
  const call = useAppStore((s) => s.call)
  const users = useAppStore((s) => s.users)
  if (call.status !== 'incoming' || !call.incomingFrom) return null
  const peer = users.find((u) => u.id === call.incomingFrom)
  if (!peer) return null

  const isVideo = call.incomingKind === 'video'

  return createPortal(
    <div className="incoming-overlay" role="dialog" aria-modal="true" aria-label="Chamada recebida">
      <div className="incoming-card">
        <div className="incoming-card-av">
          <span className="incoming-ring-pulse" aria-hidden />
          <Avatar
            name={peer.name}
            color={peer.color}
            avatar={peer.avatar}
            size="xxl"
            status={peer.status}
            gifMotion="always"
          />
        </div>
        <p className="incoming-kicker">Chamada recebida</p>
        <h2>{peer.name}</h2>
        <p className="incoming-ring">{isVideo ? 'Chamada de vídeo' : 'Chamada de voz'}</p>
        <div className="incoming-actions">
          <button
            type="button"
            className="decline"
            onClick={() => {
              stopRingtone()
              callManager.reject()
            }}
          >
            <PhoneOff size={22} />
            <span>Recusar</span>
          </button>
          <button
            type="button"
            className="accept"
            onClick={() => {
              stopRingtone()
              void callManager.accept()
            }}
          >
            {isVideo ? <Video size={22} /> : <Phone size={22} />}
            <span>Atender</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
