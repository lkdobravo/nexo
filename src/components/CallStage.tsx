import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic,
  MicOff,
  Headphones,
  VolumeX,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Maximize2,
  Minimize2,
  MessageSquare,
  AppWindow,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  Volume2,
} from 'lucide-react'
import { useSpeaking } from '../hooks/useSpeaking'
import { callManager } from '../lib/webrtc'
import { requestScreenShareToggle } from '../lib/screenShareUi'
import { getDesktopApi } from '../lib/apiOrigin'
import { useAppStore } from '../store'
import { AvatarStatusBadges } from './AvatarStatusBadges'
import { Avatar } from './Avatar'
import { CallUserMenu } from './CallUserMenu'
import { PresentStreamMenu } from './PresentStreamMenu'
import type { User, VideoFps, VideoQuality } from '../types'

function formatElapsed(start: number | null) {
  if (!start) return '00:00'
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function VideoEl({
  stream,
  muted,
  className,
  cover,
}: {
  stream: MediaStream | null
  muted?: boolean
  className?: string
  cover?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    const sync = () => {
      void el.play().catch(() => {})
    }
    el.addEventListener('loadedmetadata', sync)
    el.addEventListener('resize', sync)
    sync()
    return () => {
      el.removeEventListener('loadedmetadata', sync)
      el.removeEventListener('resize', sync)
    }
  }, [stream])
  if (!stream?.getVideoTracks().some((t) => t.readyState === 'live')) return null
  return (
    <div className="call-video-wrap">
      <video
        ref={ref}
        className={`${className || ''} ${cover ? 'cover' : ''}`.trim()}
        autoPlay
        playsInline
        muted={muted}
      />
    </div>
  )
}

function CallParticipant({
  user,
  label,
  speaking,
  muted,
  deafened,
  size = 'call',
  onAvatarClick,
  waiting,
  alone,
  connectedFlash,
  leaving,
}: {
  user: User
  label?: string
  speaking?: boolean
  muted?: boolean
  deafened?: boolean
  size?: 'xl' | 'call'
  onAvatarClick?: (user: User, e: MouseEvent) => void
  waiting?: boolean
  alone?: boolean
  connectedFlash?: boolean
  leaving?: boolean
}) {
  return (
    <div
      className={[
        'call-participant',
        leaving ? 'call-participant-leaving' : 'call-participant-enter',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className={[
          'call-avatar-ring',
          'call-avatar-btn',
          speaking ? 'talking' : '',
          waiting ? 'waiting' : '',
          alone ? 'alone' : '',
          connectedFlash ? 'connected-flash' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onAvatarClick ? (e) => onAvatarClick(user, e) : undefined}
        title={`Opções de ${user.name}`}
      >
        <Avatar
          name={user.name}
          color={user.color}
          avatar={user.avatar}
          size={size}
          gifMotion="speaking"
          speaking={Boolean(speaking)}
        />
        <AvatarStatusBadges muted={muted} deafened={deafened} />
      </button>
      <span className="call-participant-name">{label || user.name}</span>
    </div>
  )
}

function ParticipantTile({
  user,
  stream,
  label,
  presenting,
  mirror,
  muted,
  deafened,
  speaking,
  hideVideo,
  onAvatarClick,
}: {
  user: User
  stream: MediaStream | null
  label?: string
  presenting?: boolean
  mirror?: boolean
  muted?: boolean
  deafened?: boolean
  speaking?: boolean
  hideVideo?: boolean
  onAvatarClick?: (user: User, e: MouseEvent) => void
}) {
  const hasLiveVideo =
    !hideVideo &&
    Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled))
  return (
    <div className="call-tile" style={{ ['--tile-bg' as string]: user.color }}>
      {hasLiveVideo ? (
        <VideoEl stream={stream} muted={mirror} cover className={mirror ? 'mirror' : undefined} />
      ) : (
        <button
          type="button"
          className={`call-avatar-ring inset call-avatar-btn ${speaking ? 'talking' : ''}`}
          onClick={onAvatarClick ? (e) => onAvatarClick(user, e) : undefined}
          title={`Opções de ${user.name}`}
        >
          <Avatar
            name={user.name}
            color={user.color}
            avatar={user.avatar}
            size="xl"
            gifMotion="speaking"
            speaking={Boolean(speaking)}
          />
          <AvatarStatusBadges muted={muted} deafened={deafened} size="sm" />
        </button>
      )}
      {hasLiveVideo ? (
        <div className="call-tile-flags">
          <AvatarStatusBadges muted={muted} deafened={deafened} size="sm" inline />
        </div>
      ) : null}
      <span className="call-tile-name">
        {label || user.name}
        {presenting ? ' · Apresentando' : ''}
      </span>
    </div>
  )
}

export function CallStage({
  peer,
  onEditSelfProfile,
  onViewProfile,
  onCallMenuOpen,
  inDm = false,
  presentExpanded = false,
  onPresentExpandedChange,
}: {
  peer: User | null
  onEditSelfProfile?: () => void
  onViewProfile?: (user: User) => void
  onCallMenuOpen?: () => void
  inDm?: boolean
  presentExpanded?: boolean
  onPresentExpandedChange?: (expanded: boolean) => void
}) {
  const call = useAppStore((s) => s.call)
  const me = useAppStore((s) => s.me)
  const users = useAppStore((s) => s.users)
  const mediaPrefs = useAppStore((s) => s.mediaPrefs)
  const setMediaPrefs = useAppStore((s) => s.setMediaPrefs)
  const tick = call.mediaTick
  const rootRef = useRef<HTMLDivElement>(null)
  const presentMainRef = useRef<HTMLDivElement>(null)
  const prevStatus = useRef(call.status)
  const [, setNow] = useState(0)
  const [isFs, setIsFs] = useState(false)
  const [hideSide, setHideSide] = useState(false)
  const [showMedia, setShowMedia] = useState(false)
  const [mediaPopPos, setMediaPopPos] = useState({ left: 0, bottom: 0 })
  const mediaBtnRef = useRef<HTMLButtonElement>(null)
  const mediaPopRef = useRef<HTMLDivElement>(null)
  const [volPeer, setVolPeer] = useState(peer?.id || '')
  const [menuUser, setMenuUser] = useState<User | null>(null)
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 })
  const [presentMenuUser, setPresentMenuUser] = useState<User | null>(null)
  const [presentMenuAnchor, setPresentMenuAnchor] = useState({ x: 0, y: 0 })
  const [connectFlash, setConnectFlash] = useState(false)
  const [leavingIds, setLeavingIds] = useState<string[]>([])
  const prevRemoteRef = useRef<string[]>([])

  useEffect(() => {
    if (call.status === 'idle') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [call.status])

  useEffect(() => {
    const syncFs = () => {
      setIsFs(Boolean(document.fullscreenElement) || Boolean(getDesktopApi() && document.body.classList.contains('nexo-win-fs')))
    }
    const onFs = () => syncFs()
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (peer?.id) setVolPeer(peer.id)
  }, [peer?.id])

  useEffect(() => {
    if (!showMedia) return
    const updatePos = () => {
      const btn = mediaBtnRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setMediaPopPos({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 10,
      })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [showMedia])

  useEffect(() => {
    if (!showMedia) return
    const onPointer = (e: Event) => {
      const target = e.target as Node
      if (mediaPopRef.current?.contains(target)) return
      if (mediaBtnRef.current?.contains(target)) return
      setShowMedia(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [showMedia])



  useEffect(() => {
    if (prevStatus.current !== 'active' && call.status === 'active' && !call.channelId) {
      setConnectFlash(true)
      const t = window.setTimeout(() => setConnectFlash(false), 1400)
      prevStatus.current = call.status
      return () => window.clearTimeout(t)
    }
    prevStatus.current = call.status
  }, [call.status, call.channelId])

  const remotePeers = useMemo(() => {
    const connected = call.peerIds.filter((id) => callManager.hasPeer(id))
    if (connected.length) return connected
    if (call.alone) return []
    if (
      call.peerId &&
      (call.status === 'outgoing' || call.status === 'connecting')
    ) {
      return [call.peerId]
    }
    return []
  }, [call.peerIds, call.alone, call.peerId, call.status, tick])

  useEffect(() => {
    const prev = prevRemoteRef.current
    const next = remotePeers
    const left = prev.filter((id) => !next.includes(id))

    if (left.length) {
      setLeavingIds((cur) => [...new Set([...cur, ...left])])
      window.setTimeout(() => {
        setLeavingIds((cur) => cur.filter((id) => !left.includes(id)))
      }, 420)
    }

    prevRemoteRef.current = next
  }, [remotePeers])

  const displayRemotePeers = useMemo(
    () => [...new Set([...remotePeers, ...leavingIds])],
    [remotePeers, leavingIds],
  )
  const remote = peer ? callManager.getRemoteStream(peer.id) : null
  const localCam = call.cameraOn ? callManager.localCamera : null
  const localScreen = call.screenOn ? callManager.localScreen : null
  const presenting = call.screenOn || call.remoteScreen
  const showVideo = Boolean(
    mainStreamActive(call, remote, localCam) && (call.remoteCamera || call.cameraOn),
  )

  const mainStream = call.remoteScreen
    ? remote
    : call.screenOn
      ? localScreen
      : call.remoteCamera
        ? remote
        : localCam

  const presenter = call.remoteScreen ? peer : call.screenOn ? me : null
  const voiceDmLayout = !presenting && !showVideo

  useEffect(() => {
    if (presenting) setHideSide(true)
    else {
      setHideSide(false)
      onPresentExpandedChange?.(false)
    }
  }, [presenting, onPresentExpandedChange])
  const qualities: VideoQuality[] = ['360p', '480p', '720p', '1080p']
  const fpsOptions: VideoFps[] = [12, 15, 24, 30, 60]

  const peerLive = (id: string) => {
    const stream = callManager.getRemoteStream(id)
    return Boolean(stream?.getAudioTracks().some((t) => t.readyState === 'live'))
  }

  const privateCallPending =
    !call.channelId && (call.status === 'outgoing' || call.status === 'connecting')

  const speakSources = useMemo(
    () => [
      ...(me
        ? [
            {
              id: me.id,
              stream: callManager.localAudio,
              muted: call.muted || call.deafened,
            },
          ]
        : []),
      ...remotePeers.map((id) => ({
        id,
        stream: callManager.getRemoteStream(id),
        muted: Boolean(call.peerMuted[id] || call.peerDeafened[id]),
      })),
    ],
    [me, remotePeers, call.muted, call.deafened, call.peerMuted, call.peerDeafened, tick],
  )
  const speaking = useSpeaking(speakSources, tick)

  const toggleFullscreen = async () => {
    const api = getDesktopApi()
    const el = presentMainRef.current || rootRef.current
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        document.body.classList.remove('nexo-win-fs')
        await api?.setFullscreen?.(false)
        setIsFs(false)
        return
      }
      onPresentExpandedChange?.(true)
      if (el?.requestFullscreen) {
        await el.requestFullscreen()
        setIsFs(true)
        return
      }
    } catch {
      /* fallback Electron */
    }
    try {
      document.body.classList.add('nexo-win-fs')
      await api?.setFullscreen?.(true)
      setIsFs(true)
    } catch {
      /* */
    }
  }

  const togglePresentExpanded = () => {
    onPresentExpandedChange?.(!presentExpanded)
  }

  const findPeerUser = (id: string) =>
    users.find((u) => u.id === id) || (peer?.id === id ? peer : null) || (me?.id === id ? me : null)

  const openUserMenu = (user: User, e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onCallMenuOpen?.()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuAnchor({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    setMenuUser(user)
  }

  return (
    <div
      ref={rootRef}
      className={[
        'call-stage',
        voiceDmLayout ? 'voice-dm' : '',
        presenting ? 'presenting' : '',
        presenting && presentExpanded ? 'present-expanded' : '',
        isFs ? 'is-fs' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!voiceDmLayout ? (
        <div className="call-top">
          <span className="timer">{formatElapsed(call.startedAt)}</span>
          {presenter ? (
            <span className="presenting-pill">
              <Avatar
                name={presenter.name}
                color={presenter.color}
                avatar={presenter.avatar}
                size="sm"
              />
              <span>
                {presenter.id === me?.id ? 'Você' : presenter.name} (Apresentando)
              </span>
            </span>
          ) : (
            <span className="call-top-label">{peer?.name || 'Chamada'}</span>
          )}
          <div className="call-top-actions">
            {presenting ? (
              <>
                <button
                  type="button"
                  className={`call-icon-btn ${presentExpanded ? 'on' : ''}`}
                  title={presentExpanded ? 'Mostrar chat' : 'Ampliar transmissão'}
                  onClick={togglePresentExpanded}
                >
                  {presentExpanded ? <MessageSquare size={16} /> : <AppWindow size={16} />}
                </button>
                <button
                  type="button"
                  className="call-icon-btn"
                  title={hideSide ? 'Mostrar participantes' : 'Ocultar participantes'}
                  onClick={() => setHideSide((v) => !v)}
                >
                  {hideSide ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="call-icon-btn"
              title={isFs ? 'Sair da tela cheia' : 'Tela cheia'}
              onClick={() => void toggleFullscreen()}
            >
              {isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      ) : null}

      {presenting ? (
        <div className={`call-meet ${hideSide ? 'hide-side' : ''}`}>
          <div
            ref={presentMainRef}
            className={`call-main ${
              presenter && call.remoteScreen && callManager.isStreamMuted(presenter.id) ? 'stream-muted' : ''
            }`}
            onContextMenu={(e) => {
              if (!presenter || presenter.id === me?.id) return
              e.preventDefault()
              e.stopPropagation()
              setPresentMenuUser(presenter)
              setPresentMenuAnchor({ x: e.clientX, y: e.clientY })
            }}
          >
            {mainStream ? (
              <VideoEl
                stream={mainStream}
                muted={call.screenOn && !call.remoteScreen}
                className="present-video"
              />
            ) : (
              <div className="call-main-empty">Aguardando transmissão…</div>
            )}
            {presenter && presenter.id !== me?.id ? (
              <div className="present-hint">Botão direito: volume e mudo da transmissão</div>
            ) : null}
          </div>
          <aside className="call-side">
            {remotePeers.map((id) => {
              const u = findPeerUser(id)
              if (!u) return null
              const stream = callManager.getRemoteStream(id)
              return (
                <ParticipantTile
                  key={id}
                  user={u}
                  stream={call.remoteScreen && id === peer?.id ? null : stream}
                  presenting={call.remoteScreen && id === peer?.id}
                  muted={call.peerMuted[id]}
                  deafened={call.peerDeafened[id]}
                  speaking={speaking[id]}
                  hideVideo={callManager.isPeerVideoHidden(id)}
                  onAvatarClick={openUserMenu}
                />
              )
            })}
            {me ? (
              <ParticipantTile
                user={me}
                stream={localCam}
                label={`${me.name} (você)`}
                presenting={call.screenOn}
                mirror
                muted={call.muted}
                deafened={call.deafened}
                speaking={speaking[me.id]}
                onAvatarClick={openUserMenu}
              />
            ) : null}
          </aside>
        </div>
      ) : showVideo ? (
        <div className="stage">
          <VideoEl stream={call.remoteCamera ? remote : localCam} muted={!call.remoteCamera} />
          {call.remoteCamera && localCam ? (
            <div className="call-pip">
              <VideoEl stream={localCam} muted cover className="mirror" />
            </div>
          ) : null}
        </div>
      ) : (
        <div className={`call-voice-body ${remotePeers.length === 0 ? 'solo' : ''}`}>
          <div className={`call-participants ${remotePeers.length === 0 ? 'solo' : ''}`}>
            {displayRemotePeers.map((id) => {
              const u = findPeerUser(id)
              if (!u) return null
              const isLeaving = leavingIds.includes(id)
              const waiting = privateCallPending && !peerLive(id) && !isLeaving
              const aloneState = Boolean(call.alone && !peerLive(id) && !privateCallPending && !isLeaving)
              return (
                <CallParticipant
                  key={id}
                  user={u}
                  speaking={speaking[id]}
                  muted={call.peerMuted[id]}
                  deafened={call.peerDeafened[id]}
                  waiting={waiting}
                  alone={aloneState}
                  leaving={isLeaving}
                  connectedFlash={connectFlash && peerLive(id)}
                  onAvatarClick={openUserMenu}
                />
              )
            })}
            {me ? (
              <CallParticipant
                user={me}
                label={`${me.name} (você)`}
                speaking={speaking[me.id]}
                muted={call.muted}
                deafened={call.deafened}
                connectedFlash={connectFlash}
                onAvatarClick={openUserMenu}
              />
            ) : null}
          </div>
        </div>
      )}

      {showMedia
        ? createPortal(
            <div
              ref={mediaPopRef}
              className="call-media-pop call-media-pop-portal"
              style={{
                left: mediaPopPos.left,
                bottom: mediaPopPos.bottom,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <label>
                Qualidade da transmissão
                <select
                  value={mediaPrefs.videoQuality}
                  onChange={(e) => {
                    setMediaPrefs({ videoQuality: e.target.value as VideoQuality })
                  }}
                >
                  {qualities.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                FPS
                <select
                  value={mediaPrefs.fps}
                  onChange={(e) => {
                    setMediaPrefs({ fps: Number(e.target.value) as VideoFps })
                  }}
                >
                  {fpsOptions.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </label>
              {remotePeers.length ? (
                <label>
                  Volume de {findPeerUser(volPeer)?.name || 'usuário'}
                  <div className="call-vol-row">
                    {remotePeers.length > 1 ? (
                      <select value={volPeer} onChange={(e) => setVolPeer(e.target.value)}>
                        {remotePeers.map((id) => (
                          <option key={id} value={id}>
                            {findPeerUser(id)?.name || id.slice(0, 6)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <Volume2 size={14} />
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={Math.round(callManager.getPeerVolume(volPeer || remotePeers[0]!) * 100)}
                      onChange={(e) => {
                        const id = volPeer || remotePeers[0]
                        if (!id) return
                        callManager.setPeerVolume(id, Number(e.target.value) / 100)
                      }}
                    />
                  </div>
                </label>
              ) : null}
            </div>,
            document.body,
          )
        : null}


      <div className="call-controls">
        <button
          type="button"
          className={call.muted ? 'on' : ''}
          title={call.muted ? 'Ativar microfone' : 'Silenciar'}
          onClick={() => callManager.setMuted(!call.muted)}
        >
          {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          type="button"
          className={call.deafened ? 'on' : ''}
          title={call.deafened ? 'Ouvir' : 'Ensurdecer'}
          onClick={() => callManager.setDeafened(!call.deafened)}
        >
          {call.deafened ? <VolumeX size={18} /> : <Headphones size={18} />}
        </button>
        <button
          type="button"
          className={call.cameraOn ? 'on' : ''}
          title="Câmera"
          onClick={() => void callManager.toggleCamera()}
        >
          {call.cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          type="button"
          className={call.screenOn ? 'on present' : ''}
          title="Apresentar agora"
          onClick={() =>
            requestScreenShareToggle(call.screenOn, () => callManager.stopScreen())
          }
        >
          {call.screenOn ? <MonitorOff size={18} /> : <Monitor size={18} />}
        </button>
        <button
          ref={mediaBtnRef}
          type="button"
          className={showMedia ? 'on' : ''}
          title="Opções de mídia"
          onClick={(e) => {
            e.stopPropagation()

            setShowMedia((v) => !v)
          }}
        >
          <Settings2 size={18} />
        </button>
        <button type="button" className="end" title="Sair da chamada" onClick={() => callManager.disconnect()}>
          <PhoneOff size={18} />
        </button>
      </div>

      {menuUser ? (
        <CallUserMenu
          user={menuUser}
          anchor={menuAnchor}
          inDm={inDm}
          isSelf={menuUser.id === me?.id}
          onClose={() => setMenuUser(null)}
          onEditProfile={onEditSelfProfile}
          onViewProfile={onViewProfile}
        />
      ) : null}

      {presentMenuUser ? (
        <PresentStreamMenu
          user={presentMenuUser}
          anchor={presentMenuAnchor}
          onClose={() => setPresentMenuUser(null)}
        />
      ) : null}
    </div>
  )
}

function mainStreamActive(
  call: { remoteCamera: boolean; cameraOn: boolean },
  remote: MediaStream | null,
  localCam: MediaStream | null,
) {
  if (call.remoteCamera && remote?.getVideoTracks().some((t) => t.readyState === 'live')) return true
  if (call.cameraOn && localCam?.getVideoTracks().some((t) => t.readyState === 'live')) return true
  return false
}
