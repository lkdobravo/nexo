import { socket } from './socket'
import {
  playCallConnected,
  playCallLeave,
  playCallPeerJoin,
  playCallPeerLeave,
  playDeafenSound,
  playHangup,
  playMuteSound,
  playScreenShare,
  playScreenShareEnd,
  startRingtone,
  stopRingtone,
} from './sounds'
import type { CallKind, CallState, Devices, MediaPrefs, User } from '../types'
import { VIDEO_PRESETS } from '../types'
import { getDesktopApi } from './apiOrigin'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

type SignalPayload =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }

type StoreApi = {
  getState: () => {
    me: User | null
    users: User[]
    call: CallState
    devices: Devices
    mediaPrefs: MediaPrefs
    logCall: (info: {
      peerId: string
      durationMs: number
      missed: boolean
      media: 'audio' | 'video' | 'screen'
    }) => void
  }
  setState: (
    updater:
      | Partial<{ call: CallState; users: User[] }>
      | ((s: { call: CallState; users: User[] }) => Partial<{ call: CallState; users: User[] }>),
  ) => void
}

function videoConstraints() {
  const { devices, mediaPrefs } = store.getState()
  const preset = VIDEO_PRESETS[mediaPrefs.videoQuality] || VIDEO_PRESETS['480p']
  return {
    deviceId: devices.camId ? { exact: devices.camId } : undefined,
    width: { ideal: preset.width, max: preset.width },
    height: { ideal: preset.height, max: preset.height },
    frameRate: { ideal: mediaPrefs.fps, max: mediaPrefs.fps },
    facingMode: 'user' as const,
  }
}

function screenConstraints() {
  const { mediaPrefs } = store.getState()
  // Sem limitar width/height — evita o "zoom"/recorte da área compartilhada.
  return {
    frameRate: { ideal: mediaPrefs.fps, max: mediaPrefs.fps },
  }
}

const SCREEN_SCALE: Record<MediaPrefs['videoQuality'], number> = {
  '360p': 3,
  '480p': 2,
  '720p': 1.5,
  '1080p': 1,
}

async function applySenderBitrate(
  sender: RTCRtpSender | null | undefined,
  opts?: { isScreen?: boolean },
) {
  if (!sender) return
  const { mediaPrefs } = store.getState()
  const preset = VIDEO_PRESETS[mediaPrefs.videoQuality] || VIDEO_PRESETS['480p']
  const params = sender.getParameters()
  if (!params.encodings?.length) params.encodings = [{}]
  for (const enc of params.encodings) {
    enc.maxBitrate = preset.maxBitrate
    enc.maxFramerate = mediaPrefs.fps
    if (opts?.isScreen) {
      enc.scaleResolutionDownBy = SCREEN_SCALE[mediaPrefs.videoQuality] ?? 1
    } else {
      delete enc.scaleResolutionDownBy
    }
  }
  try {
    await sender.setParameters(params)
  } catch {
    for (const enc of params.encodings) {
      delete enc.scaleResolutionDownBy
    }
    try {
      await sender.setParameters(params)
    } catch {
      /* ignore */
    }
  }
}

let store: StoreApi

export function bindCallStore(api: StoreApi) {
  store = api
}

class PeerLink {
  pc: RTCPeerConnection
  remoteStream = new MediaStream()
  makingOffer = false
  ignoreOffer = false
  polite: boolean
  pendingIce: RTCIceCandidateInit[] = []
  extraSenders: RTCRtpSender[] = []
  peerId: string

  constructor(
    peerId: string,
    selfId: string,
    localAudio: MediaStream,
    onRemote: () => void,
    onState: (state: RTCPeerConnectionState) => void,
  ) {
    this.peerId = peerId
    this.polite = selfId < peerId
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 8,
    })

    for (const track of localAudio.getAudioTracks()) {
      this.pc.addTrack(track, localAudio)
    }
    this.pc.addTransceiver('video', { direction: 'sendrecv' })

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      socket.emit('call:signal', {
        to: peerId,
        data: { type: 'ice', candidate: ev.candidate.toJSON() } satisfies SignalPayload,
      })
    }

    this.pc.ontrack = (ev) => {
      const track = ev.track
      if (!this.remoteStream.getTracks().some((t) => t.id === track.id)) {
        this.remoteStream.addTrack(track)
      }
      track.addEventListener('ended', () => {
        this.remoteStream.removeTrack(track)
        onRemote()
      })
      track.addEventListener('mute', () => onRemote())
      track.addEventListener('unmute', () => onRemote())
      onRemote()
    }

    this.pc.onconnectionstatechange = () => onState(this.pc.connectionState)
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.pc.restartIce()
    }

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        if (this.pc.localDescription) {
          socket.emit('call:signal', {
            to: peerId,
            data: { type: 'offer', sdp: this.pc.localDescription } satisfies SignalPayload,
          })
        }
      } catch (err) {
        console.error('[nexo] negotiation', err)
      } finally {
        this.makingOffer = false
      }
    }
  }

  videoSender() {
    return this.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender
  }

  async setVideoTrack(track: MediaStreamTrack | null, opts?: { isScreen?: boolean }) {
    const sender = this.videoSender()
    if (sender) {
      await sender.replaceTrack(track)
      if (track) await applySenderBitrate(sender, { isScreen: opts?.isScreen })
    } else if (track) {
      const s = this.pc.addTrack(track)
      await applySenderBitrate(s, { isScreen: opts?.isScreen })
    }
  }

  async addScreenAudio(track: MediaStreamTrack, stream: MediaStream) {
    if (this.extraSenders.some((s) => s.track?.id === track.id)) return
    this.extraSenders.push(this.pc.addTrack(track, stream))
  }

  async clearExtra() {
    for (const sender of this.extraSenders) this.pc.removeTrack(sender)
    this.extraSenders = []
  }

  async handle(data: SignalPayload) {
    if (data.type === 'offer') {
      const collision = this.makingOffer || this.pc.signalingState !== 'stable'
      this.ignoreOffer = !this.polite && collision
      if (this.ignoreOffer) return
      await this.pc.setRemoteDescription(data.sdp)
      await this.flushIce()
      await this.pc.setLocalDescription()
      if (this.pc.localDescription) {
        socket.emit('call:signal', {
          to: this.peerId,
          data: { type: 'answer', sdp: this.pc.localDescription } satisfies SignalPayload,
        })
      }
      return
    }
    if (data.type === 'answer') {
      await this.pc.setRemoteDescription(data.sdp)
      await this.flushIce()
      return
    }
    try {
      await this.pc.addIceCandidate(data.candidate)
    } catch {
      this.pendingIce.push(data.candidate)
    }
  }

  async flushIce() {
    if (!this.pc.remoteDescription) return
    for (const c of this.pendingIce.splice(0)) {
      try {
        await this.pc.addIceCandidate(c)
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    this.pc.onconnectionstatechange = null
    this.pc.onnegotiationneeded = null
    this.pc.close()
  }
}

export class CallManager {
  selfId = ''
  localAudio: MediaStream | null = null
  rawMic: MediaStream | null = null
  localCamera: MediaStream | null = null
  localScreen: MediaStream | null = null
  peers = new Map<string, PeerLink>()
  ringTimer: number | null = null
  pendingSignals = new Map<string, SignalPayload[]>()
  attached = false
  private connectedSoundPlayed = false
  private voiceCtx: AudioContext | null = null
  private voiceGraph: { output: MediaStream; disconnect: () => void } | null = null
  private powerSave: {
    active: boolean
    cameraOn: boolean
    screenOn: boolean
  } | null = null

  getRemoteStream(peerId: string) {
    return this.peers.get(peerId)?.remoteStream ?? null
  }

  hasPeer(peerId: string) {
    return this.peers.has(peerId)
  }

  attach() {
    if (this.attached) return
    this.attached = true

    socket.on(
      'call:invite',
      ({ from, kind, fromUser }: { from: string; kind: CallKind; fromUser?: User }) => {
        if (fromUser) {
          store.setState((s) => ({
            users: s.users.some((u) => u.id === fromUser.id)
              ? s.users.map((u) => (u.id === fromUser.id ? { ...u, ...fromUser } : u))
              : [...s.users, fromUser],
          }))
        }
        const { call } = store.getState()
        // Reentrada na mesma sala aberta
        if (call.status === 'active' && call.alone && call.peerId === from) {
          stopRingtone()
          this.clearTimeout()
          store.setState((s) => ({
            call: {
              ...s.call,
              alone: false,
              leftCall: false,
              kind: kind === 'video' ? 'video' : 'audio',
            },
          }))
          socket.emit('call:accept', { to: from })
          void this.connectPeer(from)
          return
        }
        if (call.status !== 'idle') {
          socket.emit('call:reject', { to: from })
          return
        }
        startRingtone(false)
        this.armTimeout()
        store.setState((s) => ({
          call: {
            ...s.call,
            status: 'incoming',
            incomingFrom: from,
            incomingKind: kind === 'video' ? 'video' : 'audio',
            kind: kind === 'video' ? 'video' : 'audio',
          },
        }))
      },
    )

    socket.on('call:accept', ({ from }: { from: string }) => {
      const { call } = store.getState()
      if (call.peerId !== from && call.incomingFrom !== from) return
      if (call.status !== 'outgoing' && call.status !== 'connecting') return
      stopRingtone()
      this.clearTimeout()
      if (!this.peers.has(from)) void this.connectPeer(from)
    })

    socket.on('call:reject', ({ from }: { from: string }) => {
      const { call, me } = store.getState()
      if (call.peerId !== from && call.incomingFrom !== from) return
      this.finish('rejected', from, me?.id)
    })

    socket.on('call:hangup', ({ from }: { from: string }) => {
      const { call, me } = store.getState()
      if (call.peerId !== from && call.incomingFrom !== from && !call.peerIds.includes(from)) return
      if (call.channelId) {
        this.dropPeer(from)
        return
      }
      if (call.status === 'incoming' || call.status === 'outgoing' || call.status === 'connecting') {
        this.finish('hangup', from, me?.id)
        return
      }
      if (call.leftCall) {
        this.finish('hangup', from, me?.id)
        return
      }
      this.peerLeft(from)
    })

    socket.on('call:peer-left', ({ userId }: { userId: string }) => {
      const { call } = store.getState()
      if (call.peerId === userId || call.incomingFrom === userId || call.peerIds.includes(userId)) {
        if (call.channelId) {
          this.dropPeer(userId)
          return
        }
        this.peerLeft(userId)
      }
    })

    socket.on('call:signal', ({ from, data }: { from: string; data: SignalPayload }) => {
      const link = this.peers.get(from)
      if (link) {
        void link.handle(data)
        return
      }
      const queued = this.pendingSignals.get(from) || []
      queued.push(data)
      this.pendingSignals.set(from, queued)
    })

    socket.on(
      'call:media',
      ({
        from,
        screen,
        camera,
        muted,
        deafened,
      }: {
        from: string
        screen: boolean
        camera: boolean
        muted?: boolean
        deafened?: boolean
      }) => {
        const { call } = store.getState()
        if (call.peerId !== from && !call.peerIds.includes(from)) return
        const startedPresenting = screen && !call.remoteScreen
        store.setState((s) => ({
          call: {
            ...s.call,
            remoteScreen: screen,
            remoteCamera: camera,
            peerMuted: {
              ...s.call.peerMuted,
              [from]: Boolean(muted),
            },
            peerDeafened: {
              ...s.call.peerDeafened,
              [from]: Boolean(deafened),
            },
            mediaTick: s.call.mediaTick + 1,
          },
        }))
        if (startedPresenting) playScreenShare()
      },
    )
  }

  peerLeft(peerId: string) {
    this.dropPeer(peerId)
    playCallPeerLeave()
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'active',
        alone: true,
        leftCall: false,
        peerId: s.call.peerId || peerId,
        remoteScreen: false,
        remoteCamera: false,
        incomingFrom: null,
        mediaTick: s.call.mediaTick + 1,
      },
    }))
  }

  dropPeer(peerId: string) {
    const link = this.peers.get(peerId)
    if (link) {
      link.close()
      this.peers.delete(peerId)
    }
    this.pendingSignals.delete(peerId)
    store.setState((s) => {
      const peerMuted = { ...s.call.peerMuted }
      const peerDeafened = { ...s.call.peerDeafened }
      delete peerMuted[peerId]
      delete peerDeafened[peerId]
      const peerIds = s.call.peerIds.filter((id) => id !== peerId)
      return {
        call: {
          ...s.call,
          peerIds,
          peerId: s.call.peerId === peerId ? peerIds[0] || null : s.call.peerId,
          peerMuted,
          peerDeafened,
          remoteScreen: s.call.peerId === peerId || !peerIds.length ? false : s.call.remoteScreen,
          remoteCamera: s.call.peerId === peerId || !peerIds.length ? false : s.call.remoteCamera,
          mediaTick: s.call.mediaTick + 1,
        },
      }
    })
  }

  bumpMedia() {
    store.setState((s) => ({ call: { ...s.call, mediaTick: s.call.mediaTick + 1 } }))
  }

  async ensureMic() {
    if (this.rawMic?.getAudioTracks().some((t) => t.readyState === 'live')) {
      if (!this.localAudio) this.localAudio = this.rawMic
      this.applyMute()
      return this.localAudio!
    }
    const { devices } = store.getState()
    this.rawMic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: devices.micId ? { exact: devices.micId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    this.localAudio = this.rawMic
    this.applyMute()
    return this.localAudio
  }

  private teardownVoice() {
    this.voiceGraph?.disconnect()
    this.voiceGraph = null
    if (this.voiceCtx) {
      void this.voiceCtx.close()
      this.voiceCtx = null
    }
  }

  /** Segundo plano: pausa vídeo/tela e mantém só a voz. */
  async enterPowerSave() {
    if (this.powerSave?.active) return
    const { call } = store.getState()
    if (call.status === 'idle') {
      document.body.classList.add('app-background')
      return
    }
    this.powerSave = {
      active: true,
      cameraOn: call.cameraOn,
      screenOn: call.screenOn,
    }
    document.body.classList.add('app-background')
    if (call.screenOn) this.stopScreen(true)
    if (call.cameraOn) this.stopCamera()
  }

  async exitPowerSave() {
    document.body.classList.remove('app-background')
    const saved = this.powerSave
    this.powerSave = null
    if (!saved?.active) return
    if (saved.cameraOn) await this.enableCamera()
  }

  applyMute() {
    const { call } = store.getState()
    const silent = call.muted || call.deafened
    this.rawMic?.getAudioTracks().forEach((t) => {
      t.enabled = !silent
    })
    this.localAudio?.getAudioTracks().forEach((t) => {
      t.enabled = !silent
    })
  }

  applyDeafen() {
    const deafened = store.getState().call.deafened
    for (const link of this.peers.values()) {
      link.remoteStream.getAudioTracks().forEach((t) => {
        t.enabled = !deafened
      })
    }
  }

  async connectPeer(peerId: string) {
    if (this.peers.has(peerId)) return
    const audio = await this.ensureMic()
    const link = new PeerLink(
      peerId,
      this.selfId,
      audio,
      () => this.bumpMedia(),
      (state) => {
        store.setState((s) => ({
          call: {
            ...s.call,
            connection: state,
            status:
              state === 'connected'
                ? 'active'
                : state === 'connecting' && s.call.status !== 'active'
                  ? 'connecting'
                  : s.call.status,
            startedAt: state === 'connected' && !s.call.startedAt ? Date.now() : s.call.startedAt,
            error: state === 'failed' ? 'Falha na conexão. Tente de novo.' : s.call.error,
          },
        }))
        if (state === 'connected') {
          const snap = store.getState().call
          const wasLeft = snap.leftCall
          if (!this.connectedSoundPlayed && !snap.channelId && !wasLeft && !snap.alone) {
            this.connectedSoundPlayed = true
            playCallConnected()
          } else if (!snap.channelId && (wasLeft || snap.alone)) {
            playCallPeerJoin()
          }
          store.setState((s) => ({
            call: { ...s.call, alone: false, leftCall: false, status: 'active' as const },
          }))
          void this.pushLocalVideo()
          this.publishMedia(peerId)
        }
      },
    )
    this.peers.set(peerId, link)
    store.setState((s) => ({
      call: {
        ...s.call,
        status:
          s.call.status === 'incoming' || s.call.status === 'outgoing'
            ? 'connecting'
            : s.call.status,
        peerId,
        leftCall: false,
        peerIds: [...new Set([...s.call.peerIds, peerId])],
      },
    }))
    await this.pushLocalVideo()
    const queued = this.pendingSignals.get(peerId) || []
    this.pendingSignals.delete(peerId)
    for (const data of queued) await link.handle(data)
  }

  async pushLocalVideo() {
    const screenTrack = this.localScreen?.getVideoTracks()[0]
    const track = screenTrack || this.localCamera?.getVideoTracks()[0] || null
    const isScreen = !!screenTrack
    for (const link of this.peers.values()) {
      await link.setVideoTrack(track, { isScreen })
      if (this.localScreen) {
        for (const audio of this.localScreen.getAudioTracks()) {
          await link.addScreenAudio(audio, this.localScreen)
        }
      }
    }
    this.bumpMedia()
  }

  publishMedia(to?: string) {
    const { call } = store.getState()
    const targets = to ? [to] : call.peerIds.length ? call.peerIds : call.peerId ? [call.peerId] : []
    for (const id of targets) {
      socket.emit('call:media', {
        to: id,
        screen: call.screenOn,
        camera: call.cameraOn,
        muted: call.muted,
        deafened: call.deafened,
      })
    }
  }

  armTimeout() {
    this.clearTimeout()
    this.ringTimer = window.setTimeout(() => {
      const { call, me } = store.getState()
      if (call.status === 'outgoing' || call.status === 'incoming') {
        this.finish('timeout', call.peerId || call.incomingFrom, me?.id)
      }
    }, 45000)
  }

  clearTimeout() {
    if (this.ringTimer != null) {
      window.clearTimeout(this.ringTimer)
      this.ringTimer = null
    }
  }

  async invite(peerId: string, kind: CallKind) {
    const { call } = store.getState()
    if (call.status === 'active' && call.alone && call.peerId === peerId) {
      await this.reinvite(peerId, kind)
      return
    }
    if (call.status !== 'idle') return
    this.selfId = store.getState().me?.id || this.selfId
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'outgoing',
        kind,
        peerId,
        incomingFrom: null,
        error: null,
        channelId: null,
        serverId: null,
      },
    }))
    startRingtone(true)
    this.armTimeout()
    try {
      await this.ensureMic()
      if (kind === 'video') await this.enableCamera()
    } catch {
      this.finish('mic', peerId, store.getState().me?.id)
      store.setState((s) => ({
        call: { ...s.call, error: 'Permissão de microfone recusada.' },
      }))
      return
    }
    socket.emit('call:invite', { to: peerId, kind })
  }

  async reinvite(peerId: string, kind: CallKind) {
    return this.rejoin(peerId, kind)
  }

  async rejoin(peerId: string, kind: CallKind) {
    this.selfId = store.getState().me?.id || this.selfId
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'outgoing',
        kind,
        peerId,
        alone: false,
        leftCall: false,
        incomingFrom: null,
        error: null,
      },
    }))
    startRingtone(true)
    this.armTimeout()
    try {
      await this.ensureMic()
      if (kind === 'video') await this.enableCamera()
    } catch {
      store.setState((s) => ({ call: { ...s.call, status: 'active', alone: true, leftCall: true } }))
      return
    }
    socket.emit('call:invite', { to: peerId, kind, rejoin: true })
    await this.connectPeer(peerId)
  }

  async accept() {
    const { call, me } = store.getState()
    const from = call.incomingFrom
    if (!from) return
    this.selfId = me?.id || this.selfId
    stopRingtone()
    this.clearTimeout()
    try {
      await this.ensureMic()
      if (call.kind === 'video') await this.enableCamera()
      socket.emit('call:accept', { to: from })
      await this.connectPeer(from)
    } catch {
      store.setState((s) => ({
        call: { ...s.call, error: 'Permissão de microfone recusada.' },
      }))
    }
  }

  reject() {
    stopRingtone()
    const { call, me } = store.getState()
    if (call.incomingFrom) socket.emit('call:reject', { to: call.incomingFrom })
    this.finish('rejected', call.incomingFrom, me?.id)
  }

  async enableCamera() {
    this.stopScreen(false)
    if (this.localCamera) {
      store.setState((s) => ({ call: { ...s.call, cameraOn: true, screenOn: false } }))
      await this.pushLocalVideo()
      this.publishMedia()
      return
    }
    this.localCamera = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(),
      audio: false,
    })
    this.localCamera.getVideoTracks()[0]?.addEventListener('ended', () => this.stopCamera())
    store.setState((s) => ({ call: { ...s.call, cameraOn: true, screenOn: false } }))
    await this.pushLocalVideo()
    this.publishMedia()
  }

  stopCamera() {
    this.localCamera?.getTracks().forEach((t) => t.stop())
    this.localCamera = null
    store.setState((s) => ({ call: { ...s.call, cameraOn: false } }))
    void this.pushLocalVideo()
    this.publishMedia()
  }

  async toggleCamera() {
    if (store.getState().call.cameraOn) this.stopCamera()
    else await this.enableCamera()
  }

  async shareScreen(
    opts?: { sourceId?: string; surface?: 'monitor' | 'window' },
  ): Promise<'ok' | 'cancelled' | 'error'> {
    this.stopCamera()
    try {
      const api = getDesktopApi()
      let screen: MediaStream

      if (opts?.sourceId && api?.prepareCapture) {
        // Caminho Electron: captura direta pela fonte escolhida (não a janela do Nexo)
        await api.prepareCapture(opts.sourceId)
        screen = await this.captureDesktopSource(opts.sourceId)
      } else if (opts?.sourceId) {
        screen = await this.captureDesktopSource(opts.sourceId)
      } else {
        const video: MediaTrackConstraints = {
          ...screenConstraints(),
        }
        if (opts?.surface) {
          ;(video as MediaTrackConstraints & { displaySurface?: string }).displaySurface = opts.surface
        }
        screen = await navigator.mediaDevices.getDisplayMedia({
          video,
          audio: true,
        })
      }

      this.localScreen?.getTracks().forEach((t) => t.stop())
      this.localScreen = screen
      screen.getVideoTracks()[0]?.addEventListener('ended', () => this.stopScreen())
      store.setState((s) => ({ call: { ...s.call, screenOn: true, cameraOn: false } }))
      await this.pushLocalVideo()
      this.publishMedia()
      playScreenShare()
      return 'ok'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return 'cancelled'
      console.error('[nexo] shareScreen failed', err)
      store.setState((s) => ({
        call: { ...s.call, error: 'Não foi possível compartilhar a tela.' },
      }))
      return 'error'
    }
  }

  /** Electron: captura tela/janela pelo id do desktopCapturer. */
  private async captureDesktopSource(sourceId: string): Promise<MediaStream> {
    const { mediaPrefs } = store.getState()
    const fps = mediaPrefs.fps

    // 1) API clássica do Chromium/Electron (mais confiável com sourceId)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: fps,
          },
        },
      } as unknown as MediaStreamConstraints)
      if (stream.getVideoTracks().length) return stream
    } catch {
      /* tenta getDisplayMedia abaixo */
    }

    // 2) Fallback: getDisplayMedia + prepareCapture no main
    const api = getDesktopApi()
    if (api?.prepareCapture) await api.prepareCapture(sourceId)
    return navigator.mediaDevices.getDisplayMedia({
      video: screenConstraints(),
      audio: false,
    })
  }

  stopScreen(publish = true) {
    const wasOn = store.getState().call.screenOn
    this.localScreen?.getTracks().forEach((t) => t.stop())
    this.localScreen = null
    for (const link of this.peers.values()) void link.clearExtra()
    store.setState((s) => ({ call: { ...s.call, screenOn: false } }))
    void this.pushLocalVideo()
    if (publish) this.publishMedia()
    if (wasOn) playScreenShareEnd()
  }

  setMuted(muted: boolean) {
    store.setState((s) => ({ call: { ...s.call, muted } }))
    this.applyMute()
    this.publishMedia()
    playMuteSound(muted)
  }

  setDeafened(deafened: boolean) {
    store.setState((s) => ({
      call: { ...s.call, deafened, muted: deafened ? true : s.call.muted },
    }))
    this.applyMute()
    this.applyDeafen()
    this.publishMedia()
    playDeafenSound(deafened)
  }

  private peerVolumes = new Map<string, number>()
  private peerStreamVolumes = new Map<string, number>()
  private peerStreamMuted = new Set<string>()
  private peerVideoHidden = new Set<string>()

  getPeerVolume(peerId: string) {
    return this.peerVolumes.get(peerId) ?? 1
  }

  setPeerVolume(peerId: string, volume: number) {
    const v = Math.min(2, Math.max(0, volume))
    this.peerVolumes.set(peerId, v)
    this.bumpMedia()
  }

  getStreamVolume(peerId: string) {
    return this.peerStreamVolumes.get(peerId) ?? 1
  }

  setStreamVolume(peerId: string, volume: number) {
    const v = Math.min(2, Math.max(0, volume))
    this.peerStreamVolumes.set(peerId, v)
    if (v > 0) this.peerStreamMuted.delete(peerId)
    this.bumpMedia()
  }

  isStreamMuted(peerId: string) {
    return this.peerStreamMuted.has(peerId)
  }

  setStreamMuted(peerId: string, muted: boolean) {
    if (muted) this.peerStreamMuted.add(peerId)
    else this.peerStreamMuted.delete(peerId)
    this.bumpMedia()
  }

  /** Áudio de voz (1ª faixa) vs áudio da transmissão (faixas extras). */
  splitPeerAudio(peerId: string): { voice: MediaStream | null; screen: MediaStream | null } {
    const stream = this.getRemoteStream(peerId)
    if (!stream) return { voice: null, screen: null }
    const audios = stream.getAudioTracks()
    if (!audios.length) return { voice: null, screen: null }
    const voice = new MediaStream([audios[0]!])
    const screen = audios.length > 1 ? new MediaStream(audios.slice(1)) : null
    return { voice, screen }
  }

  isPeerVideoHidden(peerId: string) {
    return this.peerVideoHidden.has(peerId)
  }

  setPeerVideoHidden(peerId: string, hidden: boolean) {
    if (hidden) this.peerVideoHidden.add(peerId)
    else this.peerVideoHidden.delete(peerId)
    this.bumpMedia()
  }

  async applyScreenPrefs() {
    const { mediaPrefs } = store.getState()
    const preset = VIDEO_PRESETS[mediaPrefs.videoQuality] || VIDEO_PRESETS['480p']
    const screenTrack = this.localScreen?.getVideoTracks()[0]
    const cameraTrack = this.localCamera?.getVideoTracks()[0]
    const activeTrack = screenTrack || cameraTrack

    if (screenTrack) {
      try {
        await screenTrack.applyConstraints({
          frameRate: { ideal: mediaPrefs.fps, max: mediaPrefs.fps },
        })
      } catch {
        /* display capture often rejects mid-stream constraint changes */
      }
    } else if (cameraTrack) {
      try {
        await cameraTrack.applyConstraints({
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: mediaPrefs.fps, max: mediaPrefs.fps },
        })
      } catch {
        /* ignore */
      }
    }

    await Promise.all(
      [...this.peers.values()].map(async (link) => {
        const senders = link.pc.getSenders()
        const sender = activeTrack
          ? senders.find((s) => s.track?.id === activeTrack.id)
          : senders.find((s) => s.track?.kind === 'video')
        await applySenderBitrate(sender, { isScreen: !!screenTrack })
      }),
    )
  }

  async joinChannel(channelId: string, memberIds: string[]) {
    if (store.getState().call.status !== 'idle' && store.getState().call.channelId !== channelId) {
      this.hangup()
      await new Promise((r) => setTimeout(r, 200))
    }
    this.selfId = store.getState().me?.id || this.selfId
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'connecting',
        channelId,
        kind: 'audio',
        peerId: memberIds.find((id) => id !== this.selfId) || null,
        incomingFrom: null,
        error: null,
      },
    }))
    try {
      await this.ensureMic()
    } catch {
      store.setState((s) => ({
        call: { ...s.call, status: 'idle', error: 'Permissão de microfone recusada.' },
      }))
      return
    }
    socket.emit('voice:join', { channelId })
    for (const id of memberIds) {
      if (id !== this.selfId) await this.connectPeer(id)
    }
    store.setState((s) => ({
      call: { ...s.call, status: 'active', startedAt: s.call.startedAt || Date.now() },
    }))
  }

  async onVoiceMembers(channelId: string, members: string[]) {
    const { call } = store.getState()
    if (call.channelId !== channelId) return
    for (const id of members) {
      if (id !== this.selfId && !this.peers.has(id)) await this.connectPeer(id)
    }
    for (const [id, link] of this.peers) {
      if (!members.includes(id)) {
        link.close()
        this.peers.delete(id)
      }
    }
    store.setState((s) => ({
      call: {
        ...s.call,
        peerIds: members.filter((id) => id !== this.selfId),
        peerId: members.find((id) => id !== this.selfId) || s.call.peerId,
        status: 'active',
      },
    }))
    this.bumpMedia()
  }

  disconnect() {
    const { call } = store.getState()
    if (call.channelId || call.status === 'incoming' || call.status === 'outgoing') {
      this.hangup()
      return
    }
    if (call.status === 'connecting') {
      this.hangup()
      return
    }
    if (call.status === 'active') {
      if (call.alone && this.peers.size === 0) {
        this.hangup()
        return
      }
      this.leaveCall()
    }
  }

  leaveCall() {
    const { call, me } = store.getState()
    if (call.status === 'idle' || call.channelId) return
    const targets = new Set(
      [...call.peerIds, call.peerId, call.incomingFrom].filter(Boolean) as string[],
    )
    for (const to of targets) socket.emit('call:hangup', { to })
    stopRingtone()
    this.clearTimeout()
    this.connectedSoundPlayed = false
    for (const link of this.peers.values()) link.close()
    this.peers.clear()
    this.teardownVoice()
    this.rawMic?.getTracks().forEach((t) => t.stop())
    this.rawMic = null
    this.localCamera?.getTracks().forEach((t) => t.stop())
    this.localScreen?.getTracks().forEach((t) => t.stop())
    this.localAudio = null
    this.localCamera = null
    this.localScreen = null
    this.pendingSignals.clear()
    const peerId = call.peerId || call.peerIds[0] || call.incomingFrom
    playCallLeave()
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'active',
        alone: true,
        leftCall: true,
        peerId,
        peerIds: [],
        incomingFrom: null,
        cameraOn: false,
        screenOn: false,
        remoteCamera: false,
        remoteScreen: false,
        muted: false,
        deafened: false,
        connection: 'new',
        mediaTick: s.call.mediaTick + 1,
      },
    }))
    void me
  }

  hangup() {
    const { call, me } = store.getState()
    const targets = new Set(
      [...call.peerIds, call.peerId, call.incomingFrom].filter(Boolean) as string[],
    )
    for (const to of targets) socket.emit('call:hangup', { to })
    if (call.channelId) socket.emit('voice:leave', { channelId: call.channelId })
    this.finish('hangup', call.peerId, me?.id)
  }

  finish(reason: string, peerId: string | null | undefined, meId: string | undefined) {
    stopRingtone()
    this.clearTimeout()
    this.connectedSoundPlayed = false
    if (reason !== 'mic') playHangup()
    const { call } = store.getState()
    const duration = call.startedAt ? Date.now() - call.startedAt : 0
    const other = peerId || call.peerId || call.incomingFrom
    if (other && meId && !call.channelId) {
      store.getState().logCall({
        peerId: other,
        durationMs: duration,
        missed: reason !== 'hangup' && call.status !== 'active',
        media: call.screenOn || call.remoteScreen ? 'screen' : call.kind,
      })
    }
    for (const link of this.peers.values()) link.close()
    this.peers.clear()
    this.teardownVoice()
    this.rawMic?.getTracks().forEach((t) => t.stop())
    this.rawMic = null
    this.localCamera?.getTracks().forEach((t) => t.stop())
    this.localScreen?.getTracks().forEach((t) => t.stop())
    this.localAudio = null
    this.localCamera = null
    this.localScreen = null
    this.pendingSignals.clear()
    store.setState((s) => ({
      call: {
        ...s.call,
        status: 'idle',
        peerId: null,
        incomingFrom: null,
        channelId: null,
        serverId: null,
        cameraOn: false,
        screenOn: false,
        remoteCamera: false,
        remoteScreen: false,
        startedAt: null,
        connection: 'new',
        peerIds: [],
        peerMuted: {},
        peerDeafened: {},
        alone: false,
        leftCall: false,
        voiceFx: 'off',
        noiseReduction: false,
        error: reason === 'failed' ? s.call.error : null,
      },
    }))
  }
}

export const callManager = new CallManager()
