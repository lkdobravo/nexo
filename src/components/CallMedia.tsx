import { useEffect, useRef } from 'react'
import { callManager } from '../lib/webrtc'
import { useAppStore } from '../store'

export function AudioEl({
  stream,
  sinkId,
  volume,
}: {
  stream: MediaStream | null
  sinkId?: string
  volume?: number
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    const el = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (el?.setSinkId && sinkId) void el.setSinkId(sinkId)
  }, [sinkId, stream])

  useEffect(() => {
    const v = Math.max(0, volume ?? 1)
    if (ref.current) {
      ref.current.volume = Math.min(1, v)
      ref.current.muted = v === 0
    }
    if (v <= 1) {
      if (ctxRef.current) {
        void ctxRef.current.close()
        ctxRef.current = null
      }
      return
    }
    if (!stream) return
    let cancelled = false
    void (async () => {
      const ac = new AudioContext()
      ctxRef.current = ac
      const src = ac.createMediaStreamSource(stream)
      const gain = ac.createGain()
      gain.gain.value = v
      src.connect(gain)
      gain.connect(ac.destination)
      if (cancelled) void ac.close()
    })()
    return () => {
      cancelled = true
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [volume, stream])

  if (!stream) return null
  return <audio ref={ref} autoPlay />
}

/** Mantém o áudio remoto ativo independente da view (Amigos, servidor, etc.). */
export function CallAudioSink() {
  const call = useAppStore((s) => s.call)
  const devices = useAppStore((s) => s.devices)
  useAppStore((s) => s.call.mediaTick)

  if (call.status === 'idle') return null

  const remotePeers = call.peerIds.length
    ? call.peerIds
    : call.peerId
      ? [call.peerId]
      : []

  return (
    <div className="call-audio-sink" aria-hidden>
      {remotePeers.map((id) => {
        const split = callManager.splitPeerAudio(id)
        const streamMuted = callManager.isStreamMuted(id)
        const streamVol = streamMuted ? 0 : callManager.getStreamVolume(id)
        // Se só há uma faixa de áudio, volume do usuário cobre tudo;
        // volume da transmissão aplica quando há áudio de tela (faixas extras).
        const voiceStream = split.voice || (!split.screen ? callManager.getRemoteStream(id) : null)
        return (
          <span key={id}>
            <AudioEl stream={voiceStream} sinkId={devices.speakerId} volume={callManager.getPeerVolume(id)} />
            {split.screen ? (
              <AudioEl stream={split.screen} sinkId={devices.speakerId} volume={streamVol} />
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
