import { Phone, Video } from 'lucide-react'
import { callManager } from '../lib/webrtc'
import type { CallKind, User } from '../types'
import { Avatar } from './Avatar'

export function PrivateCallLobby({ peer }: { peer: User }) {
  const join = (kind: CallKind) => {
    void callManager.rejoin(peer.id, kind)
  }

  return (
    <section className="call-lobby" aria-label="Chamada ativa — voltar">
      <div className="call-lobby-inner">
        <div className="call-lobby-av-wrap call-lobby-enter">
          <Avatar
            name={peer.name}
            color={peer.color}
            avatar={peer.avatar}
            status={peer.status}
            size="xxl"
            user={peer}
            gifMotion="always"
          />
        </div>
        <p className="call-lobby-hint">Chamada em andamento</p>
        <div className="call-lobby-actions">
          <button
            type="button"
            className="call-lobby-btn video"
            title="Entrar com vídeo"
            onClick={() => join('video')}
          >
            <Video size={22} />
          </button>
          <button
            type="button"
            className="call-lobby-btn join"
            title="Entrar na chamada"
            onClick={() => join('audio')}
          >
            <Phone size={22} />
          </button>
        </div>
      </div>
    </section>
  )
}
