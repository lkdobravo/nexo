const cache = new Map<string, HTMLAudioElement>()

/** Nomes do pack discord-sounds-mod (prioridade) + fallbacks. */
const ALIASES: Record<string, string[]> = {
  message: ['notification.mp3', 'ping.mp3', 'message1.mp3', 'message1.wav'],
  ring_in: ['connect.mp3', 'call_ringing.mp3', 'call_ringing.wav'],
  ring_out: ['connect.mp3', 'call_calling.mp3', 'call_calling.wav'],
  hangup: ['disconnect.mp3', 'disconnect.wav'],
  join: ['connect.mp3', 'user_join.mp3', 'user_join.wav'],
  leave: ['disconnect.mp3', 'user_leave.mp3', 'user_leave.wav'],
  stream_start: ['stream_start.mp3', 'stream_started.mp3', 'stream_started.wav'],
  stream_end: ['stream_stop.mp3', 'stream_ended.mp3', 'stream_ended.wav'],
  mute: ['mute.mp3', 'mute.wav'],
  unmute: ['unmute.mp3', 'unmute.wav'],
  deafen: ['deafen.mp3', 'deafen.wav'],
  undeafen: ['unmute.mp3', 'undeafen.mp3', 'undeafen.wav'],
}

function prefsOk(kind: 'call' | 'message') {
  try {
    const raw = localStorage.getItem('nexo.uiPrefs')
    if (!raw) return true
    const p = JSON.parse(raw)
    if (kind === 'message' && p.messageSounds === false) return false
    if (kind === 'call' && p.callSounds === false) return false
  } catch {
    /* */
  }
  return true
}

function playFile(candidates: string[], volume = 0.55): boolean {
  for (const name of candidates) {
    const url = `/sounds/${name}`
    try {
      let audio = cache.get(url)
      if (!audio) {
        audio = new Audio(url)
        audio.preload = 'auto'
        cache.set(url, audio)
      }
      audio.pause()
      audio.currentTime = 0
      audio.volume = volume
      void audio.play().catch(() => {
        /* arquivo ausente / autoplay */
      })
      return true
    } catch {
      /* tenta próximo */
    }
  }
  return false
}

let audioCtx: AudioContext | null = null
let ringTimer: number | null = null
let ringGen = 0
/** Instância exclusiva do toque — não compartilha cache com join/connect. */
let ringAudio: HTMLAudioElement | null = null
const ringOscillators: OscillatorNode[] = []

function ctx() {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function tone(freq: number, start: number, dur: number, gain = 0.05, trackRing = false) {
  const ac = ctx()
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
  if (trackRing) {
    ringOscillators.push(osc)
    osc.onended = () => {
      const i = ringOscillators.indexOf(osc)
      if (i >= 0) ringOscillators.splice(i, 1)
    }
  }
}

function stopRingOscillators() {
  for (const osc of ringOscillators.splice(0)) {
    try {
      osc.stop(0)
      osc.disconnect()
    } catch {
      /* já parado */
    }
  }
}

function playRingFile(candidates: string[], volume: number, gen: number): boolean {
  for (const name of candidates) {
    const url = `/sounds/${name}`
    try {
      if (!ringAudio || ringAudio.dataset.url !== url) {
        if (ringAudio) {
          try {
            ringAudio.pause()
          } catch {
            /* */
          }
        }
        ringAudio = new Audio(url)
        ringAudio.preload = 'auto'
        ringAudio.dataset.url = url
      }
      const audio = ringAudio
      audio.pause()
      audio.currentTime = 0
      audio.volume = volume
      void audio
        .play()
        .then(() => {
          if (gen !== ringGen) {
            audio.pause()
            audio.currentTime = 0
          }
        })
        .catch(() => {
          /* ausente / autoplay */
        })
      return true
    } catch {
      /* próximo */
    }
  }
  return false
}

export function startRingtone(outgoing: boolean) {
  if (!prefsOk('call')) return
  stopRingtone()
  const gen = ringGen
  const loop = () => {
    if (gen !== ringGen) return
    if (playRingFile(ALIASES[outgoing ? 'ring_out' : 'ring_in'], outgoing ? 0.55 : 0.6, gen)) return
    if (gen !== ringGen) return
    const ac = ctx()
    const t = ac.currentTime
    if (outgoing) {
      tone(440, t, 0.16, 0.045, true)
      tone(440, t + 0.26, 0.16, 0.045, true)
    } else {
      tone(523, t, 0.2, 0.08, true)
      tone(659, t + 0.18, 0.22, 0.085, true)
    }
  }
  loop()
  ringTimer = window.setInterval(loop, outgoing ? 3200 : 4500)
}

export function stopRingtone() {
  ringGen += 1
  if (ringTimer != null) {
    window.clearInterval(ringTimer)
    ringTimer = null
  }
  stopRingOscillators()
  if (ringAudio) {
    try {
      ringAudio.pause()
      ringAudio.currentTime = 0
    } catch {
      /* */
    }
  }
}

export function playHangup() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.hangup, 0.5)) return
  const ac = ctx()
  tone(380, ac.currentTime, 0.12, 0.04)
  tone(240, ac.currentTime + 0.1, 0.18, 0.04)
}

export function playMessagePop() {
  if (!prefsOk('message')) return
  if (playFile(ALIASES.message, 0.45)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(880, t, 0.07, 0.045)
  tone(1175, t + 0.07, 0.09, 0.04)
}

export function playScreenShare() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.stream_start, 0.5)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(523.25, t, 0.11, 0.055)
  tone(659.25, t + 0.09, 0.12, 0.06)
}

export function playScreenShareEnd() {
  if (!prefsOk('call')) return
  playFile(ALIASES.stream_end, 0.5)
}

export function playCallConnected() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.join, 0.55)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(392, t, 0.1, 0.05)
  tone(523.25, t + 0.08, 0.12, 0.06)
}

export function playCallPeerJoin() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.join, 0.4)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(440, t, 0.09, 0.05)
  tone(554.37, t + 0.07, 0.11, 0.055)
}

export function playCallPeerLeave() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.leave, 0.45)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(523.25, t, 0.09, 0.04)
  tone(392, t + 0.09, 0.12, 0.035)
}

export function playCallLeave() {
  if (!prefsOk('call')) return
  if (playFile(ALIASES.hangup, 0.5)) return
  const ac = ctx()
  const t = ac.currentTime
  tone(349.23, t, 0.1, 0.038)
  tone(261.63, t + 0.09, 0.15, 0.032)
}

export function playMuteSound(muted: boolean) {
  if (!prefsOk('call')) return
  playFile(ALIASES[muted ? 'mute' : 'unmute'], 0.5)
}

export function playDeafenSound(deafened: boolean) {
  if (!prefsOk('call')) return
  playFile(ALIASES[deafened ? 'deafen' : 'undeafen'], 0.5)
}
