import { useEffect, useState } from 'react'
import { VoiceMonitor } from '../lib/voiceActivity'

export type SpeakSource = { id: string; stream: MediaStream | null; muted: boolean }

export function useSpeaking(sources: SpeakSource[], revision = 0) {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const key = sources.map((s) => `${s.id}:${s.muted}:${s.stream?.id ?? 'none'}`).join('|')

  useEffect(() => {
    const monitors: VoiceMonitor[] = []

    for (const { id, stream, muted } of sources) {
      if (muted || !stream) {
        setSpeaking((s) => (s[id] ? { ...s, [id]: false } : s))
        continue
      }
      const tracks = stream
        .getAudioTracks()
        .filter((t) => t.readyState === 'live')
        .map((t) => t.clone())
      if (!tracks.length) continue
      const audioStream = new MediaStream(tracks)
      monitors.push(
        new VoiceMonitor(audioStream, (active: boolean) => {
          setSpeaking((s) => ({ ...s, [id]: active }))
        }),
      )
    }

    return () => {
      monitors.forEach((m) => m.stop())
    }
  }, [key, revision])

  return speaking
}
