import type {
  ProfileBoardData,
  ProfileConnection,
  ProfileConnectionPlatform,
  ProfileWidget,
  ProfileWidgetType,
} from '../types'

export type { ProfileBoardData, ProfileConnection, ProfileConnectionPlatform, ProfileWidget, ProfileWidgetType }

export function defaultProfileBoard(): ProfileBoardData {
  return {
    activityText: '',
    connections: [],
    widgets: [
      {
        id: 'favorite-game',
        type: 'favorite_game',
        title: 'Favorite Game',
        subtitle: 'Choose 1 game',
        gameName: '',
        gameDescription: 'I let everyone know why this is your favorite',
        tags: [],
      },
    ],
  }
}

export function parseProfileBoard(raw?: unknown): ProfileBoardData {
  if (!raw || typeof raw !== 'object') return defaultProfileBoard()
  const data = raw as Partial<ProfileBoardData>
  const widgets = Array.isArray(data.widgets) && data.widgets.length
    ? data.widgets.map((w, i) => ({
        id: w.id || `widget-${i}`,
        type: (w.type || 'favorite_game') as ProfileWidgetType,
        title: w.title || 'Widget',
        subtitle: w.subtitle,
        gameName: w.gameName,
        gameImage: w.gameImage,
        gameDescription: w.gameDescription,
        tags: Array.isArray(w.tags) ? w.tags : [],
      }))
    : defaultProfileBoard().widgets
  const connections = Array.isArray(data.connections)
    ? data.connections.map((c, i) => ({
        id: c.id || `conn-${i}`,
        platform: (c.platform || 'custom') as ProfileConnectionPlatform,
        label: c.label || 'Link',
        handle: c.handle || '',
        url: c.url,
        stat: c.stat,
      }))
    : []
  return {
    activityText: typeof data.activityText === 'string' ? data.activityText : '',
    connections,
    widgets,
  }
}

export function profileNoteKey(viewerId: string, targetId: string) {
  return `nexo.profileNote.${viewerId}.${targetId}`
}

export function loadProfileNote(viewerId: string, targetId: string) {
  try {
    return localStorage.getItem(profileNoteKey(viewerId, targetId)) || ''
  } catch {
    return ''
  }
}

export function saveProfileNote(viewerId: string, targetId: string, note: string) {
  try {
    const key = profileNoteKey(viewerId, targetId)
    if (note.trim()) localStorage.setItem(key, note.trim())
    else localStorage.removeItem(key)
  } catch {
    /* */
  }
}

export function connectionIcon(platform: ProfileConnectionPlatform) {
  if (platform === 'tiktok') return '🎵'
  if (platform === 'youtube') return '▶'
  if (platform === 'twitch') return '🟣'
  if (platform === 'twitter') return '𝕏'
  return '🔗'
}

export function boardForUser(user: { profileBoard?: ProfileBoardData }) {
  return parseProfileBoard(user.profileBoard)
}
