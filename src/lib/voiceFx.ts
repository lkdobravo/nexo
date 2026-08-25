import type { VoiceMod } from '../types'

export type { VoiceMod }

export const VOICE_MODS: { id: VoiceMod; label: string; hint: string }[] = [
  { id: 'off', label: 'Normal', hint: 'Sua voz' },
  { id: 'woman', label: 'Mulher', hint: 'Tom agudo' },
  { id: 'baby', label: 'Bebê', hint: 'Voz infantil' },
  { id: 'robot', label: 'Robô', hint: 'Metálica' },
  { id: 'squirrel', label: 'Esquilo', hint: 'Super aguda' },
  { id: 'demon', label: 'Demônio', hint: 'Muito grave' },
]

type GraphHandle = {
  output: MediaStream
  disconnect: () => void
}

function makeDistortion(ctx: AudioContext, amount: number) {
  const shaper = ctx.createWaveShaper()
  const n = 44100
  const curve = new Float32Array(n)
  const k = amount
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  shaper.curve = curve
  shaper.oversample = '2x'
  return shaper
}

function makeFilter(ctx: AudioContext, type: BiquadFilterType, freq: number, gain = 0, q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.gain.value = gain
  f.Q.value = q
  return f
}

/** Efeitos contínuos (sem crossfade) para não cortar o áudio enviado ou recebido. */
export function buildVoiceGraph(ctx: AudioContext, mic: MediaStream, mod: VoiceMod): GraphHandle | null {
  if (mod === 'off') return null

  const source = ctx.createMediaStreamSource(mic)
  const dest = ctx.createMediaStreamDestination()
  const input = ctx.createGain()
  input.gain.value = 1
  source.connect(input)

  const stops: Array<() => void> = []
  let tail: AudioNode = input

  const link = (node: AudioNode) => {
    tail.connect(node)
    tail = node
  }

  const out = ctx.createGain()
  out.gain.value = 1

  if (mod === 'woman') {
    link(makeFilter(ctx, 'highpass', 120, 0, 0.8))
    link(makeFilter(ctx, 'peaking', 650, 5, 1.2))
    link(makeFilter(ctx, 'peaking', 2800, 6, 0.9))
    link(makeFilter(ctx, 'highshelf', 4500, 5))
    out.gain.value = 1.08
  } else if (mod === 'baby') {
    link(makeFilter(ctx, 'highpass', 350, 0, 0.9))
    link(makeFilter(ctx, 'peaking', 900, 7, 1.4))
    link(makeFilter(ctx, 'peaking', 3200, 8, 1.1))
    link(makeFilter(ctx, 'highshelf', 5200, 9))
    out.gain.value = 1.12
  } else if (mod === 'squirrel') {
    link(makeFilter(ctx, 'highpass', 520, 0, 1.1))
    link(makeFilter(ctx, 'peaking', 1400, 9, 1.6))
    link(makeFilter(ctx, 'peaking', 4200, 10, 1.2))
    link(makeFilter(ctx, 'highshelf', 6800, 11))
    out.gain.value = 1.18
  } else if (mod === 'demon') {
    link(makeFilter(ctx, 'lowshelf', 120, 10))
    link(makeFilter(ctx, 'peaking', 220, 8, 0.8))
    link(makeFilter(ctx, 'lowpass', 850, 0, 0.7))
    link(makeDistortion(ctx, 14))
    const delay = ctx.createDelay(0.15)
    delay.delayTime.value = 0.038
    const wet = ctx.createGain()
    wet.gain.value = 0.22
    tail.connect(delay)
    delay.connect(wet)
    wet.connect(out)
    out.gain.value = 1.15
  } else if (mod === 'robot') {
    link(makeFilter(ctx, 'bandpass', 1100, 0, 1.5))
    const ring = ctx.createGain()
    ring.gain.value = 1
    tail.connect(ring)
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 55
    const depth = ctx.createGain()
    depth.gain.value = 0.65
    osc.connect(depth)
    depth.connect(ring.gain)
    osc.start()
    stops.push(() => {
      try {
        osc.stop()
      } catch {
        /* */
      }
    })
    tail = ring
    link(makeDistortion(ctx, 5))
    link(makeFilter(ctx, 'highpass', 200))
    out.gain.value = 1.2
  }

  tail.connect(out)
  out.connect(dest)

  return {
    output: dest.stream,
    disconnect() {
      try {
        source.disconnect()
        input.disconnect()
        out.disconnect()
      } catch {
        /* */
      }
      for (const stop of stops) stop()
    },
  }
}
