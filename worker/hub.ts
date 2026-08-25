import { DurableObject } from 'cloudflare:workers'

export interface Env {
  ASSETS: Fetcher
  NEXO_HUB: DurableObjectNamespace
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const PBKDF2_ITERS = 100_000

type PrismaTier = 'none' | 'basic' | 'full'

type Account = {
  id: string
  username: string
  name: string
  tag: string
  color: string
  password: string
  createdAt: number
  bio?: string
  avatar?: string
  banner?: string
  profileTheme?: string
  customStatus?: string
  presenceStatus?: string
  profileBoard?: Record<string, unknown>
  prismaTier?: PrismaTier
  isAdmin?: boolean
  boostCredits?: number
  customEmojis?: { id: string; name: string; url: string }[]
}

type Channel = { id: string; name: string; type: 'text' | 'voice' }

type Server = {
  id: string
  name: string
  initial: string
  color: string
  ownerId: string
  memberIds: string[]
  inviteCode: string
  channels: Channel[]
  createdAt: number
  boostCount?: number
  boostLevel?: number
}

type Session = { token: string; userId: string; createdAt: number }
type FriendRequest = { from: string; to: string; createdAt: number }
type DmRecentEntry = { peerId: string; lastAt: number; archived?: boolean }

type Db = {
  accounts: Account[]
  sessions: Session[]
  friends: Record<string, string[]>
  requests: FriendRequest[]
  servers: Server[]
  dmRecent?: Record<string, DmRecentEntry[]>
}

type LiveUser = {
  id: string
  username: string
  name: string
  tag: string
  color: string
  status: string
  joinedAt: number
  socketId: string
}

type Attachment = {
  socketId: string
  user?: LiveUser
}

type ClientMsg = { id?: string; event: string; data?: unknown }
type PublicUser = {
  id: string
  username: string
  name: string
  tag: string
  color: string
  status: string
  joinedAt: number
  bio?: string
  avatar?: string
  banner?: string
  profileTheme?: string
  customStatus?: string
  profileBoard?: Record<string, unknown>
  prismaTier?: PrismaTier
  isAdmin?: boolean
  boostCredits?: number
}

const ADMIN_BOOTSTRAP = ['lkbravo']

const PRISMA_UPLOAD: Record<PrismaTier, number> = {
  none: 8 * 1024 * 1024,
  basic: 50 * 1024 * 1024,
  full: 500 * 1024 * 1024,
}

const PRISMA_MSG: Record<PrismaTier, number> = {
  none: 2000,
  basic: 2000,
  full: 4000,
}

const PRISMA_SERVERS: Record<PrismaTier, number> = {
  none: 100,
  basic: 100,
  full: 200,
}

const HISTORY_CAP = 2000

const AVATAR_STATIC_DATAURL = 200_000
const AVATAR_GIF_DATAURL: Record<PrismaTier, number> = {
  none: 0,
  basic: 1_500_000,
  full: 2_500_000,
}

function accountTier(a: Account): PrismaTier {
  return a.prismaTier || 'none'
}

function calcBoostLevel(count: number): number {
  if (count >= 14) return 3
  if (count >= 7) return 2
  if (count >= 2) return 1
  return 0
}

function emptyDb(): Db {
  return { accounts: [], sessions: [], friends: {}, requests: [], servers: [], dmRecent: {} }
}

const INVITE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return `pbkdf2:${toHex(salt)}:${toHex(bits)}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || '').split(':')
  if (parts[0] === 'pbkdf2' && parts.length === 3) {
    const [, saltHex, hashHex] = parts
    if (!saltHex || !hashHex) return false
    try {
      const salt = fromHex(saltHex)
      const expected = fromHex(hashHex)
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
      )
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
        keyMaterial,
        expected.length * 8,
      )
      return timingSafeEqual(expected, new Uint8Array(bits))
    } catch {
      return false
    }
  }
  return false
}

function tagFromId(id: string): string {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % 10000
  return String(n).padStart(4, '0')
}

export class NexoHub extends DurableObject<Env> {
  private db: Db = emptyDb()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private usersBySocket = new Map<string, LiveUser>()
  private socketByUser = new Map<string, string>()
  private sockets = new Map<string, WebSocket>()
  private histories = new Map<string, object[]>()
  private voiceRooms = new Map<string, Set<string>>()
  private historySaveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<Db>('db')
      this.db = stored
        ? {
            accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
            sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
            friends:
              stored.friends && typeof stored.friends === 'object' ? stored.friends : {},
            requests: Array.isArray(stored.requests) ? stored.requests : [],
            servers: Array.isArray(stored.servers) ? stored.servers : [],
            dmRecent:
              stored.dmRecent && typeof stored.dmRecent === 'object' ? stored.dmRecent : {},
          }
        : emptyDb()
      const storedHistories = await ctx.storage.get<Record<string, object[]>>('histories')
      if (storedHistories) {
        for (const [cid, list] of Object.entries(storedHistories)) {
          if (Array.isArray(list)) this.histories.set(cid, list)
        }
      }
      this.migrateDb()
    })
    this.rebuildFromAttachments()
  }

  private rebuildFromAttachments() {
    this.usersBySocket.clear()
    this.socketByUser.clear()
    this.sockets.clear()
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (!att?.socketId) continue
      this.sockets.set(att.socketId, ws)
      if (att.user) {
        this.usersBySocket.set(att.socketId, att.user)
        this.socketByUser.set(att.user.id, att.socketId)
      }
    }
  }

  private migrateDb() {
    let changed = false
    for (const a of this.db.accounts) {
      if (ADMIN_BOOTSTRAP.includes(a.username) && !a.isAdmin) {
        a.isAdmin = true
        changed = true
      }
      if (!a.prismaTier) {
        a.prismaTier = 'none'
        changed = true
      }
      if (a.prismaTier === 'full' && a.boostCredits == null) {
        a.boostCredits = 2
        changed = true
      }
    }
    for (const s of this.db.servers) {
      if (s.boostCount == null) {
        s.boostCount = 0
        changed = true
      }
      const lvl = calcBoostLevel(s.boostCount || 0)
      if (s.boostLevel !== lvl) {
        s.boostLevel = lvl
        changed = true
      }
    }
    if (changed) this.saveDb()
  }

  private saveDb() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.ctx.storage.put('db', this.db)
    }, 250)
  }

  private saveHistories() {
    if (this.historySaveTimer) return
    this.historySaveTimer = setTimeout(() => {
      this.historySaveTimer = null
      const obj: Record<string, object[]> = {}
      for (const [cid, list] of this.histories) obj[cid] = list
      void this.ctx.storage.put('histories', obj)
    }, 500)
  }

  private ensureDmRecent() {
    if (!this.db.dmRecent) this.db.dmRecent = {}
  }

  private touchDmRecent(userId: string, peerId: string) {
    this.ensureDmRecent()
    const list = this.db.dmRecent![userId] || []
    const filtered = list.filter((e) => e.peerId !== peerId)
    filtered.unshift({ peerId, lastAt: Date.now(), archived: false })
    this.db.dmRecent![userId] = filtered.slice(0, 50)
    this.saveDb()
  }

  private recentDmPeers(userId: string) {
    const list = this.db.dmRecent?.[userId] || []
    return list
      .filter((e) => !e.archived && this.areFriends(userId, e.peerId))
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((e) => e.peerId)
  }

  private archiveDmRecent(userId: string, peerId: string) {
    this.ensureDmRecent()
    const list = this.db.dmRecent![userId] || []
    const entry = list.find((e) => e.peerId === peerId)
    if (entry) entry.archived = true
    else list.push({ peerId, lastAt: Date.now(), archived: true })
    this.saveDb()
  }

  private attachmentOf(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) || { socketId: '' }
  }

  private setAttachment(ws: WebSocket, att: Attachment) {
    ws.serializeAttachment(att)
  }

  private send(ws: WebSocket, event: string, data?: unknown, id?: string) {
    try {
      ws.send(JSON.stringify(id ? { id, event, data } : { event, data }))
    } catch {
      /* closed */
    }
  }

  private emitToSocket(socketId: string, event: string, data?: unknown) {
    const ws = this.sockets.get(socketId)
    if (ws) this.send(ws, event, data)
  }

  private emitToUser(userId: string, event: string, data?: unknown) {
    const sid = this.socketByUser.get(userId)
    if (sid) this.emitToSocket(sid, event, data)
  }

  private broadcast(event: string, data?: unknown, exceptSocketId?: string) {
    for (const [sid, ws] of this.sockets) {
      if (exceptSocketId && sid === exceptSocketId) continue
      this.send(ws, event, data)
    }
  }

  private findAccountById(id: string) {
    return this.db.accounts.find((a) => a.id === id) || null
  }

  private findAccountByUsername(username: string) {
    const key = String(username || '')
      .trim()
      .toLowerCase()
      .split('#')[0]
    if (!key) return null
    return this.db.accounts.find((a) => a.username === key) || null
  }

  private createSession(userId: string) {
    const token = randomHex(24)
    this.db.sessions = this.db.sessions.filter((s) => s.userId !== userId)
    this.db.sessions.push({ token, userId, createdAt: Date.now() })
    this.saveDb()
    return token
  }

  private sessionAccount(token: string) {
    const sess = this.db.sessions.find((s) => s.token === token)
    return sess ? this.findAccountById(sess.userId) : null
  }

  private revokeSession(token: string) {
    const before = this.db.sessions.length
    this.db.sessions = this.db.sessions.filter((s) => s.token !== token)
    if (this.db.sessions.length !== before) this.saveDb()
  }

  private friendIdsOf(userId: string) {
    return this.db.friends[userId] || []
  }

  private areFriends(a: string, b: string) {
    return this.friendIdsOf(a).includes(b)
  }

  private addFriendship(a: string, b: string) {
    if (!this.db.friends[a]) this.db.friends[a] = []
    if (!this.db.friends[b]) this.db.friends[b] = []
    if (!this.db.friends[a]!.includes(b)) this.db.friends[a]!.push(b)
    if (!this.db.friends[b]!.includes(a)) this.db.friends[b]!.push(a)
    this.db.requests = this.db.requests.filter(
      (r) => !((r.from === a && r.to === b) || (r.from === b && r.to === a)),
    )
    this.saveDb()
  }

  private removeFriendship(a: string, b: string) {
    this.db.friends[a] = this.friendIdsOf(a).filter((id) => id !== b)
    this.db.friends[b] = this.friendIdsOf(b).filter((id) => id !== a)
    this.saveDb()
  }

  private randomInviteCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    let code = ''
    for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length]
    return code
  }

  private uniqueInviteCode(): string {
    let code = this.randomInviteCode()
    while (this.findServerByInvite(code)) code = this.randomInviteCode()
    return code
  }

  private serversOf(userId: string): Server[] {
    return this.db.servers.filter((s) => s.memberIds.includes(userId))
  }

  private findServer(id: string) {
    return this.db.servers.find((s) => s.id === id) || null
  }

  private findServerByInvite(code: string) {
    const key = String(code || '')
      .trim()
      .toLowerCase()
    if (!key) return null
    return this.db.servers.find((s) => s.inviteCode === key) || null
  }

  private findServerByChannel(channelId: string) {
    return this.db.servers.find((s) => s.channels.some((c) => c.id === channelId)) || null
  }

  private publicServer(s: Server): Server {
    return {
      id: s.id,
      name: s.name,
      initial: s.initial,
      color: s.color,
      ownerId: s.ownerId,
      memberIds: [...s.memberIds],
      inviteCode: s.inviteCode,
      channels: s.channels.map((c) => ({ ...c })),
      createdAt: s.createdAt,
      boostCount: s.boostCount || 0,
      boostLevel: s.boostLevel || calcBoostLevel(s.boostCount || 0),
    }
  }

  private serversOfUser(userId: string) {
    return this.db.servers.filter((s) => s.memberIds.includes(userId))
  }

  private requireAdmin(socketId: string): Account | null {
    const user = this.currentUser(socketId)
    if (!user) return null
    const account = this.findAccountById(user.id)
    if (!account?.isAdmin) return null
    return account
  }

  private emitToServerMembers(serverId: string, event: string, data?: unknown) {
    const server = this.findServer(serverId)
    if (!server) return
    for (const memberId of server.memberIds) this.emitToUser(memberId, event, data)
  }

  private pushServers(userId: string) {
    this.emitToUser(userId, 'servers:update', {
      servers: this.serversOf(userId).map((s) => this.publicServer(s)),
    })
  }

  private pushServersToMembers(server: Server) {
    for (const memberId of server.memberIds) this.pushServers(memberId)
  }

  private isServerMember(server: Server, userId: string) {
    return server.memberIds.includes(userId)
  }

  private relationOf(me: string, other: string) {
    if (this.areFriends(me, other)) return 'friends'
    if (this.db.requests.some((r) => r.from === me && r.to === other)) return 'outgoing'
    if (this.db.requests.some((r) => r.from === other && r.to === me)) return 'incoming'
    return 'none'
  }

  private liveStatus(userId: string) {
    const sid = this.socketByUser.get(userId)
    if (!sid) return 'offline'
    const live = this.usersBySocket.get(sid)
    if (!live || live.status === 'offline') return 'offline'
    return live.status
  }

  private publicUser(account: Account | LiveUser, status?: string, viewerId?: string): PublicUser {
    const bio = 'bio' in account && account.bio ? account.bio : undefined
    const avatar =
      'avatar' in account && typeof account.avatar === 'string' && account.avatar
        ? account.avatar
        : undefined
    const banner =
      'banner' in account && typeof account.banner === 'string' && account.banner
        ? account.banner
        : undefined
    const profileTheme =
      'profileTheme' in account && account.profileTheme ? account.profileTheme : undefined
    const customStatus =
      'customStatus' in account && account.customStatus ? account.customStatus : undefined
    const prismaTier =
      'prismaTier' in account && account.prismaTier ? account.prismaTier : 'none'
    const boostCredits =
      'boostCredits' in account && account.boostCredits != null ? account.boostCredits : undefined
    const out: PublicUser = {
      id: account.id,
      username: account.username,
      name: account.name,
      tag: account.tag,
      color: account.color,
      status: status || this.liveStatus(account.id),
      joinedAt: 'createdAt' in account ? account.createdAt : account.joinedAt,
      prismaTier,
    }
    if (bio) out.bio = bio
    if (avatar) out.avatar = avatar
    if (banner) out.banner = banner
    if (profileTheme) out.profileTheme = profileTheme
    if (customStatus) out.customStatus = customStatus
    if ('profileBoard' in account && account.profileBoard) {
      out.profileBoard = account.profileBoard
    }
    if (boostCredits != null) out.boostCredits = boostCredits
    if (
      viewerId &&
      viewerId === account.id &&
      'isAdmin' in account &&
      account.isAdmin
    ) {
      out.isAdmin = true
    }
    return out
  }

  private snapshot(userId: string) {
    const friends = this.friendIdsOf(userId)
      .map((id) => this.findAccountById(id))
      .filter(Boolean)
      .map((a) => this.publicUser(a!))
    const incoming = this.db.requests
      .filter((r) => r.to === userId)
      .map((r) => this.findAccountById(r.from))
      .filter(Boolean)
      .map((a) => ({ ...this.publicUser(a!), relation: 'incoming' as const }))
    const outgoing = this.db.requests
      .filter((r) => r.from === userId)
      .map((r) => this.findAccountById(r.to))
      .filter(Boolean)
      .map((a) => ({ ...this.publicUser(a!), relation: 'outgoing' as const }))
    return { friends, incoming, outgoing, recentDms: this.recentDmPeers(userId) }
  }

  private emitToFriends(userId: string, event: string, payload: unknown) {
    for (const fid of this.friendIdsOf(userId)) this.emitToUser(fid, event, payload)
  }

  private pushFriends(userId: string) {
    this.emitToUser(userId, 'friends:update', this.snapshot(userId))
  }

  private pushHistory(conversationId: string, message: object) {
    const list = this.histories.get(conversationId) || []
    list.push(message)
    if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP)
    this.histories.set(conversationId, list)
    this.saveHistories()
  }

  private leaveAllVoice(userId: string) {
    for (const [channelId, members] of this.voiceRooms) {
      if (!members.delete(userId)) continue
      const payload = { channelId, members: [...members] }
      const server = this.findServerByChannel(channelId)
      if (server) this.emitToServerMembers(server.id, 'voice:members', payload)
      else this.broadcast('voice:members', payload)
    }
  }

  /** takeover = outro login; reconnect = mesma sessão (não avisar "outro dispositivo"). */
  private kickPrevious(
    userId: string,
    incomingSocketId: string,
    mode: 'takeover' | 'reconnect' = 'takeover',
  ) {
    const prevSid = this.socketByUser.get(userId)
    if (!prevSid || prevSid === incomingSocketId) return
    const prev = this.usersBySocket.get(prevSid)
    this.usersBySocket.delete(prevSid)
    if (mode === 'takeover') this.emitToSocket(prevSid, 'session:replaced')
    const prevWs = this.sockets.get(prevSid)
    if (prevWs) {
      try {
        prevWs.close(1000, mode === 'takeover' ? 'replaced' : 'reconnect')
      } catch {
        /* */
      }
      this.sockets.delete(prevSid)
    }
    if (mode === 'takeover' && prev) {
      this.emitToFriends(userId, 'presence:update', this.publicUser(prev, 'offline'))
    }
  }

  private attachAccount(
    ws: WebSocket,
    socketId: string,
    account: Account,
    ack?: (data: unknown) => void,
    opts?: { mode?: 'takeover' | 'reconnect'; sessionToken?: string },
  ) {
    const mode = opts?.mode ?? 'takeover'
    this.kickPrevious(account.id, socketId, mode)
    const user: LiveUser = {
      id: account.id,
      username: account.username,
      name: account.name,
      tag: account.tag,
      color: account.color,
      status: account.presenceStatus || 'online',
      joinedAt: account.createdAt,
      socketId,
    }
    this.usersBySocket.set(socketId, user)
    this.socketByUser.set(account.id, socketId)
    this.setAttachment(ws, { socketId, user })
    const keep =
      opts?.sessionToken &&
      this.db.sessions.some((s) => s.token === opts.sessionToken && s.userId === account.id)
    const token = keep ? opts!.sessionToken! : this.createSession(account.id)
    ack?.({
      ok: true,
      token,
      user: this.publicUser(account, user.status, account.id),
      servers: this.serversOf(account.id).map((s) => this.publicServer(s)),
      ...this.snapshot(account.id),
    })
    this.emitToFriends(account.id, 'presence:update', this.publicUser(account, user.status))
  }

  private currentUser(socketId: string) {
    return this.usersBySocket.get(socketId) || null
  }

  private dmPeerId(conversationId: string, userId: string) {
    if (!String(conversationId).startsWith('dm:')) return null
    const ids = conversationId.slice(3).split('_')
    if (!ids.includes(userId) || ids.length !== 2) return null
    return ids.find((id) => id !== userId) || null
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    const socketId = crypto.randomUUID()
    this.ctx.acceptWebSocket(server)
    this.setAttachment(server, { socketId })
    this.sockets.set(socketId, server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const att = this.attachmentOf(ws)
    const socketId = att.socketId
    if (!socketId) return
    this.sockets.set(socketId, ws)

    let msg: ClientMsg
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
      msg = JSON.parse(text) as ClientMsg
    } catch {
      return
    }
    if (!msg?.event || typeof msg.event !== 'string') return

    const ack =
      msg.id != null
        ? (data: unknown) => this.send(ws, 'ack', data, msg.id)
        : undefined

    try {
      await this.handleEvent(ws, socketId, msg.event, msg.data, ack)
    } catch (err) {
      console.error(err)
      if (ack && (msg.event === 'account:register' || msg.event === 'account:login')) {
        ack({
          error:
            msg.event === 'account:register'
              ? 'Não foi possível criar a conta.'
              : 'Não foi possível entrar.',
        })
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    const att = this.attachmentOf(ws)
    const socketId = att.socketId
    if (socketId) this.onDisconnect(socketId)
    try {
      ws.close(code, reason)
    } catch {
      /* */
    }
  }

  async webSocketError(ws: WebSocket) {
    const att = this.attachmentOf(ws)
    if (att.socketId) this.onDisconnect(att.socketId)
  }

  private onDisconnect(socketId: string) {
    const user = this.usersBySocket.get(socketId)
    this.sockets.delete(socketId)
    if (!user) return
    this.leaveAllVoice(user.id)
    this.usersBySocket.delete(socketId)
    if (this.socketByUser.get(user.id) === socketId) this.socketByUser.delete(user.id)
    this.broadcast('call:peer-left', { userId: user.id })
    const account = this.findAccountById(user.id)
    if (account) this.emitToFriends(user.id, 'presence:update', this.publicUser(account, 'offline'))
  }

  private async handleEvent(
    ws: WebSocket,
    socketId: string,
    event: string,
    data: unknown,
    ack?: (data: unknown) => void,
  ) {
    switch (event) {
      case 'account:register':
        await this.onRegister(ws, socketId, data, ack)
        break
      case 'account:login':
        await this.onLogin(ws, socketId, data, ack)
        break
      case 'account:resume':
        this.onResume(ws, socketId, data, ack)
        break
      case 'account:logout':
        this.onLogout(socketId, data)
        ack?.(undefined)
        break
      case 'presence:status':
        this.onPresence(ws, socketId, data)
        ack?.(undefined)
        break
      case 'friends:search':
        this.onFriendsSearch(socketId, data, ack)
        break
      case 'friends:add':
        this.onFriendsAdd(socketId, data, ack)
        break
      case 'friends:accept':
        this.onFriendsAccept(socketId, data, ack)
        break
      case 'friends:decline':
        this.onFriendsDecline(socketId, data, ack)
        break
      case 'friends:remove':
        this.onFriendsRemove(socketId, data, ack)
        break
      case 'history':
        this.onHistory(socketId, data, ack)
        break
      case 'dm:archive':
        this.onDmArchive(socketId, data, ack)
        break
      case 'message:send':
        this.onMessageSend(socketId, data)
        ack?.(undefined)
        break
      case 'typing':
        this.onTyping(socketId, data)
        ack?.(undefined)
        break
      case 'call:invite':
        this.onCallInvite(socketId, data)
        ack?.(undefined)
        break
      case 'call:accept':
        this.onCallPeer(socketId, data, 'call:accept')
        ack?.(undefined)
        break
      case 'call:reject':
        this.onCallPeer(socketId, data, 'call:reject')
        ack?.(undefined)
        break
      case 'call:hangup':
        this.onCallPeer(socketId, data, 'call:hangup')
        ack?.(undefined)
        break
      case 'call:signal':
        this.onCallSignal(socketId, data)
        ack?.(undefined)
        break
      case 'call:media':
        this.onCallMedia(socketId, data)
        ack?.(undefined)
        break
      case 'voice:join':
        this.onVoiceJoin(socketId, data)
        ack?.(undefined)
        break
      case 'voice:leave':
        this.onVoiceLeave(socketId, data)
        ack?.(undefined)
        break
      case 'servers:create':
        this.onServersCreate(socketId, data, ack)
        break
      case 'servers:join':
        this.onServersJoin(socketId, data, ack)
        break
      case 'servers:leave':
        this.onServersLeave(socketId, data, ack)
        break
      case 'channels:create':
        this.onChannelsCreate(socketId, data, ack)
        break
      case 'admin:users':
        this.onAdminUsers(socketId, data, ack)
        break
      case 'admin:setTier':
        this.onAdminSetTier(socketId, data, ack)
        break
      case 'admin:setAdmin':
        this.onAdminSetAdmin(socketId, data, ack)
        break
      case 'servers:boost':
        this.onServersBoost(socketId, data, ack)
        break
      case 'profile:update':
        this.onProfileUpdate(ws, socketId, data, ack)
        break
      case 'account:password':
        void this.onPasswordChange(socketId, data, ack)
        break
      default:
        ack?.(undefined)
        break
    }
  }

  private async onRegister(
    ws: WebSocket,
    socketId: string,
    raw: unknown,
    ack?: (data: unknown) => void,
  ) {
    try {
      const payload = (raw || {}) as Record<string, unknown>
      const username = String(payload.username || '')
        .trim()
        .toLowerCase()
      const password = String(payload.password || '')
      const name = String(payload.name || '')
        .trim()
        .slice(0, 32)
      const color = HEX_COLOR.test(String(payload.color || '')) ? String(payload.color) : '#5865F2'

      if (!USERNAME_RE.test(username)) {
        ack?.({ error: 'Usuário: 3 a 20 letras, números ou _.' })
        return
      }
      if (password.length < 6 || password.length > 72) {
        ack?.({ error: 'Senha precisa ter pelo menos 6 caracteres.' })
        return
      }
      if (!name) {
        ack?.({ error: 'Escolha um nome de exibição.' })
        return
      }
      if (this.findAccountByUsername(username)) {
        ack?.({ error: 'Esse nome de usuário já está em uso.' })
        return
      }

      const id = crypto.randomUUID()
      const account: Account = {
        id,
        username,
        name,
        tag: tagFromId(id),
        color,
        password: await hashPassword(password),
        createdAt: Date.now(),
        prismaTier: 'none',
      }
      this.db.accounts.push(account)
      this.db.friends[id] = []
      this.saveDb()
      this.attachAccount(ws, socketId, account, ack)
    } catch (err) {
      console.error(err)
      ack?.({ error: 'Não foi possível criar a conta.' })
    }
  }

  private async onLogin(
    ws: WebSocket,
    socketId: string,
    raw: unknown,
    ack?: (data: unknown) => void,
  ) {
    try {
      const payload = (raw || {}) as Record<string, unknown>
      const username = String(payload.username || '')
        .trim()
        .toLowerCase()
      const password = String(payload.password || '')
      const account = this.findAccountByUsername(username)
      if (!account || !(await verifyPassword(password, account.password))) {
        ack?.({ error: 'Usuário ou senha inválidos.' })
        return
      }
      this.attachAccount(ws, socketId, account, ack)
    } catch (err) {
      console.error(err)
      ack?.({ error: 'Não foi possível entrar.' })
    }
  }

  private onResume(
    ws: WebSocket,
    socketId: string,
    raw: unknown,
    ack?: (data: unknown) => void,
  ) {
    const payload = (raw || {}) as Record<string, unknown>
    const sessionToken = String(payload.token || '')
    const account = this.sessionAccount(sessionToken)
    if (!account) {
      ack?.({ error: 'Sessão expirada. Entre de novo.' })
      return
    }
    this.attachAccount(ws, socketId, account, ack, {
      mode: 'reconnect',
      sessionToken,
    })
  }

  private onLogout(socketId: string, raw: unknown) {
    const payload = (raw || {}) as Record<string, unknown>
    this.revokeSession(String(payload.token || ''))
    const user = this.currentUser(socketId)
    if (!user) return
    this.leaveAllVoice(user.id)
    this.usersBySocket.delete(socketId)
    if (this.socketByUser.get(user.id) === socketId) this.socketByUser.delete(user.id)
    const ws = this.sockets.get(socketId)
    if (ws) this.setAttachment(ws, { socketId })
    this.emitToFriends(user.id, 'presence:update', {
      ...this.publicUser(user, 'offline'),
      status: 'offline',
    })
    this.broadcast('call:peer-left', { userId: user.id })
  }

  private onPresence(ws: WebSocket, socketId: string, statusRaw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const status = String(statusRaw || '')
    if (!['online', 'idle', 'dnd', 'offline'].includes(status)) return
    user.status = status
    this.setAttachment(ws, { socketId, user })
    const account = this.findAccountById(user.id)
    if (!account) return
    account.presenceStatus = status
    this.saveDb()
    this.emitToFriends(user.id, 'presence:update', this.publicUser(account, user.status))
    this.send(ws, 'presence:update', this.publicUser(account, user.status))
  }

  private onFriendsSearch(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const q = String(payload.query || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
    if (q.length < 1) {
      ack?.({ users: [] })
      return
    }
    const users = this.db.accounts
      .filter((a) => a.id !== user.id)
      .filter((a) => {
        const tag = `${a.username}#${a.tag}`
        return a.username.includes(q) || a.name.toLowerCase().includes(q) || tag.includes(q)
      })
      .slice(0, 20)
      .map((a) => ({ ...this.publicUser(a), relation: this.relationOf(user.id, a.id) }))
    ack?.({ users })
  }

  private onFriendsAdd(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const target = payload.userId
      ? this.findAccountById(String(payload.userId))
      : this.findAccountByUsername(String(payload.username || ''))
    if (!target || target.id === user.id) {
      ack?.({ error: 'Não encontramos esse usuário.' })
      return
    }
    if (this.areFriends(user.id, target.id)) {
      ack?.({ ok: true, already: true, relation: 'friends', user: this.publicUser(target) })
      return
    }
    const incoming = this.db.requests.find((r) => r.from === target.id && r.to === user.id)
    if (incoming) {
      this.addFriendship(user.id, target.id)
      this.pushFriends(user.id)
      this.pushFriends(target.id)
      const meAcc = this.findAccountById(user.id)
      this.emitToUser(
        target.id,
        'friends:accepted',
        meAcc ? this.publicUser(meAcc, this.liveStatus(user.id)) : null,
      )
      ack?.({ ok: true, accepted: true, relation: 'friends', user: this.publicUser(target) })
      return
    }
    if (this.db.requests.some((r) => r.from === user.id && r.to === target.id)) {
      ack?.({ ok: true, already: true, relation: 'outgoing', user: this.publicUser(target) })
      return
    }
    this.db.requests.push({ from: user.id, to: target.id, createdAt: Date.now() })
    this.saveDb()
    this.pushFriends(user.id)
    this.pushFriends(target.id)
    ack?.({ ok: true, relation: 'outgoing', user: this.publicUser(target) })
  }

  private onFriendsAccept(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const other = String(payload.userId || '')
    const pending = this.db.requests.find((r) => r.from === other && r.to === user.id)
    if (!pending) {
      ack?.({ error: 'Pedido não encontrado.' })
      return
    }
    this.addFriendship(user.id, other)
    this.pushFriends(user.id)
    this.pushFriends(other)
    const meAcc = this.findAccountById(user.id)
    this.emitToUser(
      other,
      'friends:accepted',
      meAcc ? this.publicUser(meAcc, this.liveStatus(user.id)) : null,
    )
    ack?.({ ok: true })
  }

  private onFriendsDecline(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const other = String(payload.userId || '')
    this.db.requests = this.db.requests.filter(
      (r) => !((r.from === other && r.to === user.id) || (r.from === user.id && r.to === other)),
    )
    this.saveDb()
    this.pushFriends(user.id)
    this.pushFriends(other)
    ack?.({ ok: true })
  }

  private onFriendsRemove(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const other = String(payload.userId || '')
    this.removeFriendship(user.id, other)
    this.db.requests = this.db.requests.filter(
      (r) => !((r.from === other && r.to === user.id) || (r.from === user.id && r.to === other)),
    )
    this.saveDb()
    this.pushFriends(user.id)
    this.pushFriends(other)
    ack?.({ ok: true })
  }

  private onHistory(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ messages: [] })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const cid = String(payload.conversationId || '')
    const peer = this.dmPeerId(cid, user.id)
    if (peer) {
      if (!this.areFriends(user.id, peer)) {
        ack?.({ messages: [] })
        return
      }
    } else if (cid) {
      const server = this.findServerByChannel(cid)
      if (!server || !this.isServerMember(server, user.id)) {
        ack?.({ messages: [] })
        return
      }
    }
    ack?.({ messages: this.histories.get(cid) || [] })
  }

  private onDmArchive(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const peerId = String((raw as Record<string, unknown>)?.userId || '')
    if (!peerId || !this.areFriends(user.id, peerId)) {
      ack?.({ error: 'Conversa inválida.' })
      return
    }
    this.archiveDmRecent(user.id, peerId)
    ack?.({ ok: true, recentDms: this.recentDmPeers(user.id) })
  }

  private onMessageSend(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const conversationId = String(payload.conversationId || '')
    const account = this.findAccountById(user.id)
    const tier = account ? accountTier(account) : 'none'
    const content = String(payload.content || '').slice(0, PRISMA_MSG[tier])
    const maxImg = PRISMA_UPLOAD[tier]
    const image =
      typeof payload.image === 'string' && payload.image.startsWith('data:image/')
        ? payload.image.slice(0, maxImg)
        : undefined
    if (!conversationId) return
    if (!content && !image && payload.kind !== 'call') return

    const peer = this.dmPeerId(conversationId, user.id)
    if (conversationId.startsWith('dm:')) {
      if (!peer || !this.areFriends(user.id, peer)) return
    } else {
      const server = this.findServerByChannel(conversationId)
      if (!server || !this.isServerMember(server, user.id)) return
    }

    const message = {
      id: (payload.id as string) || crypto.randomUUID(),
      conversationId,
      authorId: user.id,
      content,
      image,
      createdAt: Date.now(),
      kind: payload.kind === 'call' || payload.kind === 'system' ? payload.kind : 'text',
      call: payload.call,
    }
    this.pushHistory(conversationId, message)

    if (peer) {
      this.touchDmRecent(user.id, peer)
      this.touchDmRecent(peer, user.id)
      this.emitToUser(user.id, 'message:new', message)
      this.emitToUser(peer, 'message:new', message)
    } else {
      const server = this.findServerByChannel(conversationId)
      if (server) this.emitToServerMembers(server.id, 'message:new', message)
      else this.broadcast('message:new', message)
    }
  }

  private onTyping(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const conversationId = payload.conversationId
    if (!conversationId) return
    const out = { conversationId, userId: user.id, on: Boolean(payload.on) }
    const peer = this.dmPeerId(String(conversationId), user.id)
    if (peer) {
      if (!this.areFriends(user.id, peer)) return
      this.emitToUser(peer, 'typing', out)
    } else {
      const server = this.findServerByChannel(String(conversationId))
      if (!server || !this.isServerMember(server, user.id)) return
      for (const memberId of server.memberIds) {
        if (memberId === user.id) continue
        this.emitToUser(memberId, 'typing', out)
      }
    }
  }

  private onCallInvite(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const to = String(payload.to || '')
    if (!to || to === user.id) return
    if (!this.areFriends(user.id, to)) return
    const account = this.findAccountById(user.id)
    this.emitToUser(to, 'call:invite', {
      from: user.id,
      kind: payload.kind === 'video' ? 'video' : 'audio',
      fromUser: account
        ? this.publicUser(account, this.liveStatus(user.id))
        : this.publicUser(user, user.status),
    })
  }

  private onCallPeer(socketId: string, raw: unknown, event: string) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const to = String(payload.to || '')
    if (!to) return
    this.emitToUser(to, event, { from: user.id })
  }

  private onCallSignal(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const to = String(payload.to || '')
    if (!to || !payload.data) return
    this.emitToUser(to, 'call:signal', { from: user.id, data: payload.data })
  }

  private onCallMedia(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const to = String(payload.to || '')
    if (!to) return
    this.emitToUser(to, 'call:media', {
      from: user.id,
      screen: Boolean(payload.screen),
      camera: Boolean(payload.camera),
      muted: Boolean(payload.muted),
      deafened: Boolean(payload.deafened),
    })
  }

  private onVoiceJoin(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const channelId = String(payload.channelId || '')
    if (!channelId) return
    const server = this.findServerByChannel(channelId)
    if (!server || !this.isServerMember(server, user.id)) return
    const channel = server.channels.find((c) => c.id === channelId)
    if (!channel) return
    this.leaveAllVoice(user.id)
    if (!this.voiceRooms.has(channelId)) this.voiceRooms.set(channelId, new Set())
    const members = this.voiceRooms.get(channelId)!
    members.add(user.id)
    this.emitToServerMembers(server.id, 'voice:members', {
      channelId,
      members: [...members],
    })
  }

  private onVoiceLeave(socketId: string, raw: unknown) {
    const user = this.currentUser(socketId)
    if (!user) return
    const payload = (raw || {}) as Record<string, unknown>
    const channelId = payload.channelId ? String(payload.channelId) : ''
    if (channelId) {
      this.voiceRooms.get(channelId)?.delete(user.id)
      const voicePayload = {
        channelId,
        members: [...(this.voiceRooms.get(channelId) || [])],
      }
      const server = this.findServerByChannel(channelId)
      if (server) this.emitToServerMembers(server.id, 'voice:members', voicePayload)
      else this.broadcast('voice:members', voicePayload)
    } else {
      this.leaveAllVoice(user.id)
    }
  }

  private onServersCreate(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const account = this.findAccountById(user.id)
    const tier = account ? accountTier(account) : 'none'
    if (this.serversOfUser(user.id).length >= PRISMA_SERVERS[tier]) {
      ack?.({ error: `Limite de ${PRISMA_SERVERS[tier]} servidores atingido. Assine Prisma para mais.` })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const name = String(payload.name || '')
      .trim()
      .slice(0, 32)
    if (name.length < 2) {
      ack?.({ error: 'Nome do servidor: 2 a 32 caracteres.' })
      return
    }
    const color = HEX_COLOR.test(String(payload.color || '')) ? String(payload.color) : '#5865F2'
    const id = crypto.randomUUID()
    const server: Server = {
      id,
      name,
      initial: name.charAt(0).toUpperCase(),
      color,
      ownerId: user.id,
      memberIds: [user.id],
      inviteCode: this.uniqueInviteCode(),
      channels: [
        { id: `${id}:geral`, name: 'geral', type: 'text' },
        { id: `${id}:voz`, name: 'Sala de voz', type: 'voice' },
      ],
      createdAt: Date.now(),
      boostCount: 0,
      boostLevel: 0,
    }
    this.db.servers.push(server)
    this.saveDb()
    const pub = this.publicServer(server)
    ack?.({ ok: true, server: pub })
    this.pushServers(user.id)
  }

  private onServersJoin(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const server = this.findServerByInvite(String(payload.code || ''))
    if (!server) {
      ack?.({ error: 'Convite inválido.' })
      return
    }
    if (!server.memberIds.includes(user.id)) {
      const account = this.findAccountById(user.id)
      const tier = account ? accountTier(account) : 'none'
      if (this.serversOfUser(user.id).length >= PRISMA_SERVERS[tier]) {
        ack?.({ error: `Limite de ${PRISMA_SERVERS[tier]} servidores atingido.` })
        return
      }
      server.memberIds.push(user.id)
      this.saveDb()
    }
    ack?.({ ok: true, server: this.publicServer(server) })
    this.pushServersToMembers(server)
  }

  private onServersLeave(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const serverId = String(payload.serverId || '')
    const server = this.findServer(serverId)
    if (!server || !server.memberIds.includes(user.id)) {
      ack?.({ error: 'Servidor não encontrado.' })
      return
    }
    const remaining = server.memberIds.filter((id) => id !== user.id)
    if (remaining.length === 0) {
      this.db.servers = this.db.servers.filter((s) => s.id !== server.id)
      this.saveDb()
      this.pushServers(user.id)
      ack?.({ ok: true })
      return
    }
    server.memberIds = remaining
    this.saveDb()
    this.pushServers(user.id)
    this.pushServersToMembers(server)
    ack?.({ ok: true })
  }

  private onChannelsCreate(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const server = this.findServer(String(payload.serverId || ''))
    if (!server || !this.isServerMember(server, user.id)) {
      ack?.({ error: 'Servidor não encontrado.' })
      return
    }
    const name = String(payload.name || '')
      .trim()
      .slice(0, 32)
    if (name.length < 2) {
      ack?.({ error: 'Nome do canal: 2 a 32 caracteres.' })
      return
    }
    const type = payload.type === 'voice' ? 'voice' : payload.type === 'text' ? 'text' : null
    if (!type) {
      ack?.({ error: 'Tipo de canal inválido.' })
      return
    }
    const channel: Channel = {
      id: `${server.id}:${crypto.randomUUID().slice(0, 8)}`,
      name,
      type,
    }
    server.channels.push(channel)
    this.saveDb()
    ack?.({ ok: true, server: this.publicServer(server) })
    this.pushServersToMembers(server)
  }

  private onProfileUpdate(
    ws: WebSocket,
    socketId: string,
    raw: unknown,
    ack?: (data: unknown) => void,
  ) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const account = this.findAccountById(user.id)
    if (!account) {
      ack?.({ error: 'Conta não encontrada.' })
      return
    }
    const tier = accountTier(account)
    const bioMax = tier === 'full' ? 400 : tier === 'basic' ? 300 : 190
    const payload = (raw || {}) as Record<string, unknown>
    if (payload.name != null) {
      const name = String(payload.name)
        .trim()
        .slice(0, 32)
      if (!name) {
        ack?.({ error: 'Escolha um nome de exibição.' })
        return
      }
      account.name = name
      user.name = name
    }
    if (payload.username != null) {
      const username = String(payload.username)
        .trim()
        .toLowerCase()
      if (!USERNAME_RE.test(username)) {
        ack?.({ error: 'Usuário: 3 a 20 letras, números ou _.' })
        return
      }
      const taken = this.findAccountByUsername(username)
      if (taken && taken.id !== account.id) {
        ack?.({ error: 'Esse nome de usuário já está em uso.' })
        return
      }
      account.username = username
      user.username = username
    }
    if (payload.color != null) {
      const color = String(payload.color)
      if (!HEX_COLOR.test(color)) {
        ack?.({ error: 'Cor inválida.' })
        return
      }
      account.color = color
      user.color = color
    }
    if (payload.bio != null) {
      const bio = String(payload.bio).trim().slice(0, bioMax)
      if (bio) account.bio = bio
      else delete account.bio
    }
    if (payload.customStatus != null) {
      if (tier === 'none') {
        ack?.({ error: 'Status personalizado requer Prisma.' })
        return
      }
      const cs = String(payload.customStatus).trim().slice(0, 128)
      if (cs) account.customStatus = cs
      else delete account.customStatus
    }
    if (payload.profileTheme != null) {
      if (tier === 'none') {
        ack?.({ error: 'Temas de perfil requerem Prisma.' })
        return
      }
      const theme = String(payload.profileTheme).trim().slice(0, 32)
      if (theme && theme !== 'default') account.profileTheme = theme
      else delete account.profileTheme
    }
    if (payload.profileBoard != null) {
      if (typeof payload.profileBoard === 'object' && payload.profileBoard) {
        const raw = JSON.stringify(payload.profileBoard)
        if (raw.length > 48_000) {
          ack?.({ error: 'Perfil grande demais.' })
          return
        }
        account.profileBoard = payload.profileBoard as Record<string, unknown>
      } else {
        delete account.profileBoard
      }
    }
    if ('banner' in payload) {
      if (tier === 'none') {
        ack?.({ error: 'Banner de perfil requer Prisma.' })
        return
      }
      const banner = payload.banner
      if (banner == null || banner === '') {
        delete account.banner
      } else {
        const value = String(banner)
        if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value) || value.length > 600_000) {
          ack?.({ error: 'Banner inválido ou grande demais.' })
          return
        }
        account.banner = value
      }
    }
    if ('avatar' in payload) {
      const avatar = payload.avatar
      if (avatar == null || avatar === '') {
        delete account.avatar
      } else {
        const value = String(avatar)
        const isGif = /^data:image\/gif/i.test(value)
        const maxLen = isGif ? AVATAR_GIF_DATAURL[tier] : AVATAR_STATIC_DATAURL
        if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value) || value.length > maxLen) {
          ack?.({ error: 'Foto inválida ou grande demais.' })
          return
        }
        if (isGif && tier === 'none') {
          ack?.({ error: 'Avatar animado requer Prisma.' })
          return
        }
        account.avatar = value
      }
    }
    this.saveDb()
    this.setAttachment(ws, { socketId, user })
    const pub = this.publicUser(account, this.liveStatus(user.id), user.id)
    ack?.({ ok: true, user: pub })
    this.emitToFriends(user.id, 'presence:update', pub)
    this.send(ws, 'presence:update', pub)
  }

  private onAdminUsers(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    if (!this.requireAdmin(socketId)) {
      ack?.({ error: 'Sem permissão.' })
      return
    }
    const q = String((raw as Record<string, unknown>)?.query || '')
      .trim()
      .toLowerCase()
    const users = this.db.accounts
      .filter(
        (a) =>
          !q ||
          a.username.includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.id.includes(q),
      )
      .slice(0, 40)
      .map((a) => ({
        ...this.publicUser(a, this.liveStatus(a.id)),
        isAdmin: Boolean(a.isAdmin),
      }))
    ack?.({ ok: true, users })
  }

  private onAdminSetTier(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    if (!this.requireAdmin(socketId)) {
      ack?.({ error: 'Sem permissão.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const userId = String(payload.userId || '')
    const tier = String(payload.tier || 'none') as PrismaTier
    if (!['none', 'basic', 'full'].includes(tier)) {
      ack?.({ error: 'Plano inválido.' })
      return
    }
    const account = this.findAccountById(userId)
    if (!account) {
      ack?.({ error: 'Usuário não encontrado.' })
      return
    }
    account.prismaTier = tier
    if (tier === 'full') account.boostCredits = 2
    else account.boostCredits = 0
    this.saveDb()
    const pub = this.publicUser(account, this.liveStatus(userId))
    this.emitToUser(userId, 'presence:update', pub)
    ack?.({ ok: true, user: { ...pub, isAdmin: Boolean(account.isAdmin) } })
  }

  private onAdminSetAdmin(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const admin = this.requireAdmin(socketId)
    if (!admin) {
      ack?.({ error: 'Sem permissão.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const userId = String(payload.userId || '')
    const isAdmin = Boolean(payload.isAdmin)
    const account = this.findAccountById(userId)
    if (!account) {
      ack?.({ error: 'Usuário não encontrado.' })
      return
    }
    if (account.id === admin.id && !isAdmin) {
      ack?.({ error: 'Você não pode remover seu próprio admin.' })
      return
    }
    account.isAdmin = isAdmin
    this.saveDb()
    ack?.({ ok: true, userId, isAdmin })
  }

  private onServersBoost(socketId: string, raw: unknown, ack?: (data: unknown) => void) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const account = this.findAccountById(user.id)
    if (!account || accountTier(account) !== 'full') {
      ack?.({ error: 'Impulsionar servidores requer Prisma completo.' })
      return
    }
    const credits = account.boostCredits ?? 0
    if (credits < 1) {
      ack?.({ error: 'Você não tem impulsos disponíveis.' })
      return
    }
    const serverId = String((raw as Record<string, unknown>)?.serverId || '')
    const server = this.findServer(serverId)
    if (!server || !this.isServerMember(server, user.id)) {
      ack?.({ error: 'Servidor não encontrado.' })
      return
    }
    account.boostCredits = credits - 1
    server.boostCount = (server.boostCount || 0) + 1
    server.boostLevel = calcBoostLevel(server.boostCount)
    this.saveDb()
    this.pushServersToMembers(server)
    ack?.({ ok: true, server: this.publicServer(server), boostCredits: account.boostCredits })
  }

  private async onPasswordChange(
    socketId: string,
    raw: unknown,
    ack?: (data: unknown) => void,
  ) {
    const user = this.currentUser(socketId)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const account = this.findAccountById(user.id)
    if (!account) {
      ack?.({ error: 'Conta não encontrada.' })
      return
    }
    const payload = (raw || {}) as Record<string, unknown>
    const current = String(payload.currentPassword || '')
    const next = String(payload.newPassword || '')
    if (!(await verifyPassword(current, account.password))) {
      ack?.({ error: 'Senha atual incorreta.' })
      return
    }
    if (next.length < 6 || next.length > 72) {
      ack?.({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' })
      return
    }
    account.password = await hashPassword(next)
    this.saveDb()
    ack?.({ ok: true })
  }
}
