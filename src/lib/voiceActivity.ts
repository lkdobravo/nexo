/** Monitora nível de áudio de um MediaStream para indicar “falando”. */
export class VoiceMonitor {
  private ctx: AudioContext
  private analyser: AnalyserNode
  private source: MediaStreamAudioSourceNode
  private raf = 0
  private active = false
  private buf: Uint8Array
  private offSince = 0
  private onChange: (speaking: boolean) => void
  private threshold: number
  private holdMs: number

  constructor(
    stream: MediaStream,
    onChange: (speaking: boolean) => void,
    threshold = 18,
    holdMs = 180,
  ) {
    this.onChange = onChange
    this.threshold = threshold
    this.holdMs = holdMs
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.65
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.buf = new Uint8Array(this.analyser.frequencyBinCount)
    void this.ctx.resume()
    this.tick()
  }

  private tick = () => {
    this.analyser.getByteFrequencyData(this.buf as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i]!
    const level = sum / this.buf.length
    const now = performance.now()

    if (level >= this.threshold) {
      this.offSince = 0
      if (!this.active) {
        this.active = true
        this.onChange(true)
      }
    } else if (this.active) {
      if (!this.offSince) this.offSince = now
      if (now - this.offSince >= this.holdMs) {
        this.active = false
        this.offSince = 0
        this.onChange(false)
      }
    }

    this.raf = requestAnimationFrame(this.tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    try {
      this.source.disconnect()
      this.analyser.disconnect()
    } catch {
      /* */
    }
    void this.ctx.close()
  }
}
