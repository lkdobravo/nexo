export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline'

export type PrismaTier = 'none' | 'basic' | 'full'

export type FriendRelation = 'none' | 'friends' | 'incoming' | 'outgoing'

export type ProfileConnectionPlatform = 'tiktok' | 'youtube' | 'twitch' | 'twitter' | 'custom'

export interface ProfileConnection {
  id: string
  platform: ProfileConnectionPlatform
  label: string
  handle: string
  url?: string
  stat?: string
}

export type ProfileWidgetType = 'favorite_game' | 'collection' | 'text'

export interface ProfileWidget {
  id: string
  type: ProfileWidgetType
  title: string
  subtitle?: string
  gameName?: string
  gameImage?: string
  gameDescription?: string
  tags?: string[]
}

export interface ProfileBoardData {
  activityText?: string
  connections: ProfileConnection[]
  widgets: ProfileWidget[]
}

export interface User {
  id: string
  username: string
  name: string
  tag: string
  color: string
  status: PresenceStatus
  joinedAt: number
  bio?: string
  avatar?: string
  banner?: string
  profileTheme?: string
  customStatus?: string
  prismaTier?: PrismaTier
  isAdmin?: boolean
  boostCredits?: number
  relation?: FriendRelation
  profileBoard?: ProfileBoardData
}

export type MessageKind = 'text' | 'call' | 'system'

export interface CallMeta {
  durationMs?: number
  missed?: boolean
  media: 'audio' | 'video' | 'screen'
}

export interface ChatMessage {
  id: string
  conversationId: string
  authorId: string
  content: string
  createdAt: number
  kind: MessageKind
  image?: string
  call?: CallMeta
}

export type VoiceMod = 'off' | 'woman' | 'baby' | 'robot' | 'squirrel' | 'demon'

export type CallKind = 'audio' | 'video'

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

export interface CallState {
  status: CallPhase
  kind: CallKind
  peerId: string | null
  incomingFrom: string | null
  incomingKind: CallKind
  channelId: string | null
  serverId: string | null
  muted: boolean
  deafened: boolean
  cameraOn: boolean
  screenOn: boolean
  remoteCamera: boolean
  remoteScreen: boolean
  startedAt: number | null
  connection: string
  error: string | null
  mediaTick: number
  peerIds: string[]
  /** Estado de voz remoto por userId */
  peerMuted: Record<string, boolean>
  peerDeafened: Record<string, boolean>
  /** Sala DM aberta — peer saiu mas você permanece na ligação */
  alone?: boolean
  /** Você saiu da mídia mas a sala continua aberta para reconectar */
  leftCall?: boolean
  voiceFx: VoiceMod
  /** Redução de ruído no microfone (foco na voz). */
  noiseReduction: boolean
}

export type ChannelType = 'text' | 'voice'

export interface Channel {
  id: string
  name: string
  type: ChannelType
}

export interface Server {
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

/** @deprecated use Server */
export type Community = Server

export type AppView =
  | { kind: 'friends' }
  | { kind: 'dm'; userId: string }
  | { kind: 'channel'; serverId: string; channelId: string }

export type VideoQuality = '360p' | '480p' | '720p' | '1080p'

export type VideoFps = 12 | 15 | 24 | 30 | 60

export interface Devices {
  micId: string
  speakerId: string
  camId: string
}

export interface MediaPrefs {
  videoQuality: VideoQuality
  fps: VideoFps
}

export interface AuthPayload {
  ok?: boolean
  token?: string
  user?: User
  friends?: User[]
  incoming?: User[]
  outgoing?: User[]
  servers?: Server[]
  recentDms?: string[]
  error?: string
  accepted?: boolean
  already?: boolean
  relation?: FriendRelation
}

export const VIDEO_PRESETS: Record<VideoQuality, { width: number; height: number; maxBitrate: number }> = {
  '360p': { width: 640, height: 360, maxBitrate: 400_000 },
  '480p': { width: 854, height: 480, maxBitrate: 800_000 },
  '720p': { width: 1280, height: 720, maxBitrate: 1_500_000 },
  '1080p': { width: 1920, height: 1080, maxBitrate: 3_000_000 },
}
