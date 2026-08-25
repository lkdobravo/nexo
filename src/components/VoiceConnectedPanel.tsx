import {
  AudioLines,
  Gamepad2,
  Monitor,
  MonitorOff,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react'

export function VoiceConnectedPanel({
  channelLabel,
  cameraOn,
  screenOn,
  onNavigate,
  onCamera,
  onScreenShare,
  onDisconnect,
}: {
  channelLabel: string
  muted: boolean
  deafened: boolean
  cameraOn: boolean
  screenOn: boolean
  onNavigate: () => void
  onCamera: () => void
  onScreenShare: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="voice-connected">
      <div className="voice-connected-top">
        <div className="voice-connected-signal" aria-hidden>
          <AudioLines size={16} />
        </div>
        <button type="button" className="voice-connected-info" onClick={onNavigate}>
          <span className="voice-connected-title">Voz conectada</span>
          <span className="voice-connected-channel">{channelLabel}</span>
        </button>
        <div className="voice-connected-top-actions">
          <div className="voice-connected-meter" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <button type="button" className="voice-connected-leave" title="Desconectar" onClick={onDisconnect}>
            <PhoneOff size={18} />
          </button>
        </div>
      </div>

      <div className="voice-connected-tools">
        <button
          type="button"
          className={cameraOn ? 'on' : ''}
          title={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
          onClick={onCamera}
        >
          {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          type="button"
          className={screenOn ? 'on' : ''}
          title={screenOn ? 'Parar transmissão' : 'Compartilhar tela'}
          onClick={onScreenShare}
        >
          {screenOn ? <MonitorOff size={18} /> : <Monitor size={18} />}
        </button>
        <button type="button" className="voice-tool-muted" title="Em breve" disabled>
          <Gamepad2 size={18} />
        </button>
        <button type="button" className="voice-tool-muted" title="Em breve" disabled>
          <AudioLines size={18} />
        </button>
      </div>
    </div>
  )
}
