import express from 'express'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { Server } from 'socket.io'

const scryptAsync = promisify(scrypt)
const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const dist = join(__dirname, '..', 'dist')
const dataDir = join(__dirname, '..', 'data')
const dataFile = join(dataDir, 'nexo.json')
const messagesFile = join(dataDir, 'messages.json')
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

const app = express()
app.set('trust proxy', 1)
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  pingInterval: 10000,
  pingTimeout: 25000,
  maxHttpBufferSize: 2e6,
})

if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(dist, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res
      .type('html')
      .send(
        '<p>Nexo signal online. Abra o Vite em <a href="http://localhost:5173">localhost:5173</a>.</p>',
      )
  })
}

function emptyDb() {
  return { accounts: [], sessions: [], friends: {}, requests: [], servers: [], dmRecent: {} }
}

function loadDb() {
  try {
    const raw = JSON.parse(readFileSync(dataFile, 'utf8'))
    return {
      accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      friends: raw.friends && typeof raw.friends === 'object' ? raw.friends : {},
      requests: Array.isArray(raw.requests) ? raw.requests : [],
      servers: Array.isArray(raw.servers) ? raw.servers : [],
      dmRecent: raw.dmRecent && typeof raw.dmRecent === 'object' ? raw.dmRecent : {},
    }
  } catch {
    return emptyDb()
  }
}

function loadHistories() {
  try {
    const raw = JSON.parse(readFileSync(messagesFile, 'utf8'))
    if (!raw || typeof raw !== 'object') return new Map()
    return new Map(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v : []]))
  } catch {
    return new Map()
  }
}

const db = loadDb()

const ADMIN_BOOTSTRAP = ['lkbravo']
const PRISMA_UPLOAD = { none: 8 * 1024 * 1024, basic: 50 * 1024 * 1024, full: 500 * 1024 * 1024 }
const PRISMA_MSG = { none: 2000, basic: 2000, full: 4000 }
const PRISMA_SERVERS = { none: 100, basic: 100, full: 200 }
const HISTORY_CAP = 2000
const AVATAR_STATIC_DATAURL = 200_000
const AVATAR_GIF_DATAURL = { none: 0, basic: 1_500_000, full: 2_500_000 }

function accountTier(a) {
  return a?.prismaTier || 'none'
}

function calcBoostLevel(count) {
  if (count >= 14) return 3
  if (count >= 7) return 2
  if (count >= 2) return 1
  return 0
}

function migrateDb() {
  let changed = false
  for (const a of db.accounts) {
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
  for (const s of db.servers) {
    if (s.boostCount == null) {
      s.boostCount = 0
      s.boostLevel = 0
      changed = true
    }
  }
  if (changed) saveDb()
}

let saveTimer = null
let historySaveTimer = null

function saveDb() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(dataFile, JSON.stringify(db))
  }, 250)
}

function saveHistories() {
  if (historySaveTimer) return
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(messagesFile, JSON.stringify(Object.fromEntries(histories)))
  }, 500)
}

function ensureDmRecent() {
  if (!db.dmRecent) db.dmRecent = {}
}

function touchDmRecent(userId, peerId) {
  ensureDmRecent()
  const list = db.dmRecent[userId] || []
  const filtered = list.filter((e) => e.peerId !== peerId)
  filtered.unshift({ peerId, lastAt: Date.now(), archived: false })
  db.dmRecent[userId] = filtered.slice(0, 50)
  saveDb()
}

function recentDmPeers(userId) {
  const list = db.dmRecent?.[userId] || []
  return list
    .filter((e) => !e.archived && areFriends(userId, e.peerId))
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((e) => e.peerId)
}

function archiveDmRecent(userId, peerId) {
  ensureDmRecent()
  const list = db.dmRecent[userId] || []
  const entry = list.find((e) => e.peerId === peerId)
  if (entry) entry.archived = true
  else list.push({ peerId, lastAt: Date.now(), archived: true })
  saveDb()
}

migrateDb()

async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':')
  if (!saltHex || !hashHex) return false
  try {
    const hash = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)
    const expected = Buffer.from(hashHex, 'hex')
    if (expected.length !== hash.length) return false
    return timingSafeEqual(expected, hash)
  } catch {
    return false
  }
}

function findAccountById(id) {
  return db.accounts.find((a) => a.id === id) || null
}

function findAccountByUsername(username) {
  const key = String(username || '')
    .trim()
    .toLowerCase()
    .split('#')[0]
  if (!key) return null
  return db.accounts.find((a) => a.username === key) || null
}

function createSession(userId) {
  const token = randomBytes(24).toString('hex')
  db.sessions = db.sessions.filter((s) => s.userId !== userId)
  db.sessions.push({ token, userId, createdAt: Date.now() })
  saveDb()
  return token
}

function sessionAccount(token) {
  const sess = db.sessions.find((s) => s.token === token)
  return sess ? findAccountById(sess.userId) : null
}

function revokeSession(token) {
  const before = db.sessions.length
  db.sessions = db.sessions.filter((s) => s.token !== token)
  if (db.sessions.length !== before) saveDb()
}

function friendIdsOf(userId) {
  return db.friends[userId] || []
}

function areFriends(a, b) {
  return friendIdsOf(a).includes(b)
}

function addFriendship(a, b) {
  if (!db.friends[a]) db.friends[a] = []
  if (!db.friends[b]) db.friends[b] = []
  if (!db.friends[a].includes(b)) db.friends[a].push(b)
  if (!db.friends[b].includes(a)) db.friends[b].push(a)
  db.requests = db.requests.filter(
    (r) => !((r.from === a && r.to === b) || (r.from === b && r.to === a)),
  )
  saveDb()
}

function removeFriendship(a, b) {
  db.friends[a] = friendIdsOf(a).filter((id) => id !== b)
  db.friends[b] = friendIdsOf(b).filter((id) => id !== a)
  saveDb()
}

const INVITE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomInviteCode() {
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length]
  return code
}

function uniqueInviteCode() {
  let code = randomInviteCode()
  while (findServerByInvite(code)) code = randomInviteCode()
  return code
}

function serversOf(userId) {
  return db.servers.filter((s) => s.memberIds.includes(userId))
}

function findServer(id) {
  return db.servers.find((s) => s.id === id) || null
}

function findServerByInvite(code) {
  const key = String(code || '')
    .trim()
    .toLowerCase()
  if (!key) return null
  return db.servers.find((s) => s.inviteCode === key) || null
}

function findServerByChannel(channelId) {
  return db.servers.find((s) => s.channels.some((c) => c.id === channelId)) || null
}

function publicServer(s) {
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
  }
}

function emitToServerMembers(serverId, event, data) {
  const server = findServer(serverId)
  if (!server) return
  for (const memberId of server.memberIds) emitToUser(memberId, event, data)
}

function pushServers(userId) {
  emitToUser(userId, 'servers:update', {
    servers: serversOf(userId).map(publicServer),
  })
}

function pushServersToMembers(server) {
  for (const memberId of server.memberIds) pushServers(memberId)
}

function isServerMember(server, userId) {
  return server.memberIds.includes(userId)
}

function relationOf(me, other) {
  if (areFriends(me, other)) return 'friends'
  if (db.requests.some((r) => r.from === me && r.to === other)) return 'outgoing'
  if (db.requests.some((r) => r.from === other && r.to === me)) return 'incoming'
  return 'none'
}

/** @type {Map<string, object>} */
const usersBySocket = new Map()
/** @type {Map<string, string>} */
const socketByUser = new Map()
/** @type {Map<string, object[]>} */
const histories = loadHistories()
/** @type {Map<string, Set<string>>} */
const voiceRooms = new Map()

function liveStatus(userId) {
  const sid = socketByUser.get(userId)
  if (!sid) return 'offline'
  const live = usersBySocket.get(sid)
  if (!live || live.status === 'offline') return 'offline'
  return live.status
}

function publicUser(account, status, viewerId) {
  const out = {
    id: account.id,
    username: account.username,
    name: account.name,
    tag: account.tag,
    color: account.color,
    status: status || liveStatus(account.id),
    joinedAt: account.createdAt ?? account.joinedAt,
    prismaTier: account.prismaTier || 'none',
  }
  if (account.bio) out.bio = account.bio
  if (account.avatar) out.avatar = account.avatar
  if (account.banner) out.banner = account.banner
  if (account.profileTheme) out.profileTheme = account.profileTheme
  if (account.customStatus) out.customStatus = account.customStatus
  if (account.profileBoard) out.profileBoard = account.profileBoard
  if (account.boostCredits != null) out.boostCredits = account.boostCredits
  if (viewerId === account.id && account.isAdmin) out.isAdmin = true
  return out
}

function snapshot(userId) {
  const friends = friendIdsOf(userId)
    .map((id) => findAccountById(id))
    .filter(Boolean)
    .map((a) => publicUser(a))
  const incoming = db.requests
    .filter((r) => r.to === userId)
    .map((r) => findAccountById(r.from))
    .filter(Boolean)
    .map((a) => ({ ...publicUser(a), relation: 'incoming' }))
  const outgoing = db.requests
    .filter((r) => r.from === userId)
    .map((r) => findAccountById(r.to))
    .filter(Boolean)
    .map((a) => ({ ...publicUser(a), relation: 'outgoing' }))
  return { friends, incoming, outgoing, recentDms: recentDmPeers(userId) }
}

function emitToUser(userId, event, payload) {
  const sid = socketByUser.get(userId)
  if (sid) io.to(sid).emit(event, payload)
}

function emitToFriends(userId, event, payload) {
  for (const fid of friendIdsOf(userId)) emitToUser(fid, event, payload)
}

function pushFriends(userId) {
  emitToUser(userId, 'friends:update', snapshot(userId))
}

function tagFromId(id) {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % 10000
  return String(n).padStart(4, '0')
}

function pushHistory(conversationId, message) {
  const list = histories.get(conversationId) || []
  list.push(message)
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP)
  histories.set(conversationId, list)
  saveHistories()
}

function leaveAllVoice(userId) {
  for (const [channelId, members] of voiceRooms) {
    if (!members.delete(userId)) continue
    const payload = { channelId, members: [...members] }
    const server = findServerByChannel(channelId)
    if (server) emitToServerMembers(server.id, 'voice:members', payload)
    else io.emit('voice:members', payload)
  }
}

function kickPrevious(userId, incomingSocketId, mode = 'takeover') {
  const prevSid = socketByUser.get(userId)
  if (!prevSid || prevSid === incomingSocketId) return
  const prev = usersBySocket.get(prevSid)
  usersBySocket.delete(prevSid)
  if (mode === 'takeover') io.to(prevSid).emit('session:replaced')
  io.sockets.sockets.get(prevSid)?.disconnect(true)
  if (mode === 'takeover' && prev) {
    emitToFriends(userId, 'presence:update', publicUser(prev, 'offline'))
  }
}

async function attachAccount(socket, account, ack, opts = {}) {
  const mode = opts.mode || 'takeover'
  kickPrevious(account.id, socket.id, mode)
  const user = {
    id: account.id,
    username: account.username,
    name: account.name,
    tag: account.tag,
    color: account.color,
    status: account.presenceStatus || 'online',
    joinedAt: account.createdAt,
    socketId: socket.id,
  }
  usersBySocket.set(socket.id, user)
  socketByUser.set(account.id, socket.id)
  socket.data.userId = account.id
  const keep =
    opts.sessionToken &&
    db.sessions.some((s) => s.token === opts.sessionToken && s.userId === account.id)
  const token = keep ? opts.sessionToken : createSession(account.id)
  ack?.({
    ok: true,
    token,
    user: publicUser(account, user.status, account.id),
    servers: serversOf(account.id).map(publicServer),
    ...snapshot(account.id),
  })
  emitToFriends(account.id, 'presence:update', publicUser(account, user.status))
}

function currentUser(socket) {
  return usersBySocket.get(socket.id) || null
}

function dmPeerId(conversationId, userId) {
  if (!String(conversationId).startsWith('dm:')) return null
  const ids = conversationId.slice(3).split('_')
  if (!ids.includes(userId) || ids.length !== 2) return null
  return ids.find((id) => id !== userId) || null
}

io.on('connection', (socket) => {
  socket.on('account:register', async (payload, ack) => {
    try {
      const username = String(payload?.username || '')
        .trim()
        .toLowerCase()
      const password = String(payload?.password || '')
      const name = String(payload?.name || '')
        .trim()
        .slice(0, 32)
      const color = HEX_COLOR.test(String(payload?.color || '')) ? String(payload.color) : '#5865F2'

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
      if (findAccountByUsername(username)) {
        ack?.({ error: 'Esse nome de usuário já está em uso.' })
        return
      }

      const id = crypto.randomUUID()
      const account = {
        id,
        username,
        name,
        tag: tagFromId(id),
        color,
        password: await hashPassword(password),
        createdAt: Date.now(),
      }
      db.accounts.push(account)
      db.friends[id] = []
      saveDb()
      await attachAccount(socket, account, ack)
    } catch (err) {
      console.error(err)
      ack?.({ error: 'Não foi possível criar a conta.' })
    }
  })

  socket.on('account:login', async (payload, ack) => {
    try {
      const username = String(payload?.username || '')
        .trim()
        .toLowerCase()
      const password = String(payload?.password || '')
      const account = findAccountByUsername(username)
      if (!account || !(await verifyPassword(password, account.password))) {
        ack?.({ error: 'Usuário ou senha inválidos.' })
        return
      }
      await attachAccount(socket, account, ack)
    } catch (err) {
      console.error(err)
      ack?.({ error: 'Não foi possível entrar.' })
    }
  })

  socket.on('account:resume', (payload, ack) => {
    const sessionToken = String(payload?.token || '')
    const account = sessionAccount(sessionToken)
    if (!account) {
      ack?.({ error: 'Sessão expirada. Entre de novo.' })
      return
    }
    void attachAccount(socket, account, ack, { mode: 'reconnect', sessionToken })
  })

  socket.on('account:logout', (payload) => {
    revokeSession(String(payload?.token || ''))
    const user = currentUser(socket)
    if (!user) return
    leaveAllVoice(user.id)
    usersBySocket.delete(socket.id)
    if (socketByUser.get(user.id) === socket.id) socketByUser.delete(user.id)
    emitToFriends(user.id, 'presence:update', { ...publicUser(user, 'offline'), status: 'offline' })
    io.emit('call:peer-left', { userId: user.id })
  })

  socket.on('presence:status', (status) => {
    const user = currentUser(socket)
    if (!user) return
    if (!['online', 'idle', 'dnd', 'offline'].includes(status)) return
    user.status = status
    const account = findAccountById(user.id)
    if (!account) return
    account.presenceStatus = status
    saveDb()
    emitToFriends(user.id, 'presence:update', publicUser(account, user.status))
    socket.emit('presence:update', publicUser(account, user.status))
  })

  socket.on('friends:search', ({ query }, ack) => {
    const user = currentUser(socket)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const q = String(query || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
    if (q.length < 1) {
      ack?.({ users: [] })
      return
    }
    const users = db.accounts
      .filter((a) => a.id !== user.id)
      .filter((a) => {
        const tag = `${a.username}#${a.tag}`
        return a.username.includes(q) || a.name.toLowerCase().includes(q) || tag.includes(q)
      })
      .slice(0, 20)
      .map((a) => ({ ...publicUser(a), relation: relationOf(user.id, a.id) }))
    ack?.({ users })
  })

  socket.on('friends:add', ({ userId, username }, ack) => {
    const user = currentUser(socket)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const target = userId ? findAccountById(String(userId)) : findAccountByUsername(username)
    if (!target || target.id === user.id) {
      ack?.({ error: 'Não encontramos esse usuário.' })
      return
    }
    if (areFriends(user.id, target.id)) {
      ack?.({ ok: true, already: true, relation: 'friends', user: publicUser(target) })
      return
    }
    const incoming = db.requests.find((r) => r.from === target.id && r.to === user.id)
    if (incoming) {
      addFriendship(user.id, target.id)
      pushFriends(user.id)
      pushFriends(target.id)
      const meAcc = findAccountById(user.id)
      emitToUser(target.id, 'friends:accepted', meAcc ? publicUser(meAcc, liveStatus(user.id)) : null)
      ack?.({ ok: true, accepted: true, relation: 'friends', user: publicUser(target) })
      return
    }
    if (db.requests.some((r) => r.from === user.id && r.to === target.id)) {
      ack?.({ ok: true, already: true, relation: 'outgoing', user: publicUser(target) })
      return
    }
    db.requests.push({ from: user.id, to: target.id, createdAt: Date.now() })
    saveDb()
    pushFriends(user.id)
    pushFriends(target.id)
    ack?.({ ok: true, relation: 'outgoing', user: publicUser(target) })
  })

  socket.on('friends:accept', ({ userId }, ack) => {
    const user = currentUser(socket)
    if (!user) {
      ack?.({ error: 'Não autenticado.' })
      return
    }
    const other = String(userId || '')
    const pending = db.requests.find((r) => r.from === other && r.to === user.id)
    if (!pending) {
      ack?.({ error: 'Pedido não encontrado.' })
      return
    }
    addFriendship(user.id, other)
    pushFriends(user.id)
    pushFriends(other)
    const meAcc = findAccountById(user.id)
    emitToUser(other, 'friends:accepted', meAcc ? publicUser(meAcc, liveStatus(user.id)) : null)
    ack?.({ ok: true })
  })

  socket.on('friends:decline', ({ userId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const other = String(userId || '')
    db.requests = db.requests.filter(
      (r) => !((r.from === other && r.to === user.id) || (r.from === user.id && r.to === other)),
    )
    saveDb()
    pushFriends(user.id)
    pushFriends(other)
    ack?.({ ok: true })
  })

  socket.on('friends:remove', ({ userId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const other = String(userId || '')
    removeFriendship(user.id, other)
    db.requests = db.requests.filter(
      (r) => !((r.from === other && r.to === user.id) || (r.from === user.id && r.to === other)),
    )
    saveDb()
    pushFriends(user.id)
    pushFriends(other)
    ack?.({ ok: true })
  })

  socket.on('history', ({ conversationId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ messages: [] })
    const cid = String(conversationId || '')
    const peer = dmPeerId(cid, user.id)
    if (peer) {
      if (!areFriends(user.id, peer)) return ack?.({ messages: [] })
    } else if (cid) {
      const server = findServerByChannel(cid)
      if (!server || !isServerMember(server, user.id)) return ack?.({ messages: [] })
    }
    ack?.({ messages: histories.get(cid) || [] })
  })

  socket.on('dm:archive', ({ userId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const peerId = String(userId || '')
    if (!peerId || !areFriends(user.id, peerId)) return ack?.({ error: 'Conversa inválida.' })
    archiveDmRecent(user.id, peerId)
    ack?.({ ok: true, recentDms: recentDmPeers(user.id) })
  })

  socket.on('message:send', (raw) => {
    const user = currentUser(socket)
    if (!user) return
    const conversationId = String(raw?.conversationId || '')
    const account = findAccountById(user.id)
    const tier = account ? accountTier(account) : 'none'
    const content = String(raw?.content || '').slice(0, PRISMA_MSG[tier])
    const maxImg = PRISMA_UPLOAD[tier]
    const image =
      typeof raw?.image === 'string' && raw.image.startsWith('data:image/')
        ? raw.image.slice(0, maxImg)
        : undefined
    if (!conversationId) return
    if (!content && !image && raw?.kind !== 'call') return

    const peer = dmPeerId(conversationId, user.id)
    if (conversationId.startsWith('dm:')) {
      if (!peer || !areFriends(user.id, peer)) return
    } else {
      const server = findServerByChannel(conversationId)
      if (!server || !isServerMember(server, user.id)) return
    }

    const message = {
      id: raw?.id || crypto.randomUUID(),
      conversationId,
      authorId: user.id,
      content,
      image,
      createdAt: Date.now(),
      kind: raw?.kind === 'call' || raw?.kind === 'system' ? raw.kind : 'text',
      call: raw?.call,
    }
    pushHistory(conversationId, message)

    if (peer) {
      touchDmRecent(user.id, peer)
      touchDmRecent(peer, user.id)
      emitToUser(user.id, 'message:new', message)
      emitToUser(peer, 'message:new', message)
    } else {
      const server = findServerByChannel(conversationId)
      if (server) emitToServerMembers(server.id, 'message:new', message)
      else io.emit('message:new', message)
    }
  })

  socket.on('typing', ({ conversationId, on }) => {
    const user = currentUser(socket)
    if (!user || !conversationId) return
    const payload = { conversationId, userId: user.id, on: Boolean(on) }
    const peer = dmPeerId(conversationId, user.id)
    if (peer) {
      if (!areFriends(user.id, peer)) return
      emitToUser(peer, 'typing', payload)
    } else {
      const server = findServerByChannel(String(conversationId))
      if (!server || !isServerMember(server, user.id)) return
      for (const memberId of server.memberIds) {
        if (memberId === user.id) continue
        emitToUser(memberId, 'typing', payload)
      }
    }
  })

  socket.on('call:invite', ({ to, kind }) => {
    const user = currentUser(socket)
    if (!user || !to || to === user.id) return
    if (!areFriends(user.id, to)) return
    const account = findAccountById(user.id)
    emitToUser(to, 'call:invite', {
      from: user.id,
      kind: kind === 'video' ? 'video' : 'audio',
      fromUser: account ? publicUser(account, liveStatus(user.id)) : publicUser(user, user.status),
    })
  })

  socket.on('call:accept', ({ to }) => {
    const user = currentUser(socket)
    if (!user || !to) return
    emitToUser(to, 'call:accept', { from: user.id })
  })

  socket.on('call:reject', ({ to }) => {
    const user = currentUser(socket)
    if (!user || !to) return
    emitToUser(to, 'call:reject', { from: user.id })
  })

  socket.on('call:hangup', ({ to }) => {
    const user = currentUser(socket)
    if (!user || !to) return
    emitToUser(to, 'call:hangup', { from: user.id })
  })

  socket.on('call:signal', ({ to, data }) => {
    const user = currentUser(socket)
    if (!user || !to || !data) return
    emitToUser(to, 'call:signal', { from: user.id, data })
  })

  socket.on('call:media', ({ to, screen, camera, muted, deafened }) => {
    const user = currentUser(socket)
    if (!user || !to) return
    emitToUser(to, 'call:media', {
      from: user.id,
      screen: Boolean(screen),
      camera: Boolean(camera),
      muted: Boolean(muted),
      deafened: Boolean(deafened),
    })
  })

  socket.on('voice:join', ({ channelId }) => {
    const user = currentUser(socket)
    if (!user || !channelId) return
    const server = findServerByChannel(channelId)
    if (!server || !isServerMember(server, user.id)) return
    if (!server.channels.some((c) => c.id === channelId)) return
    leaveAllVoice(user.id)
    if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Set())
    const members = voiceRooms.get(channelId)
    members.add(user.id)
    socket.join('voice:' + channelId)
    emitToServerMembers(server.id, 'voice:members', { channelId, members: [...members] })
  })

  socket.on('voice:leave', ({ channelId }) => {
    const user = currentUser(socket)
    if (!user) return
    if (channelId) {
      voiceRooms.get(channelId)?.delete(user.id)
      const voicePayload = {
        channelId,
        members: [...(voiceRooms.get(channelId) || [])],
      }
      const server = findServerByChannel(channelId)
      if (server) emitToServerMembers(server.id, 'voice:members', voicePayload)
      else io.emit('voice:members', voicePayload)
    } else {
      leaveAllVoice(user.id)
    }
  })

  socket.on('servers:create', ({ name, color }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const trimmed = String(name || '')
      .trim()
      .slice(0, 32)
    if (trimmed.length < 2) return ack?.({ error: 'Nome do servidor: 2 a 32 caracteres.' })
    const serverColor = HEX_COLOR.test(String(color || '')) ? String(color) : '#5865F2'
    const id = crypto.randomUUID()
    const server = {
      id,
      name: trimmed,
      initial: trimmed.charAt(0).toUpperCase(),
      color: serverColor,
      ownerId: user.id,
      memberIds: [user.id],
      inviteCode: uniqueInviteCode(),
      channels: [
        { id: `${id}:geral`, name: 'geral', type: 'text' },
        { id: `${id}:voz`, name: 'Sala de voz', type: 'voice' },
      ],
      createdAt: Date.now(),
    }
    db.servers.push(server)
    saveDb()
    ack?.({ ok: true, server: publicServer(server) })
    pushServers(user.id)
  })

  socket.on('servers:join', ({ code }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const server = findServerByInvite(String(code || ''))
    if (!server) return ack?.({ error: 'Convite inválido.' })
    if (!server.memberIds.includes(user.id)) {
      server.memberIds.push(user.id)
      saveDb()
    }
    ack?.({ ok: true, server: publicServer(server) })
    pushServersToMembers(server)
  })

  socket.on('servers:leave', ({ serverId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const server = findServer(String(serverId || ''))
    if (!server || !server.memberIds.includes(user.id)) {
      return ack?.({ error: 'Servidor não encontrado.' })
    }
    const remaining = server.memberIds.filter((id) => id !== user.id)
    if (remaining.length === 0) {
      db.servers = db.servers.filter((s) => s.id !== server.id)
      saveDb()
      pushServers(user.id)
      return ack?.({ ok: true })
    }
    server.memberIds = remaining
    saveDb()
    pushServers(user.id)
    pushServersToMembers(server)
    ack?.({ ok: true })
  })

  socket.on('channels:create', ({ serverId, name, type }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const server = findServer(String(serverId || ''))
    if (!server || !isServerMember(server, user.id)) {
      return ack?.({ error: 'Servidor não encontrado.' })
    }
    const trimmed = String(name || '')
      .trim()
      .slice(0, 32)
    if (trimmed.length < 2) return ack?.({ error: 'Nome do canal: 2 a 32 caracteres.' })
    const channelType = type === 'voice' ? 'voice' : type === 'text' ? 'text' : null
    if (!channelType) return ack?.({ error: 'Tipo de canal inválido.' })
    server.channels.push({
      id: `${server.id}:${crypto.randomUUID().slice(0, 8)}`,
      name: trimmed,
      type: channelType,
    })
    saveDb()
    ack?.({ ok: true, server: publicServer(server) })
    pushServersToMembers(server)
  })

  socket.on('profile:update', (patch, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const account = findAccountById(user.id)
    if (!account) return ack?.({ error: 'Conta não encontrada.' })
    const tier = accountTier(account)
    const bioMax = tier === 'full' ? 400 : tier === 'basic' ? 300 : 190
    const { name, color, bio, username, avatar, banner, profileTheme, customStatus, profileBoard } = patch || {}
    if (name != null) {
      const trimmed = String(name).trim().slice(0, 32)
      if (!trimmed) return ack?.({ error: 'Escolha um nome de exibição.' })
      account.name = trimmed
      user.name = trimmed
    }
    if (username != null) {
      const next = String(username).trim().toLowerCase()
      if (!USERNAME_RE.test(next)) return ack?.({ error: 'Usuário: 3 a 20 letras, números ou _.' })
      const taken = findAccountByUsername(next)
      if (taken && taken.id !== account.id) return ack?.({ error: 'Esse nome de usuário já está em uso.' })
      account.username = next
      user.username = next
    }
    if (color != null) {
      if (!HEX_COLOR.test(String(color))) return ack?.({ error: 'Cor inválida.' })
      account.color = String(color)
      user.color = String(color)
    }
    if (bio != null) {
      const trimmed = String(bio).trim().slice(0, bioMax)
      if (trimmed) account.bio = trimmed
      else delete account.bio
    }
    if (customStatus != null) {
      if (tier === 'none') return ack?.({ error: 'Status personalizado requer Prisma.' })
      const cs = String(customStatus).trim().slice(0, 128)
      if (cs) account.customStatus = cs
      else delete account.customStatus
    }
    if (profileTheme != null) {
      if (tier === 'none') return ack?.({ error: 'Temas de perfil requerem Prisma.' })
      const theme = String(profileTheme).trim().slice(0, 32)
      if (theme && theme !== 'default') account.profileTheme = theme
      else delete account.profileTheme
    }
    if (profileBoard != null) {
      if (typeof profileBoard === 'object' && profileBoard) {
        const raw = JSON.stringify(profileBoard)
        if (raw.length > 48000) return ack?.({ error: 'Perfil grande demais.' })
        account.profileBoard = profileBoard
      } else {
        delete account.profileBoard
      }
    }
    if (banner !== undefined) {
      if (tier === 'none') return ack?.({ error: 'Banner de perfil requer Prisma.' })
      if (banner == null || banner === '') delete account.banner
      else {
        const value = String(banner)
        if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value) || value.length > 600000) {
          return ack?.({ error: 'Banner inválido ou grande demais.' })
        }
        account.banner = value
      }
    }
    if (avatar !== undefined) {
      if (avatar == null || avatar === '') delete account.avatar
      else {
        const value = String(avatar)
        const isGif = /^data:image\/gif/i.test(value)
        const maxLen = isGif ? AVATAR_GIF_DATAURL[tier] : AVATAR_STATIC_DATAURL
        if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value) || value.length > maxLen) {
          return ack?.({ error: 'Foto inválida ou grande demais.' })
        }
        if (isGif && tier === 'none') {
          return ack?.({ error: 'Avatar animado requer Prisma.' })
        }
        account.avatar = value
      }
    }
    saveDb()
    const pub = publicUser(account, liveStatus(user.id), user.id)
    ack?.({ ok: true, user: pub })
    emitToFriends(user.id, 'presence:update', pub)
    socket.emit('presence:update', pub)
  })

  socket.on('admin:users', ({ query }, ack) => {
    const user = currentUser(socket)
    const admin = user && findAccountById(user.id)
    if (!admin?.isAdmin) return ack?.({ error: 'Sem permissão.' })
    const q = String(query || '').trim().toLowerCase()
    const users = db.accounts
      .filter(
        (a) => !q || a.username.includes(q) || a.name.toLowerCase().includes(q) || a.id.includes(q),
      )
      .slice(0, 40)
      .map((a) => ({ ...publicUser(a, liveStatus(a.id)), isAdmin: Boolean(a.isAdmin) }))
    ack?.({ ok: true, users })
  })

  socket.on('admin:setTier', ({ userId, tier }, ack) => {
    const user = currentUser(socket)
    const admin = user && findAccountById(user.id)
    if (!admin?.isAdmin) return ack?.({ error: 'Sem permissão.' })
    if (!['none', 'basic', 'full'].includes(tier)) return ack?.({ error: 'Plano inválido.' })
    const account = findAccountById(String(userId || ''))
    if (!account) return ack?.({ error: 'Usuário não encontrado.' })
    account.prismaTier = tier
    account.boostCredits = tier === 'full' ? 2 : 0
    saveDb()
    const pub = publicUser(account, liveStatus(account.id))
    emitToUser(account.id, 'presence:update', pub)
    ack?.({ ok: true, user: { ...pub, isAdmin: Boolean(account.isAdmin) } })
  })

  socket.on('admin:setAdmin', ({ userId, isAdmin }, ack) => {
    const user = currentUser(socket)
    const admin = user && findAccountById(user.id)
    if (!admin?.isAdmin) return ack?.({ error: 'Sem permissão.' })
    const account = findAccountById(String(userId || ''))
    if (!account) return ack?.({ error: 'Usuário não encontrado.' })
    if (account.id === admin.id && !isAdmin) return ack?.({ error: 'Você não pode remover seu próprio admin.' })
    account.isAdmin = Boolean(isAdmin)
    saveDb()
    ack?.({ ok: true, userId: account.id, isAdmin: account.isAdmin })
  })

  socket.on('servers:boost', ({ serverId }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const account = findAccountById(user.id)
    if (!account || accountTier(account) !== 'full') {
      return ack?.({ error: 'Impulsionar servidores requer Prisma completo.' })
    }
    if ((account.boostCredits ?? 0) < 1) return ack?.({ error: 'Sem impulsos disponíveis.' })
    const server = db.servers.find((s) => s.id === serverId)
    if (!server || !server.memberIds.includes(user.id)) return ack?.({ error: 'Servidor não encontrado.' })
    account.boostCredits -= 1
    server.boostCount = (server.boostCount || 0) + 1
    server.boostLevel = calcBoostLevel(server.boostCount)
    saveDb()
    pushServersToMembers(server)
    ack?.({ ok: true, server: publicServer(server), boostCredits: account.boostCredits })
  })

  socket.on('account:password', async ({ currentPassword, newPassword }, ack) => {
    const user = currentUser(socket)
    if (!user) return ack?.({ error: 'Não autenticado.' })
    const account = findAccountById(user.id)
    if (!account) return ack?.({ error: 'Conta não encontrada.' })
    if (!(await verifyPassword(String(currentPassword || ''), account.password))) {
      return ack?.({ error: 'Senha atual incorreta.' })
    }
    const next = String(newPassword || '')
    if (next.length < 6 || next.length > 72) {
      return ack?.({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' })
    }
    account.password = await hashPassword(next)
    saveDb()
    ack?.({ ok: true })
  })

  socket.on('disconnect', () => {
    const user = currentUser(socket)
    if (!user) return
    leaveAllVoice(user.id)
    usersBySocket.delete(socket.id)
    if (socketByUser.get(user.id) === socket.id) socketByUser.delete(user.id)
    io.emit('call:peer-left', { userId: user.id })
    const account = findAccountById(user.id)
    if (account) emitToFriends(user.id, 'presence:update', publicUser(account, 'offline'))
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexo signal em http://localhost:${PORT}`)
})
