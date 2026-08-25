import { create } from 'zustand'
import { socket } from './lib/socket'
import { AVATAR_COLORS, dmConversationId } from './lib/ids'
import { playMessagePop } from './lib/sounds'
import { bindCallStore, callManager } from './lib/webrtc'
import type {
  AppView,
  AuthPayload,
  CallKind,
  CallState,
  ChatMessage,
  Devices,
  MediaPrefs,
  PresenceStatus,
  Server,
  User,
  VideoFps,
  VideoQuality,
  ProfileBoardData,
} from './types'
import { parseProfileBoard } from './lib/profileBoard'

const SESSION_KEY = 'nexo.session'
const USERNAME_KEY = 'nexo.username'
const MEDIA_KEY = 'nexo.media'
const RECENT_DMS_PREFIX = 'nexo.recentDms.'

function recentDmsKey(userId: string) {
  return `${RECENT_DMS_PREFIX}${userId}`
}

function loadLocalRecentDms(userId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentDmsKey(userId)) || '[]')
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function saveLocalRecentDms(userId: string, ids: string[]) {
  localStorage.setItem(recentDmsKey(userId), JSON.stringify(ids))
}

function mergeRecentDms(server: string[], local: string[], friendIds: string[]) {
  const friends = new Set(friendIds)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...server, ...local]) {
    if (!friends.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function preloadRecentHistories(userId: string, peerIds: string[]) {
  for (const peerId of peerIds) {
    useAppStore.getState().loadHistory(dmConversationId(userId, peerId))
  }
}

function idleCall(): CallState {
  return {
    status: 'idle',
    kind: 'audio',
    peerId: null,
    incomingFrom: null,
    incomingKind: 'audio',
    channelId: null,
    serverId: null,
    muted: false,
    deafened: false,
    cameraOn: false,
    screenOn: false,
    remoteCamera: false,
    remoteScreen: false,
    startedAt: null,
    connection: 'new',
    error: null,
    mediaTick: 0,
    peerIds: [],
    peerMuted: {},
    peerDeafened: {},
    alone: false,
    leftCall: false,
    voiceFx: 'off',
    noiseReduction: false,
  }
}

function loadMediaPrefs(): MediaPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(MEDIA_KEY) || '')
    return {
      videoQuality: (['360p', '480p', '720p'].includes(raw.videoQuality) ? raw.videoQuality : '480p') as VideoQuality,
      fps: ([12, 15, 24, 30, 60].includes(Number(raw.fps)) ? Number(raw.fps) : 15) as VideoFps,
    }
  } catch {
    return { videoQuality: '480p', fps: 15 }
  }
}

function mergeUsers(list: User[], extra: User[]) {
  const map = new Map(list.map((u) => [u.id, u]))
  for (const u of extra) {
    const prev = map.get(u.id)
    const merged = prev ? { ...prev, ...u } : u
    if (u.profileBoard) merged.profileBoard = parseProfileBoard(u.profileBoard)
    map.set(u.id, merged)
  }
  return [...map.values()]
}

function upsertMessage(map: Record<string, ChatMessage[]>, msg: ChatMessage) {
  const list = map[msg.conversationId] || []
  if (list.some((m) => m.id === msg.id)) return map
  return { ...map, [msg.conversationId]: [...list, msg] }
}

export interface AppState {
  me: User | null
  users: User[]
  friendIds: string[]
  incoming: User[]
  outgoing: User[]
  searchResults: User[]
  servers: Server[]
  messages: Record<string, ChatMessage[]>
  typing: Record<string, string[]>
  unread: Record<string, number>
  openDms: string[]
  railDms: string[]
  view: AppView
  profileOpen: boolean
  settingsOpen: boolean
  searchOpen: boolean
  serverModal: 'create' | 'join' | 'channel' | null
  query: string
  connected: boolean
  authReady: boolean
  authBusy: boolean
  authError: string | null
  friendHint: string | null
  voiceMembers: Record<string, string[]>
  devices: Devices
  mediaPrefs: MediaPrefs
  call: CallState
  resumeSession: () => void
  register: (input: { username: string; password: string; name: string; color: string }) => void
  login: (username: string, password: string) => void
  logout: () => void
  searchPeople: (query: string) => void
  addFriend: (who: { userId?: string; username?: string }) => void
  acceptFriend: (userId: string) => void
  declineFriend: (userId: string) => void
  removeFriend: (userId: string) => void
  createServer: (name: string, color: string) => void
  joinServer: (code: string) => void
  leaveServer: (serverId: string) => void
  createChannel: (serverId: string, name: string, type: 'text' | 'voice') => void
  updateProfile: (patch: {
    name?: string
    username?: string
    color?: string
    bio?: string
    avatar?: string | null
    banner?: string | null
    profileTheme?: string | null
    customStatus?: string | null
    profileBoard?: ProfileBoardData | null
  }) => void
  boostServer: (serverId: string) => Promise<{ ok?: boolean; error?: string }>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok?: boolean; error?: string }>
  setView: (view: AppView) => void
  setStatus: (status: PresenceStatus) => void
  sendMessage: (conversationId: string, content: string, image?: string) => void
  loadHistory: (conversationId: string) => void
  openDm: (userId: string) => void
  closeDm: (userId: string) => void
  archiveDm: (userId: string) => void
  clearRailDm: (userId: string) => void
  setTyping: (conversationId: string, on: boolean) => void
  toggleProfile: () => void
  toggleSettings: () => void
  toggleSearch: () => void
  setServerModal: (m: AppState['serverModal']) => void
  setQuery: (q: string) => void
  setDevices: (patch: Partial<Devices>) => void
  setMediaPrefs: (patch: Partial<MediaPrefs>) => void
  logCall: (info: {
    peerId: string
    durationMs: number
    missed: boolean
    media: 'audio' | 'video' | 'screen'
  }) => void
}

function applySession(res: AuthPayload) {
  if (!res.ok || !res.user || !res.token) return false
  localStorage.setItem(SESSION_KEY, res.token)
  localStorage.setItem(USERNAME_KEY, res.user.username)
  callManager.selfId = res.user.id
  const friends = res.friends || []
  const incoming = res.incoming || []
  const outgoing = res.outgoing || []
  const servers = res.servers || []
  const friendIds = friends.map((u) => u.id)
  const openDms = mergeRecentDms(
    res.recentDms || [],
    loadLocalRecentDms(res.user.id),
    friendIds,
  )
  saveLocalRecentDms(res.user.id, openDms)
  useAppStore.setState({
    me: res.user,
    users: mergeUsers([], [...friends, ...incoming, ...outgoing]),
    friendIds,
    incoming,
    outgoing,
    servers,
    openDms,
    connected: true,
    authReady: true,
    authBusy: false,
    authError: null,
  })
  preloadRecentHistories(res.user.id, openDms.slice(0, 12))
  return true
}

function applyFriends(payload: { friends?: User[]; incoming?: User[]; outgoing?: User[] }) {
  const friends = payload.friends || []
  const incoming = payload.incoming || []
  const outgoing = payload.outgoing || []
  useAppStore.setState((s) => ({
    friendIds: friends.map((u) => u.id),
    incoming,
    outgoing,
    users: mergeUsers(s.users, [...friends, ...incoming, ...outgoing]),
  }))
}

let wired = false

function wireRealtime() {
  if (wired) return
  wired = true
  callManager.attach()

  socket.on('connect', () => {
    useAppStore.setState({ connected: true })
    const token = localStorage.getItem(SESSION_KEY)
    const me = useAppStore.getState().me
    if (token && me) {
      socket.emit('account:resume', { token }, (res: AuthPayload) => {
        if (res?.ok) applySession(res)
      })
    }
  })
  socket.on('disconnect', () => useAppStore.setState({ connected: false }))
  socket.on('session:replaced', () => {
    localStorage.removeItem(SESSION_KEY)
    callManager.hangup()
    useAppStore.setState({
      me: null,
      users: [],
      friendIds: [],
      incoming: [],
      outgoing: [],
      servers: [],
      railDms: [],
      connected: false,
      authReady: true,
      authError: 'Você entrou em outro dispositivo.',
      view: { kind: 'friends' },
    })
  })

  socket.on('presence:update', (user: User) => {
    useAppStore.setState((s) => ({
      users: mergeUsers(s.users, [user]),
      me: s.me?.id === user.id ? { ...s.me, ...user } : s.me,
      incoming: s.incoming.map((u) => (u.id === user.id ? { ...u, ...user } : u)),
      outgoing: s.outgoing.map((u) => (u.id === user.id ? { ...u, ...user } : u)),
    }))
  })

  socket.on('friends:update', applyFriends)
  socket.on('friends:accepted', (user: User | null) => {
    if (!user) return
    useAppStore.setState((s) => ({
      users: mergeUsers(s.users, [user]),
      friendHint: `${user.name} aceitou o pedido de amizade.`,
    }))
  })

  socket.on('servers:update', (payload: { servers?: Server[] }) => {
    useAppStore.setState({ servers: payload.servers || [] })
  })

  socket.on('message:new', (msg: ChatMessage) => {
    const state = useAppStore.getState()
    const active =
      (state.view.kind === 'dm' &&
        state.me &&
        dmConversationId(state.me.id, state.view.userId) === msg.conversationId) ||
      (state.view.kind === 'channel' && state.view.channelId === msg.conversationId)

    let railPeer: string | null = null
    if (msg.conversationId.startsWith('dm:') && state.me && msg.authorId !== state.me.id) {
      const ids = msg.conversationId.slice(3).split('_')
      railPeer = ids.find((id) => id !== state.me?.id) || null
    }

    useAppStore.setState((s) => {
      const unread = { ...s.unread }
      if (!active && msg.authorId !== s.me?.id) {
        unread[msg.conversationId] = (unread[msg.conversationId] || 0) + 1
      }
      let openDms = s.openDms
      let railDms = s.railDms
      if (msg.conversationId.startsWith('dm:') && s.me) {
        const ids = msg.conversationId.slice(3).split('_')
        const other = ids.find((id) => id !== s.me?.id)
        if (other && !openDms.includes(other)) openDms = [other, ...openDms]
        if (other && msg.authorId !== s.me.id && !active) {
          railDms = [other, ...railDms.filter((id) => id !== other)]
        }
        if (other) saveLocalRecentDms(s.me.id, openDms)
      }
      return { messages: upsertMessage(s.messages, msg), unread, openDms, railDms }
    })

    if (!active && msg.authorId !== state.me?.id && (msg.kind === 'text' || msg.image)) {
      playMessagePop()
      if (railPeer) {
        // title flash
        const prev = document.title
        document.title = '• Nova mensagem — Nexo'
        window.setTimeout(() => {
          if (document.title.startsWith('• ')) document.title = prev
        }, 2500)
      }
    }
  })

  socket.on(
    'typing',
    ({ conversationId, userId, on }: { conversationId: string; userId: string; on: boolean }) => {
      useAppStore.setState((s) => {
        const cur = new Set(s.typing[conversationId] || [])
        if (on) cur.add(userId)
        else cur.delete(userId)
        return { typing: { ...s.typing, [conversationId]: [...cur] } }
      })
    },
  )

  socket.on('voice:members', ({ channelId, members }: { channelId: string; members: string[] }) => {
    useAppStore.setState((s) => ({
      voiceMembers: { ...s.voiceMembers, [channelId]: members },
    }))
    void callManager.onVoiceMembers(channelId, members)
  })
}

function ensureSocket() {
  wireRealtime()
  if (!socket.connected) socket.connect()
}

function runAuth(event: 'account:register' | 'account:login', payload: object) {
  ensureSocket()
  useAppStore.setState({ authBusy: true, authError: null })
  const send = () => {
    socket.emit(event, payload, (res: AuthPayload) => {
      if (res?.ok && applySession(res)) return
      useAppStore.setState({
        authBusy: false,
        authReady: true,
        authError: res?.error || 'Não foi possível autenticar.',
      })
    })
  }
  if (socket.connected) send()
  else socket.once('connect', send)
}

export const useAppStore = create<AppState>((set, get) => ({
  me: null,
  users: [],
  friendIds: [],
  incoming: [],
  outgoing: [],
  searchResults: [],
  servers: [],
  messages: {},
  typing: {},
  unread: {},
  openDms: [],
  railDms: [],
  view: { kind: 'friends' },
  profileOpen: false,
  settingsOpen: false,
  searchOpen: false,
  serverModal: null,
  query: '',
  connected: false,
  authReady: false,
  authBusy: false,
  authError: null,
  friendHint: null,
  voiceMembers: {},
  devices: { micId: '', speakerId: '', camId: '' },
  mediaPrefs: loadMediaPrefs(),
  call: idleCall(),

  resumeSession: () => {
    wireRealtime()
    const token = localStorage.getItem(SESSION_KEY)
    if (!token) {
      set({ authReady: true })
      return
    }
    const send = () => {
      socket.emit('account:resume', { token }, (res: AuthPayload) => {
        if (res?.ok && applySession(res)) return
        localStorage.removeItem(SESSION_KEY)
        socket.disconnect()
        set({ authReady: true, me: null, authBusy: false })
      })
    }
    if (socket.connected) send()
    else {
      socket.once('connect', send)
      socket.connect()
    }
  },

  register: ({ username, password, name, color }) => {
    runAuth('account:register', { username, password, name, color })
  },

  login: (username, password) => {
    runAuth('account:login', { username, password })
  },

  logout: () => {
    callManager.hangup()
    const token = localStorage.getItem(SESSION_KEY)
    if (socket.connected && token) socket.emit('account:logout', { token })
    localStorage.removeItem(SESSION_KEY)
    socket.disconnect()
    set({
      me: null,
      users: [],
      friendIds: [],
      incoming: [],
      outgoing: [],
      servers: [],
      searchResults: [],
      railDms: [],
      connected: false,
      authReady: true,
      authError: null,
      view: { kind: 'friends' },
      openDms: [],
    })
  },

  searchPeople: (query) => {
    const q = query.trim()
    if (q.length < 1) {
      set({ searchResults: [] })
      return
    }
    socket.emit('friends:search', { query: q }, (res: { users?: User[] }) => {
      const users = res?.users || []
      set((s) => ({
        searchResults: users,
        users: mergeUsers(s.users, users),
      }))
    })
  },

  addFriend: (who) => {
    socket.emit('friends:add', who, (res: AuthPayload & { user?: User }) => {
      if (res?.error) {
        set({ friendHint: res.error })
        return
      }
      if (res?.accepted && res.user) {
        set({ friendHint: `Vocês agora são amigos.` })
        get().openDm(res.user.id)
        return
      }
      if (res?.already && res.relation === 'friends' && (who.userId || res.user?.id)) {
        get().openDm(who.userId || res.user!.id)
        return
      }
      set({ friendHint: 'Pedido de amizade enviado.' })
    })
  },

  acceptFriend: (userId) => {
    socket.emit('friends:accept', { userId }, (res: AuthPayload) => {
      if (res?.error) {
        set({ friendHint: res.error })
        return
      }
      get().openDm(userId)
    })
  },

  declineFriend: (userId) => {
    socket.emit('friends:decline', { userId })
  },

  removeFriend: (userId) => {
    socket.emit('friends:remove', { userId })
    set((s) => ({
      openDms: s.openDms.filter((id) => id !== userId),
      railDms: s.railDms.filter((id) => id !== userId),
      view: s.view.kind === 'dm' && s.view.userId === userId ? { kind: 'friends' } : s.view,
    }))
  },

  createServer: (name, color) => {
    socket.emit('servers:create', { name, color }, (res: AuthPayload & { server?: Server }) => {
      if (res?.error) {
        set({ friendHint: res.error })
        return
      }
      if (res?.server) {
        set((s) => ({
          servers: s.servers.some((x) => x.id === res.server!.id)
            ? s.servers.map((x) => (x.id === res.server!.id ? res.server! : x))
            : [...s.servers, res.server!],
          serverModal: null,
        }))
        const first = res.server.channels.find((c) => c.type === 'text') || res.server.channels[0]
        if (first) get().setView({ kind: 'channel', serverId: res.server.id, channelId: first.id })
      }
    })
  },

  joinServer: (code) => {
    socket.emit('servers:join', { code }, (res: AuthPayload & { server?: Server }) => {
      if (res?.error) {
        set({ friendHint: res.error })
        return
      }
      if (res?.server) {
        const server = res.server
        set((s) => ({
          servers: s.servers.some((x) => x.id === server.id)
            ? s.servers
            : [...s.servers, server],
          serverModal: null,
          friendHint: `Entrou em ${server.name}`,
        }))
        const first = server.channels.find((c) => c.type === 'text') || server.channels[0]
        if (first) get().setView({ kind: 'channel', serverId: server.id, channelId: first.id })
      }
    })
  },

  leaveServer: (serverId) => {
    socket.emit('servers:leave', { serverId })
    set((s) => ({
      servers: s.servers.filter((x) => x.id !== serverId),
      view:
        s.view.kind === 'channel' && s.view.serverId === serverId ? { kind: 'friends' } : s.view,
    }))
  },

  createChannel: (serverId, name, type) => {
    socket.emit(
      'channels:create',
      { serverId, name, type },
      (res: AuthPayload & { server?: Server }) => {
        if (res?.error) {
          set({ friendHint: res.error })
          return
        }
        if (res?.server) {
          set((s) => ({
            servers: s.servers.map((x) => (x.id === res.server!.id ? res.server! : x)),
            serverModal: null,
          }))
          const ch = res.server.channels[res.server.channels.length - 1]
          if (ch) get().setView({ kind: 'channel', serverId, channelId: ch.id })
        }
      },
    )
  },

  updateProfile: (patch) => {
    socket.emit('profile:update', patch, (res: AuthPayload) => {
      if (res?.error) {
        set({ friendHint: res.error })
        return
      }
      if (res?.user) {
        const user = {
          ...res.user,
          profileBoard: res.user.profileBoard ? parseProfileBoard(res.user.profileBoard) : undefined,
        }
        set((s) => ({
          me: user,
          users: mergeUsers(s.users, [user]),
          friendHint: 'Perfil atualizado.',
        }))
      }
    })
  },

  boostServer: (serverId) =>
    new Promise((resolve) => {
      socket.emit(
        'servers:boost',
        { serverId },
        (res: AuthPayload & { server?: Server; boostCredits?: number }) => {
          if (res?.error) {
            resolve({ error: res.error })
            return
          }
          if (res?.server) {
            set((s) => ({
              servers: s.servers.map((sv) => (sv.id === res.server!.id ? res.server! : sv)),
              me: s.me && res.boostCredits != null ? { ...s.me, boostCredits: res.boostCredits } : s.me,
            }))
          }
          resolve({ ok: true })
        },
      )
    }),

  changePassword: (currentPassword, newPassword) =>
    new Promise((resolve) => {
      socket.emit(
        'account:password',
        { currentPassword, newPassword },
        (res: { ok?: boolean; error?: string }) => {
          resolve(res || { error: 'Não foi possível alterar a senha.' })
        },
      )
    }),

  setView: (view) => {
    set((s) => {
      const unread = { ...s.unread }
      let railDms = s.railDms
      if (view.kind === 'dm' && s.me) {
        unread[dmConversationId(s.me.id, view.userId)] = 0
        railDms = railDms.filter((id) => id !== view.userId)
      }
      if (view.kind === 'channel') unread[view.channelId] = 0
      return {
        view,
        unread,
        railDms,
        profileOpen: view.kind === 'dm' || view.kind === 'friends' ? false : s.profileOpen,
      }
    })
    const me = get().me
    if (view.kind === 'dm' && me) get().loadHistory(dmConversationId(me.id, view.userId))
    if (view.kind === 'channel') get().loadHistory(view.channelId)
  },

  setStatus: (status) => {
    set((s) => (s.me ? { me: { ...s.me, status } } : {}))
    socket.emit('presence:status', status)
  },

  sendMessage: (conversationId, content, image) => {
    const me = get().me
    if (!me) return
    if (conversationId.startsWith('dm:')) {
      const ids = conversationId.slice(3).split('_')
      const other = ids.find((id) => id !== me.id)
      if (!other || !get().friendIds.includes(other)) return
    }
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      authorId: me.id,
      content: content.trim(),
      createdAt: Date.now(),
      kind: 'text',
      image,
    }
    if (!msg.content && !image) return
    set((s) => ({ messages: upsertMessage(s.messages, msg) }))
    socket.emit('message:send', msg)
  },

  loadHistory: (conversationId) => {
    socket.emit('history', { conversationId }, (res: { messages?: ChatMessage[] }) => {
      const incoming = res?.messages
      if (!incoming) return
      set((s) => {
        const have = new Set((s.messages[conversationId] || []).map((m) => m.id))
        const extra = incoming.filter((m) => !have.has(m.id))
        if (!extra.length && s.messages[conversationId]) return s
        const merged = [...(s.messages[conversationId] || []), ...extra].sort(
          (a, b) => a.createdAt - b.createdAt,
        )
        return { messages: { ...s.messages, [conversationId]: merged } }
      })
    })
  },

  openDm: (userId) => {
    if (!get().friendIds.includes(userId)) return
    set((s) => {
      const openDms = s.openDms.includes(userId) ? s.openDms : [userId, ...s.openDms]
      if (s.me) saveLocalRecentDms(s.me.id, openDms)
      return {
        openDms,
        railDms: s.railDms.filter((id) => id !== userId),
        profileOpen: false,
      }
    })
    get().loadHistory(dmConversationId(get().me!.id, userId))
    get().setView({ kind: 'dm', userId })
  },

  closeDm: (userId) => {
    set((s) => ({
      view: s.view.kind === 'dm' && s.view.userId === userId ? { kind: 'friends' } : s.view,
    }))
  },

  archiveDm: (userId) => {
    socket.emit('dm:archive', { userId }, (res: { ok?: boolean; recentDms?: string[] }) => {
      if (!res?.ok) return
      const me = get().me
      const openDms = res.recentDms || get().openDms.filter((id) => id !== userId)
      if (me) saveLocalRecentDms(me.id, openDms)
      set((s) => ({
        openDms,
        railDms: s.railDms.filter((id) => id !== userId),
        view: s.view.kind === 'dm' && s.view.userId === userId ? { kind: 'friends' } : s.view,
      }))
    })
  },

  clearRailDm: (userId) => set((s) => ({ railDms: s.railDms.filter((id) => id !== userId) })),

  setTyping: (conversationId, on) => {
    socket.emit('typing', { conversationId, on })
  },

  toggleProfile: () => set((s) => ({ profileOpen: !s.profileOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setServerModal: (serverModal) => set({ serverModal }),
  setQuery: (query) => set({ query }),
  setDevices: (patch) => set((s) => ({ devices: { ...s.devices, ...patch } })),
  setMediaPrefs: (patch) => {
    set((s) => {
      const mediaPrefs = { ...s.mediaPrefs, ...patch }
      localStorage.setItem(MEDIA_KEY, JSON.stringify(mediaPrefs))
      return { mediaPrefs }
    })
    void callManager.applyScreenPrefs()
  },

  logCall: ({ peerId, durationMs, missed, media }) => {
    const me = get().me
    if (!me) return
    const conversationId = dmConversationId(me.id, peerId)
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      authorId: me.id,
      content: missed ? 'Chamada perdida' : 'Chamada encerrada',
      createdAt: Date.now(),
      kind: 'call',
      call: { durationMs, missed, media },
    }
    set((s) => ({ messages: upsertMessage(s.messages, msg) }))
    socket.emit('message:send', { ...msg, kind: 'call', call: msg.call })
  },
}))

bindCallStore(useAppStore)

export function savedUsername() {
  return localStorage.getItem(USERNAME_KEY) || ''
}

export function colorFor(name: string) {
  let n = 0
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

export async function ensureSingleCall() {
  const { call } = useAppStore.getState()
  if (call.status !== 'idle') {
    callManager.hangup()
    await new Promise((r) => setTimeout(r, 200))
  }
}

export function startCall(userId: string, kind: CallKind) {
  const { openDm, friendIds, call } = useAppStore.getState()
  if (!friendIds.includes(userId)) return
  openDm(userId)
  void (async () => {
    if (call.status === 'active' && call.alone && call.peerId === userId) {
      void callManager.reinvite(userId, kind)
      return
    }
    await ensureSingleCall()
    void callManager.invite(userId, kind)
  })()
}

export async function joinVoiceChannel(serverId: string, channelId: string, members: string[]) {
  const { call } = useAppStore.getState()
  // Já está no mesmo canal — não reinicia a malha (evita derrubar os outros).
  if (call.channelId === channelId && call.status !== 'idle') {
    useAppStore.setState((s) => ({ call: { ...s.call, serverId } }))
    return
  }
  if (call.status !== 'idle') {
    await ensureSingleCall()
  }
  useAppStore.setState((s) => ({
    call: { ...s.call, serverId },
  }))
  await callManager.joinChannel(channelId, members)
}

export { AVATAR_COLORS }
