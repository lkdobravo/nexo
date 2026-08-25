import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Copy,
  Eye,
  Hash,
  Headphones,
  HelpCircle,
  Inbox,
  LogOut,
  Mic,
  MicOff,
  Monitor,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Settings,
  Smile,
  Trash2,
  UserPlus,
  Users,
  Check,
  Video,
  Volume2,
  X,
} from 'lucide-react'
import { AVATAR_COLORS, dmConversationId, initialFromName } from '../lib/ids'
import { limitsOf } from '../lib/prisma'
import { profileBannerStyle } from '../lib/profileBanner'
import { callManager } from '../lib/webrtc'
import { requestScreenShareToggle } from '../lib/screenShareUi'
import { joinVoiceChannel, startCall, useAppStore } from '../store'
import type { ChatMessage, User } from '../types'
import { Avatar } from './Avatar'
import { AvatarStatusBadges } from './AvatarStatusBadges'
import { CallAudioSink } from './CallMedia'
import { CallStage } from './CallStage'
import { ImageLightbox } from './ImageLightbox'
import { IncomingCall } from './IncomingCall'
import { PrivateCallLobby } from './PrivateCallLobby'
import { SelfProfilePopover } from './SelfProfilePopover'
import { VoiceConnectedPanel } from './VoiceConnectedPanel'
import { SettingsModal } from './SettingsModal'
import { UserBadges } from './UserBadges'
import { ExpandedProfileModal } from './ExpandedProfileModal'
import { UserProfileCard } from './UserProfileCard'

const EMOJIS = ['😀', '😂', '🥰', '😎', '🔥', '✨', '🎉', '👍', '❤️', '😮', '😢', '👏']

function statusLabel(s: User['status']) {
  if (s === 'online') return 'Online'
  if (s === 'idle') return 'Ausente'
  if (s === 'dnd') return 'Não perturbe'
  return 'Offline'
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function youtubeId(url: string) {
  return url.match(/(?:youtu\.be\/|v=|shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null
}

function firstUrl(text: string) {
  return text.match(/https?:\/\/[^\s]+/)?.[0]
}

function findUser(users: User[], me: User | null, id: string) {
  if (me?.id === id) return me
  return users.find((u) => u.id === id) ?? null
}

export function Shell() {
  const me = useAppStore((s) => s.me)!
  const users = useAppStore((s) => s.users)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const openDms = useAppStore((s) => s.openDms)
  const openDm = useAppStore((s) => s.openDm)
  const archiveDm = useAppStore((s) => s.archiveDm)
  const messages = useAppStore((s) => s.messages)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const typing = useAppStore((s) => s.typing)
  const setTyping = useAppStore((s) => s.setTyping)
  const unread = useAppStore((s) => s.unread)
  const profileOpen = useAppStore((s) => s.profileOpen)
  const toggleProfile = useAppStore((s) => s.toggleProfile)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const toggleSearch = useAppStore((s) => s.toggleSearch)
  const searchOpen = useAppStore((s) => s.searchOpen)
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)
  const call = useAppStore((s) => s.call)
  const voiceMembers = useAppStore((s) => s.voiceMembers)
  const connected = useAppStore((s) => s.connected)
  const friendIds = useAppStore((s) => s.friendIds)
  const incoming = useAppStore((s) => s.incoming)
  const servers = useAppStore((s) => s.servers)
  const railDms = useAppStore((s) => s.railDms)
  const serverModal = useAppStore((s) => s.serverModal)
  const setServerModal = useAppStore((s) => s.setServerModal)
  const createServer = useAppStore((s) => s.createServer)
  const joinServer = useAppStore((s) => s.joinServer)
  const leaveServer = useAppStore((s) => s.leaveServer)
  const createChannel = useAppStore((s) => s.createChannel)
  const updateProfile = useAppStore((s) => s.updateProfile)
  const clearRailDm = useAppStore((s) => s.clearRailDm)

  const [draft, setDraft] = useState('')
  const [emoji, setEmoji] = useState(false)
  const [home, setHome] = useState(view.kind !== 'channel')
  const [selectedServerId, setSelectedServerId] = useState<string | null>(
    view.kind === 'channel' ? view.serverId : null,
  )
  const [profileSelf, setProfileSelf] = useState(false)
  const [presentExpanded, setPresentExpanded] = useState(false)
  const [serverName, setServerName] = useState('')
  const [serverColor, setServerColor] = useState(AVATAR_COLORS[0])
  const [inviteCode, setInviteCode] = useState('')
  const [channelName, setChannelName] = useState('')
  const [channelType, setChannelType] = useState<'text' | 'voice'>('text')
  const [copied, setCopied] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ url: string; name: string } | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [profileCard, setProfileCard] = useState<{ user: User; anchorRect: DOMRect | null } | null>(null)
  const [selfProfileRect, setSelfProfileRect] = useState<DOMRect | null>(null)
  const [expandedProfile, setExpandedProfile] = useState<User | null>(null)
  const userbarRef = useRef<HTMLButtonElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<number | null>(null)

  const others = users.filter((u) => u.id !== me.id)
  const friends = others.filter((u) => friendIds.includes(u.id))
  const dmPeer = view.kind === 'dm' ? findUser(users, me, view.userId) : null
  const activeServerId =
    view.kind === 'channel' ? view.serverId : selectedServerId
  const server = servers.find((s) => s.id === activeServerId) || null
  const channel =
    view.kind === 'channel' ? server?.channels.find((c) => c.id === view.channelId) : null
  const conversationId =
    view.kind === 'dm' && dmPeer
      ? dmConversationId(me.id, dmPeer.id)
      : view.kind === 'channel'
        ? view.channelId
        : ''
  useEffect(() => {
    if (!call.screenOn && !call.remoteScreen) setPresentExpanded(false)
  }, [call.screenOn, call.remoteScreen])

  const thread = messages[conversationId] || []

  const inPrivateCall = call.status !== 'idle' && !call.channelId
  const privateCallPeer = findUser(users, me, call.peerId || call.incomingFrom || '')

  const voiceChannel =
    call.channelId && call.serverId
      ? servers
          .find((s) => s.id === call.serverId)
          ?.channels.find((c) => c.id === call.channelId)
      : call.channelId
        ? servers.flatMap((s) => s.channels).find((c) => c.id === call.channelId)
        : null

  const inVoiceChannel = call.status !== 'idle' && Boolean(call.channelId)
  const viewingVoiceChannel =
    inVoiceChannel && view.kind === 'channel' && call.channelId === view.channelId
  const viewingPrivateCallDm =
    inPrivateCall &&
    view.kind === 'dm' &&
    dmPeer &&
    (call.peerId === dmPeer.id || call.incomingFrom === dmPeer.id)

  const showPrivateCallStage = viewingPrivateCallDm && !call.leftCall

  const showPrivateCallLobby = viewingPrivateCallDm && call.leftCall

  const showCallStage =
    showPrivateCallStage || viewingVoiceChannel || (inVoiceChannel && !home)
  const showCompactVoiceStage = inVoiceChannel && !viewingVoiceChannel && !inPrivateCall
  const hideChatWelcome = showPrivateCallLobby || showCallStage || showCompactVoiceStage

  const inDmCall =
    view.kind === 'dm' &&
    dmPeer &&
    inPrivateCall &&
    (call.peerId === dmPeer.id || call.incomingFrom === dmPeer.id)

  const callPeer =
    privateCallPeer ||
    dmPeer ||
    findUser(users, me, call.peerId || call.incomingFrom || call.peerIds[0] || '')

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [thread.length, conversationId])

  useEffect(() => {
    if (view.kind === 'channel') {
      setHome(false)
      setSelectedServerId(view.serverId)
    } else if (view.kind === 'friends' || view.kind === 'dm') {
      if (view.kind === 'friends') setHome(true)
    }
  }, [view])

  const filteredDms = useMemo(() => {
    const q = query.trim().toLowerCase()
    return openDms
      .map((id) => findUser(users, me, id))
      .filter((u): u is User => Boolean(u))
      .filter((u) => !q || u.name.toLowerCase().includes(q))
  }, [openDms, users, me, query])

  function send(image?: string) {
    if (!conversationId) return
    const img = image ?? pendingImage?.url ?? undefined
    sendMessage(conversationId, draft, img)
    setDraft('')
    setPendingImage(null)
    setEmoji(false)
    setTyping(conversationId, false)
  }

  function loadPendingImage(file: File) {
    const reader = new FileReader()
    reader.onload = () =>
      setPendingImage({ url: String(reader.result), name: file.name || 'imagem.png' })
    reader.readAsDataURL(file)
  }

  function onDraft(value: string) {
    setDraft(value)
    if (!conversationId) return
    setTyping(conversationId, true)
    if (typingTimer.current) window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => setTyping(conversationId, false), 1200)
  }

  const whoTyping = (typing[conversationId] || [])
    .map((id) => findUser(users, me, id)?.name)
    .filter(Boolean)

  function openServer(s: (typeof servers)[0]) {
    setHome(false)
    setSelectedServerId(s.id)
    const first = s.channels.find((ch) => ch.type === 'text') || s.channels[0]
    if (first) setView({ kind: 'channel', serverId: s.id, channelId: first.id })
  }

  function goToActiveCall() {
    if (call.channelId && call.serverId) {
      setHome(false)
      setSelectedServerId(call.serverId)
      setView({ kind: 'channel', serverId: call.serverId, channelId: call.channelId })
      return
    }
    const peerId = call.peerId || call.incomingFrom
    if (peerId && call.status !== 'idle' && !call.channelId) {
      openDm(peerId)
    }
  }

  const voiceConnectedLabel = call.channelId
    ? voiceChannel?.name || 'Canal de voz'
    : call.leftCall
      ? `${callPeer?.name || 'Ligação privada'} · Toque para voltar`
      : call.alone
        ? `${callPeer?.name || 'Ligação privada'} · Aguardando…`
        : callPeer?.name || 'Ligação privada'

  function copyInvite() {
    if (!server?.inviteCode) return
    void navigator.clipboard.writeText(server.inviteCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  function openProfileCard(user: User, e?: MouseEvent) {
    e?.stopPropagation()
    setExpandedProfile(null)
    const anchorRect =
      e?.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : null
    setProfileCard((cur) =>
      cur?.user.id === user.id ? null : { user, anchorRect },
    )
  }

  function openExpandedProfile(user: User) {
    setProfileCard(null)
    setSelfProfileRect(null)
    setExpandedProfile(user)
  }

  const showProfile =
    profileOpen && ((view.kind === 'dm' && dmPeer) || profileSelf)

  return (
    <div className="app">
      <nav className="rail" aria-label="Servidores">
        <button
          className={`rail-btn rail-home ${home ? 'on' : ''}`}
          title="Início"
          onClick={() => {
            setHome(true)
            setSelectedServerId(null)
            setView({ kind: 'friends' })
          }}
        >
          <span className="pill" />
          <Users size={22} />
        </button>

        {railDms.length > 0 ? (
          <>
            <div className="rail-sep" />
            {railDms.map((userId) => {
              const u = findUser(users, me, userId)
              if (!u) return null
              const n = unread[dmConversationId(me.id, u.id)] || 0
              return (
                <button
                  key={u.id}
                  className={`rail-btn rail-dm ${view.kind === 'dm' && view.userId === u.id ? 'on' : ''}`}
                  title={u.name}
                  onClick={() => {
                    openDm(u.id)
                    clearRailDm(u.id)
                    setHome(true)
                  }}
                >
                  <span className="pill" />
                  <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="md" />
                  {n > 0 ? <span className="badge">{n > 9 ? '9+' : n}</span> : null}
                </button>
              )
            })}
          </>
        ) : null}

        <div className="rail-sep" />
        {servers.map((s) => (
          <button
            key={s.id}
            className={`rail-btn ${!home && server?.id === s.id ? 'on' : ''}`}
            title={s.name}
            style={{ background: s.color }}
            onClick={() => openServer(s)}
          >
            <span className="pill" />
            {s.initial || initialFromName(s.name)}
          </button>
        ))}
        <button
          className="rail-btn"
          title="Adicionar servidor"
          onClick={() => setServerModal('create')}
        >
          <Plus size={22} />
        </button>
      </nav>

      <aside className="sidebar">
        <button className="search-btn" onClick={toggleSearch}>
          Encontre ou comece uma conversa
        </button>
        {home ? (
          <>
            <button
              className={`nav-item ${view.kind === 'friends' ? 'on' : ''}`}
              onClick={() => setView({ kind: 'friends' })}
            >
              <Users size={18} /> Amigos
              {incoming.length > 0 ? (
                <span className="badge" style={{ position: 'static', marginLeft: 'auto' }}>
                  {incoming.length}
                </span>
              ) : null}
            </button>
            <button className="nav-item" disabled>
              <Inbox size={18} /> Pedidos de mensagem
            </button>
            <div className="section-label">
              Mensagens diretas <Plus size={14} />
            </div>
            <div className="dm-list">
              {filteredDms.map((u) => {
                const cid = dmConversationId(me.id, u.id)
                const n = unread[cid] || 0
                return (
                  <button
                    key={u.id}
                    className={`dm-item ${view.kind === 'dm' && view.userId === u.id ? 'on' : ''}`}
                    onClick={() => openDm(u.id)}
                  >
                    <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="md" />
                    <span className="dm-name">{u.name}</span>
                    {n > 0 ? (
                      <span className="badge" style={{ position: 'static' }}>
                        {n}
                      </span>
                    ) : null}
                    <span
                      className="x"
                      title="Arquivar conversa"
                      onClick={(e) => {
                        e.stopPropagation()
                        archiveDm(u.id)
                      }}
                    >
                      <X size={14} />
                    </span>
                  </button>
                )
              })}
              {friends.length === 0 ? (
                <p className="empty">Adicione um amigo para começar a conversar.</p>
              ) : null}
            </div>
          </>
        ) : server ? (
          <>
            <div className="server-head">
              <div className="section-label" style={{ paddingTop: 12 }}>
                {server.name}
              </div>
              <button className="invite-chip" type="button" onClick={copyInvite} title="Copiar convite">
                <Copy size={12} />
                {copied ? 'Copiado!' : server.inviteCode}
              </button>
            </div>
            <div className="ch-list">
              {server.channels.map((ch) => {
                const n = unread[ch.id] || 0
                const members = voiceMembers[ch.id] || []
                return (
                  <div key={ch.id}>
                    <button
                      className={`ch-item ${view.kind === 'channel' && view.channelId === ch.id ? 'on' : ''}`}
                      onClick={() => {
                        setView({ kind: 'channel', serverId: server.id, channelId: ch.id })
                        if (ch.type === 'voice') {
                          void joinVoiceChannel(server.id, ch.id, members)
                        }
                      }}
                    >
                      {ch.type === 'voice' ? <Volume2 size={16} /> : <Hash size={16} />}
                      <span className="dm-name">{ch.name}</span>
                      {n > 0 ? <span className="ch-unread">{n > 9 ? '9+' : n}</span> : null}
                    </button>
                    {members.map((id) => {
                      const u = findUser(users, me, id)
                      if (!u) return null
                      const isMe = u.id === me.id
                      const muted = isMe ? call.muted : call.peerMuted[id]
                      const deafened = isMe ? call.deafened : call.peerDeafened[id]
                      return (
                        <div key={id} className="ch-item voice-member">
                          <div className="voice-av">
                            <Avatar name={u.name} color={u.color} avatar={u.avatar} size="sm" status={u.status} />
                            <AvatarStatusBadges muted={muted} deafened={deafened} size="sm" />
                          </div>
                          {u.name}
                          {isMe ? ' (você)' : ''}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div className="server-actions">
              <button type="button" className="server-action" onClick={() => setServerModal('channel')}>
                <Plus size={14} /> Criar canal
              </button>
              <button
                type="button"
                className="server-action danger"
                onClick={() => {
                  leaveServer(server.id)
                  setHome(true)
                  setSelectedServerId(null)
                }}
              >
                <LogOut size={14} /> Sair do servidor
              </button>
            </div>
          </>
        ) : (
          <p className="empty">Selecione ou crie um servidor.</p>
        )}

        {call.status !== 'idle' ? (
          <VoiceConnectedPanel
            channelLabel={voiceConnectedLabel}
            muted={call.muted}
            deafened={call.deafened}
            cameraOn={call.cameraOn}
            screenOn={call.screenOn}
            onNavigate={goToActiveCall}
            onCamera={() => void callManager.toggleCamera()}
            onScreenShare={() =>
              requestScreenShareToggle(call.screenOn, () => callManager.stopScreen())
            }
            onDisconnect={() => callManager.disconnect()}
          />
        ) : null}

        <div className={`userbar ${call.status !== 'idle' ? 'in-call' : ''}`}>
          <button
            type="button"
            ref={userbarRef}
            className="userbar-me"
            onClick={(e) => {
              e.stopPropagation()
              const rect = userbarRef.current?.getBoundingClientRect()
              setSelfProfileRect((cur) => (cur ? null : rect || null))
            }}
          >
            <Avatar name={me.name} color={me.color} avatar={me.avatar} status={me.status} size="md" />
            <div className="who">
              <b>{me.name}</b>
              <span>
                {call.status !== 'idle'
                  ? call.channelId
                    ? 'Em uma chamada'
                    : 'Em ligação'
                  : connected
                    ? `@${me.username}`
                    : 'Conectando…'}
              </span>
            </div>
          </button>
          <button
            className={`icon-btn ${call.muted ? 'danger' : ''}`}
            title="Microfone"
            onClick={() => callManager.setMuted(!call.muted)}
          >
            {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            className={`icon-btn ${call.deafened ? 'danger' : ''}`}
            title="Áudio"
            onClick={() => callManager.setDeafened(!call.deafened)}
          >
            <Headphones size={18} />
          </button>
          <button className="icon-btn" title="Configurações" onClick={toggleSettings}>
            <Settings size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        {view.kind === 'friends' ? (
          <div className="main-panel">
            <Friends onUserClick={openProfileCard} />
          </div>
        ) : (
          <div className={`main-panel ${presentExpanded ? 'present-focus' : ''}`}>
            <header className="topbar">
              {view.kind === 'dm' && dmPeer ? (
                <>
                  <button
                    type="button"
                    className="dm-peer-head"
                    onClick={(e) => openProfileCard(dmPeer, e)}
                    title="Ver perfil"
                  >
                    <Avatar name={dmPeer.name} color={dmPeer.color} avatar={dmPeer.avatar} status={dmPeer.status} size="sm" />
                    <b>{dmPeer.name}</b>
                  </button>
                  {inDmCall ? (
                    <span className="dm-in-call-pill">
                      <Phone size={12} /> Em ligação
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  {channel?.type === 'voice' ? <Volume2 size={18} /> : <Hash size={18} />}
                  <b>{channel?.name || server?.name}</b>
                </>
              )}
              <span className="grow" />
              {view.kind === 'dm' && dmPeer ? (
                <>
                  <button
                    className="icon-btn"
                    title="Chamada de voz"
                    onClick={() =>
                      inPrivateCall &&
                      (call.peerId === dmPeer.id || call.incomingFrom === dmPeer.id)
                        ? callManager.disconnect()
                        : startCall(dmPeer.id, 'audio')
                    }
                  >
                    {inPrivateCall &&
                    (call.peerId === dmPeer.id || call.incomingFrom === dmPeer.id) ? (
                      <PhoneOff size={18} />
                    ) : (
                      <Phone size={18} />
                    )}
                  </button>
                  <button
                    className="icon-btn"
                    title="Chamada de vídeo"
                    onClick={() => startCall(dmPeer.id, 'video')}
                  >
                    <Video size={18} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Compartilhar tela"
                    onClick={() => {
                      if (call.status === 'idle') startCall(dmPeer.id, 'audio')
                      window.setTimeout(
                        () => requestScreenShareToggle(false, () => callManager.stopScreen()),
                        call.status === 'idle' ? 800 : 0,
                      )
                    }}
                  >
                    <Monitor size={18} />
                  </button>
                </>
              ) : null}
              <button className="icon-btn" title="Fixadas" disabled>
                <Pin size={18} />
              </button>
              <button
                className="icon-btn"
                title="Perfil"
                onClick={() => {
                  setProfileSelf(false)
                  toggleProfile()
                }}
              >
                <UserPlus size={18} />
              </button>
              <input
                className="chat-search"
                placeholder="Buscar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="icon-btn" title="Ajuda" disabled>
                <HelpCircle size={18} />
              </button>
            </header>

            {showPrivateCallLobby && dmPeer ? (
              <PrivateCallLobby peer={dmPeer} />
            ) : showCallStage || showCompactVoiceStage ? (
              <CallStage
                peer={callPeer}
                inDm={view.kind === 'dm'}
                onCallMenuOpen={() => {
                  setProfileCard(null)
                  setExpandedProfile(null)
                }}
                onEditSelfProfile={() => me && openExpandedProfile(me)}
                onViewProfile={(user) => openExpandedProfile(user)}
                presentExpanded={presentExpanded}
                onPresentExpandedChange={setPresentExpanded}
              />
            ) : null}

            <div className="messages" ref={scroller}>
              {!hideChatWelcome ? (
              <div className="welcome">
                {view.kind === 'dm' && dmPeer ? (
                  <>
                    <Avatar name={dmPeer.name} color={dmPeer.color} avatar={dmPeer.avatar} size="xl" />
                    <h2>{dmPeer.name}</h2>
                    <p>Este é o começo do seu histórico de mensagens diretas com @{dmPeer.username}.</p>
                  </>
                ) : (
                  <>
                    <h2>
                      {channel?.type === 'voice' ? '' : '#'}
                      {channel?.name}
                    </h2>
                    <p>
                      {channel?.type === 'voice'
                        ? `Canal de voz ${channel?.name}. Clique para entrar na chamada.`
                        : `Este é o início do canal ${channel?.name}.`}
                    </p>
                  </>
                )}
              </div>
              ) : null}
              {thread.map((msg, i) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  author={findUser(users, me, msg.authorId)}
                  showDate={i === 0 || !sameDay(thread[i - 1].createdAt, msg.createdAt)}
                  onOpenImage={setLightboxSrc}
                  onOpenProfile={openProfileCard}
                />
              ))}
            </div>
            <div className="typing">
              {whoTyping.length ? `${whoTyping.join(', ')} está digitando…` : null}
            </div>
            {channel?.type === 'voice' ? null : (
              <div className="composer" style={{ position: 'relative' }}>
                {pendingImage ? (
                  <div className="composer-attach">
                    <div className="composer-attach-card">
                      <div className="composer-attach-thumb">
                        <img src={pendingImage.url} alt="" />
                        <div className="composer-attach-overlay">
                          <button
                            type="button"
                            title="Visualizar"
                            onClick={() => setLightboxSrc(pendingImage.url)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            className="danger"
                            title="Remover"
                            onClick={() => setPendingImage(null)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <span className="composer-attach-name">{pendingImage.name}</span>
                    </div>
                  </div>
                ) : null}
                <button
                  className="icon-btn"
                  title="Anexar imagem"
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/*,image/gif'
                    input.onchange = () => {
                      const file = input.files?.[0]
                      if (!file) return
                      loadPendingImage(file)
                    }
                    input.click()
                  }}
                >
                  <Plus size={20} />
                </button>
                <textarea
                  rows={1}
                  maxLength={limitsOf(me).messageChars}
                  placeholder={
                    view.kind === 'dm' && dmPeer
                      ? `Conversar com @${dmPeer.name}`
                      : `Conversar em #${channel?.name || ''}`
                  }
                  value={draft}
                  onChange={(e) => onDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  onPaste={(e) => {
                    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
                    if (!file) return
                    e.preventDefault()
                    loadPendingImage(file)
                  }}
                />
                <button className="icon-btn" title="Emoji" onClick={() => setEmoji((v) => !v)}>
                  <Smile size={20} />
                </button>
                {emoji ? (
                  <div className="emoji-pop">
                    {EMOJIS.map((em) => (
                      <button key={em} type="button" onClick={() => onDraft(draft + em)}>
                        {em}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </main>

      {lightboxSrc ? <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} /> : null}

      {showProfile ? (
        <div
          className="profile-modal-back"
          onClick={() => {
            setProfileSelf(false)
            if (profileOpen) toggleProfile()
          }}
        >
          <div className="profile-modal-panel" onClick={(e) => e.stopPropagation()}>
            {profileSelf ? (
              <SelfProfile
                me={me}
                onClose={() => {
                  setProfileSelf(false)
                  if (profileOpen) toggleProfile()
                }}
                onSave={(patch) => {
                  updateProfile(patch)
                }}
              />
            ) : dmPeer ? (
              <Profile
                user={dmPeer}
                sharedServers={servers.filter((s) => s.memberIds.includes(dmPeer.id)).length}
                onClose={() => toggleProfile()}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="modal-back" onClick={toggleSearch}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Buscar conversas</h2>
            <div className="body">
              <input
                autoFocus
                placeholder="Nome da pessoa"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {friends
                .filter(
                  (u) =>
                    u.name.toLowerCase().includes(query.toLowerCase()) ||
                    u.username.includes(query.toLowerCase()),
                )
                .map((u) => (
                  <button
                    key={u.id}
                    className="friend-row"
                    onClick={() => {
                      openDm(u.id)
                      toggleSearch()
                    }}
                  >
                    <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} />
                    <div className="grow">
                      <b>{u.name}</b>
                      <span>@{u.username}</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {serverModal ? (
        <div className="modal-back" onClick={() => setServerModal(null)}>
          <div className="modal server-modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {serverModal === 'create'
                ? 'Criar servidor'
                : serverModal === 'join'
                  ? 'Entrar com convite'
                  : 'Criar canal'}
            </h2>
            <div className="body">
              {serverModal === 'create' ? (
                <>
                  <label htmlFor="srv-name">Nome</label>
                  <input
                    id="srv-name"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="Meu servidor"
                    autoFocus
                  />
                  <label>Cor</label>
                  <div className="swatches">
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`swatch ${serverColor === c ? 'on' : ''}`}
                        style={{ background: c }}
                        onClick={() => setServerColor(c)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="full-btn brand"
                    disabled={!serverName.trim()}
                    onClick={() => {
                      createServer(serverName.trim(), serverColor)
                      setServerName('')
                    }}
                  >
                    Criar
                  </button>
                  <button type="button" className="full-btn" onClick={() => setServerModal('join')}>
                    Já tenho um convite
                  </button>
                </>
              ) : null}
              {serverModal === 'join' ? (
                <>
                  <label htmlFor="invite">Código do convite</label>
                  <input
                    id="invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="ABC123"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="full-btn brand"
                    disabled={!inviteCode.trim()}
                    onClick={() => {
                      joinServer(inviteCode.trim())
                      setInviteCode('')
                    }}
                  >
                    Entrar
                  </button>
                  <button type="button" className="full-btn" onClick={() => setServerModal('create')}>
                    Criar servidor novo
                  </button>
                </>
              ) : null}
              {serverModal === 'channel' && server ? (
                <>
                  <label htmlFor="ch-name">Nome do canal</label>
                  <input
                    id="ch-name"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="geral"
                    autoFocus
                  />
                  <label htmlFor="ch-type">Tipo</label>
                  <select
                    id="ch-type"
                    value={channelType}
                    onChange={(e) => setChannelType(e.target.value as 'text' | 'voice')}
                  >
                    <option value="text">Texto</option>
                    <option value="voice">Voz</option>
                  </select>
                  <button
                    type="button"
                    className="full-btn brand"
                    disabled={!channelName.trim()}
                    onClick={() => {
                      createChannel(server.id, channelName.trim(), channelType)
                      setChannelName('')
                      setChannelType('text')
                    }}
                  >
                    Criar canal
                  </button>
                </>
              ) : null}
              <button type="button" className="full-btn" onClick={() => setServerModal(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CallAudioSink />
      <IncomingCall />
      {profileCard ? (
        <UserProfileCard
          user={profileCard.user}
          anchorRect={profileCard.anchorRect}
          onClose={() => setProfileCard(null)}
          onExpandProfile={() => openExpandedProfile(profileCard.user)}
        />
      ) : null}
      {selfProfileRect ? (
        <SelfProfilePopover
          user={me}
          anchorRect={selfProfileRect}
          ignoreRef={userbarRef}
          onClose={() => setSelfProfileRect(null)}
          onExpandProfile={() => openExpandedProfile(me)}
          onOpenSettings={() => {
            setSelfProfileRect(null)
            toggleSettings()
          }}
        />
      ) : null}
      {expandedProfile ? (
        <ExpandedProfileModal
          user={expandedProfile}
          onClose={() => setExpandedProfile(null)}
          onEditSettings={() => {
            setExpandedProfile(null)
            toggleSettings()
          }}
        />
      ) : null}
      <SettingsModal />
    </div>
  )
}

function Friends({ onUserClick }: { onUserClick?: (user: User, e: MouseEvent) => void }) {
  const users = useAppStore((s) => s.users)
  const friendIds = useAppStore((s) => s.friendIds)
  const incoming = useAppStore((s) => s.incoming)
  const outgoing = useAppStore((s) => s.outgoing)
  const results = useAppStore((s) => s.searchResults)
  const hint = useAppStore((s) => s.friendHint)
  const searchPeople = useAppStore((s) => s.searchPeople)
  const addFriend = useAppStore((s) => s.addFriend)
  const acceptFriend = useAppStore((s) => s.acceptFriend)
  const declineFriend = useAppStore((s) => s.declineFriend)
  const openDm = useAppStore((s) => s.openDm)
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'add'>('all')
  const [addQuery, setAddQuery] = useState('')

  const friends = users.filter((u) => friendIds.includes(u.id))
  const online = friends.filter((u) => u.status !== 'offline')
  const shown = tab === 'online' ? online : friends

  useEffect(() => {
    if (tab !== 'add') return
    const q = addQuery.trim()
    const t = window.setTimeout(() => searchPeople(q), 250)
    return () => window.clearTimeout(t)
  }, [addQuery, tab, searchPeople])

  return (
    <div className="friends-body">
      <header className="topbar">
        <Users size={18} />
        <b>Amigos</b>
        <div className="friend-tabs">
          <button type="button" className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}>
            Online
          </button>
          <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            Todos
          </button>
          <button type="button" className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>
            Pendente{incoming.length ? ` (${incoming.length})` : ''}
          </button>
          <button type="button" className={`add ${tab === 'add' ? 'on' : ''}`} onClick={() => setTab('add')}>
            Adicionar amigo
          </button>
        </div>
      </header>
      <div className="friends">
        {tab === 'add' ? (
          <>
            <h2>Adicionar amigo</h2>
            <p className="empty" style={{ padding: '0 0 16px', textAlign: 'left' }}>
              Digite o nome de usuário. Ex.: <b>ana</b>
            </p>
            <div className="add-box">
              <input
                autoFocus
                placeholder="Digite um nome de usuário"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value.replace(/\s/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && addQuery.trim()) addFriend({ username: addQuery.trim() })
                }}
              />
              <button
                type="button"
                className="friend-action brand"
                disabled={!addQuery.trim()}
                onClick={() => addFriend({ username: addQuery.trim() })}
              >
                Enviar pedido
              </button>
            </div>
            {hint ? <p className="friend-hint">{hint}</p> : null}
            {results.map((u) => (
              <div key={u.id} className="friend-row">
                <button
                  type="button"
                  className="friend-identity"
                  onClick={onUserClick ? (e) => onUserClick(u, e) : undefined}
                  disabled={!onUserClick}
                >
                  <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="lg" />
                  <div className="grow">
                    <b>{u.name}</b>
                    <span>
                      @{u.username} · {statusLabel(u.status)}
                    </span>
                  </div>
                </button>
                {u.relation === 'friends' || friendIds.includes(u.id) ? (
                  <button type="button" className="friend-action" onClick={() => openDm(u.id)}>
                    Mensagem
                  </button>
                ) : u.relation === 'outgoing' ? (
                  <span>Pedido enviado</span>
                ) : u.relation === 'incoming' ? (
                  <button type="button" className="friend-action green" onClick={() => acceptFriend(u.id)}>
                    Aceitar
                  </button>
                ) : (
                  <button type="button" className="friend-action brand" onClick={() => addFriend({ userId: u.id })}>
                    <UserPlus size={16} /> Adicionar
                  </button>
                )}
              </div>
            ))}
          </>
        ) : tab === 'pending' ? (
          <>
            <h2>Recebidos — {incoming.length}</h2>
            {incoming.length === 0 ? (
              <p className="empty">Nenhum pedido recebido.</p>
            ) : (
              incoming.map((u) => (
                <div key={u.id} className="friend-row">
                  <button
                    type="button"
                    className="friend-identity"
                    onClick={onUserClick ? (e) => onUserClick(u, e) : undefined}
                    disabled={!onUserClick}
                  >
                    <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="lg" />
                    <div className="grow">
                      <b>{u.name}</b>
                      <span>@{u.username} quer ser seu amigo</span>
                    </div>
                  </button>
                  <button type="button" className="friend-action green" onClick={() => acceptFriend(u.id)}>
                    <Check size={16} /> Aceitar
                  </button>
                  <button type="button" className="friend-action danger" onClick={() => declineFriend(u.id)}>
                    Recusar
                  </button>
                </div>
              ))
            )}
            <h2>Enviados — {outgoing.length}</h2>
            {outgoing.length === 0 ? (
              <p className="empty">Nenhum pedido enviado.</p>
            ) : (
              outgoing.map((u) => (
                <div key={u.id} className="friend-row">
                  <button
                    type="button"
                    className="friend-identity"
                    onClick={onUserClick ? (e) => onUserClick(u, e) : undefined}
                    disabled={!onUserClick}
                  >
                    <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="lg" />
                    <div className="grow">
                      <b>{u.name}</b>
                      <span>@{u.username} · aguardando</span>
                    </div>
                  </button>
                  <button type="button" className="friend-action danger" onClick={() => declineFriend(u.id)}>
                    Cancelar
                  </button>
                </div>
              ))
            )}
          </>
        ) : (
          <>
            <h2>
              {tab === 'online' ? 'Online' : 'Todos'} — {shown.length}
            </h2>
            {shown.length === 0 ? (
              <p className="empty">
                {tab === 'online'
                  ? 'Nenhum amigo online. Adicione alguém na aba Adicionar amigo.'
                  : 'Você ainda não tem amigos. Pesquise o usuário da outra pessoa e envie um pedido.'}
              </p>
            ) : (
              shown.map((u) => (
                <div key={u.id} className="friend-row">
                  <button
                    type="button"
                    className="friend-identity"
                    onClick={onUserClick ? (e) => onUserClick(u, e) : undefined}
                    disabled={!onUserClick}
                  >
                    <Avatar name={u.name} color={u.color} avatar={u.avatar} status={u.status} size="lg" />
                    <div className="grow">
                      <b>{u.name}</b>
                      <span>
                        @{u.username} · {statusLabel(u.status)}
                      </span>
                    </div>
                  </button>
                  <button className="icon-btn" title="Mensagem" onClick={() => openDm(u.id)}>
                    <Inbox size={18} />
                  </button>
                  <button className="icon-btn" title="Ligar" onClick={() => startCall(u.id, 'audio')}>
                    <Phone size={18} />
                  </button>
                  <button className="icon-btn" title="Vídeo" onClick={() => startCall(u.id, 'video')}>
                    <Video size={18} />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Profile({
  user,
  sharedServers,
  onClose,
}: {
  user: User
  sharedServers: number
  onClose?: () => void
}) {
  return (
    <aside className="profile">
      {onClose ? (
        <button type="button" className="profile-modal-close" title="Fechar" onClick={onClose}>
          <X size={16} />
        </button>
      ) : null}
      <div className="banner" style={profileBannerStyle(user)} />
      <div className="profile-card">
        <div className="av-wrap">
          <Avatar name={user.name} color={user.color} avatar={user.avatar} status={user.status} size="xl" user={user} gifMotion="always" />
        </div>
        <h3>{user.name}</h3>
        <div className="tag">
          @{user.username}
          <UserBadges user={user} />
        </div>
        {user.customStatus ? <p className="custom-status">{user.customStatus}</p> : null}
        {user.bio ? (
          <div className="panel">
            <h4>Sobre mim</h4>
            {user.bio}
          </div>
        ) : null}
        <div className="panel">
          <h4>Membro desde</h4>
          {new Date(user.joinedAt).toLocaleDateString('pt-BR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </div>
        <div className="panel">
          <h4>Servidores em comum</h4>
          {sharedServers} servidor{sharedServers === 1 ? '' : 'es'}
        </div>
      </div>
    </aside>
  )
}

function SelfProfile({
  me,
  onClose,
  onSave,
}: {
  me: User
  onClose: () => void
  onSave: (patch: { name?: string; color?: string; bio?: string }) => void
}) {
  const [name, setName] = useState(me.name)
  const [color, setColor] = useState(me.color)
  const [bio, setBio] = useState(me.bio || '')

  useEffect(() => {
    setName(me.name)
    setColor(me.color)
    setBio(me.bio || '')
  }, [me])

  return (
    <aside className="profile">
      <div className="banner" style={{ background: color }} />
      <div className="profile-card">
        <div className="av-wrap">
          <Avatar name={name || me.name} color={color} avatar={me.avatar} status={me.status} size="xl" />
        </div>
        <h3>Seu perfil</h3>
        <div className="tag">@{me.username}</div>
        <div className="panel">
          <h4>Nome de exibição</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="panel">
          <h4>Cor</h4>
          <div className="swatches">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="panel">
          <h4>Bio</h4>
          <textarea
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Conte um pouco sobre você"
          />
        </div>
      </div>
      <button
        type="button"
        className="full-btn brand"
        onClick={() => {
          onSave({ name: name.trim() || me.name, color, bio: bio.trim() })
        }}
      >
        Salvar
      </button>
      <button type="button" className="full-btn" onClick={onClose}>
        Fechar
      </button>
    </aside>
  )
}

function MessageRow({
  msg,
  author,
  showDate,
  onOpenImage,
  onOpenProfile,
}: {
  msg: ChatMessage
  author: User | null
  showDate: boolean
  onOpenImage?: (src: string) => void
  onOpenProfile?: (user: User, e: MouseEvent) => void
}) {
  const url = firstUrl(msg.content || '')
  const yt = url ? youtubeId(url) : null
  if (msg.kind === 'call') {
    return (
      <>
        {showDate ? <div className="date-sep">{formatDate(msg.createdAt)}</div> : null}
        <div className="call-log">
          <Phone size={16} />
          <span>
            {msg.call?.missed ? 'Chamada perdida' : 'Chamada encerrada'}
            {msg.call?.durationMs ? ` · ${Math.max(1, Math.round(msg.call.durationMs / 1000))}s` : ''}
            {' · '}
            {formatTime(msg.createdAt)}
          </span>
        </div>
      </>
    )
  }
  const superReact =
    author?.prismaTier === 'full' &&
    Boolean(msg.content?.trim()) &&
    !msg.image &&
    /^[\p{Extended_Pictographic}\s]+$/u.test(msg.content.trim())

  return (
    <>
      {showDate ? <div className="date-sep">{formatDate(msg.createdAt)}</div> : null}
      <article className={`msg ${superReact ? 'super-react' : ''}`}>
        <Avatar
          name={author?.name || '?'}
          color={author?.color || '#5865F2'}
          avatar={author?.avatar}
          size="md"
          user={author || undefined}
          gifMotion="hover"
          onClick={
            author && onOpenProfile ? (e) => onOpenProfile(author, e) : undefined
          }
        />
        <div className="body">
          <div className="meta">
            <b
              className={author && onOpenProfile ? 'msg-author' : undefined}
              onClick={
                author && onOpenProfile
                  ? (e) => onOpenProfile(author, e)
                  : undefined
              }
            >
              {author?.name || 'Alguém'}
            </b>
            <time>{formatTime(msg.createdAt)}</time>
          </div>
          {msg.content ? (
            <div className="text">
              {msg.content.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                part.startsWith('http') ? (
                  <a key={i} href={part} target="_blank" rel="noreferrer">
                    {part}
                  </a>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </div>
          ) : null}
          {msg.image ? (
            <div className="embed">
              <button
                type="button"
                className="embed-open"
                onClick={() => onOpenImage?.(msg.image!)}
                title="Ampliar imagem"
              >
                <img src={msg.image} alt="anexo" />
              </button>
            </div>
          ) : null}
          {yt ? (
            <div className="embed">
              <iframe
                title="YouTube"
                src={`https://www.youtube.com/embed/${yt}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ aspectRatio: '16/9', border: 0 }}
              />
            </div>
          ) : url && !yt ? (
            <div className="embed">
              <div className="cap">
                <b>{new URL(url).hostname}</b>
                <small>{url}</small>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    </>
  )
}
