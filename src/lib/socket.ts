import { io, type Socket } from 'socket.io-client'
import { resolveWsUrl } from './apiOrigin'

type Handler = (...args: unknown[]) => void

type ServerPush = { id?: string; event: string; data?: unknown }

class WsSocket {
  connected = false
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<Handler>>()
  private pendingAcks = new Map<string, Handler>()
  private shouldReconnect = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly reconnectionDelay = 600
  private readonly reconnectionDelayMax = 4000

  private url(): string {
    return resolveWsUrl()
  }

  connect() {
    this.shouldReconnect = true
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    // Evita abrir 2 sockets em paralelo enquanto o anterior ainda está CLOSING
    // (isso fazia o servidor emitir session:replaced na conexão antiga da mesma aba).
    if (this.ws && this.ws.readyState === WebSocket.CLOSING) {
      return
    }
    this.clearReconnectTimer()
    const ws = new WebSocket(this.url())
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.connected = true
      this.reconnectAttempt = 0
      this.emitLocal('connect')
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let msg: ServerPush
      try {
        msg = JSON.parse(String(ev.data)) as ServerPush
      } catch {
        return
      }
      if (!msg?.event) return
      if (msg.event === 'ack' && msg.id) {
        const cb = this.pendingAcks.get(msg.id)
        this.pendingAcks.delete(msg.id)
        cb?.(msg.data)
        return
      }
      this.emitLocal(msg.event, msg.data)
    }

    ws.onclose = () => {
      if (this.ws !== ws) return
      const wasConnected = this.connected
      this.connected = false
      this.ws = null
      if (wasConnected) this.emitLocal('disconnect')
      if (this.shouldReconnect) this.scheduleReconnect()
    }

    ws.onerror = () => {
      /* onclose follows */
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.pendingAcks.clear()
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* */
      }
    }
    if (this.connected) {
      this.connected = false
      this.emitLocal('disconnect')
    }
  }

  on(event: string, handler: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
    return this
  }

  once(event: string, handler: Handler) {
    const wrap: Handler = (...args) => {
      this.off(event, wrap)
      handler(...args)
    }
    return this.on(event, wrap)
  }

  off(event: string, handler?: Handler) {
    if (!handler) {
      this.listeners.delete(event)
      return this
    }
    this.listeners.get(event)?.delete(handler)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    let ack: Handler | undefined
    const copy = [...args]
    if (copy.length > 0 && typeof copy[copy.length - 1] === 'function') {
      ack = copy.pop() as Handler
    }
    const data = copy.length > 0 ? copy[0] : undefined
    const id = ack ? crypto.randomUUID() : undefined
    if (id && ack) this.pendingAcks.set(id, ack)
    this.send({ id, event, data })
    return this
  }

  private send(payload: { id?: string; event: string; data?: unknown }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }

  private emitLocal(event: string, data?: unknown) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(data)
      } catch (err) {
        console.error(err)
      }
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer()
    const delay = Math.min(
      this.reconnectionDelay * Math.pow(1.5, this.reconnectAttempt),
      this.reconnectionDelayMax,
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) this.connect()
    }, delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

const url = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : undefined

export const socket: Socket = import.meta.env.DEV
  ? io(url, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
    })
  : (new WsSocket() as unknown as Socket)
