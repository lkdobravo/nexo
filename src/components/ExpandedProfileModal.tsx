import { useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Plus,
  Trophy,
  X,
} from 'lucide-react'
import { profileBannerStyle } from '../lib/profileBanner'
import {
  boardForUser,
  connectionIcon,
  defaultProfileBoard,
  loadProfileNote,
  saveProfileNote,
} from '../lib/profileBoard'
import { useAppStore } from '../store'
import type { ProfileBoardData, ProfileConnection, ProfileWidget, User } from '../types'
import { Avatar } from './Avatar'
import { UserBadges } from './UserBadges'

type BoardTab = 'board' | 'activity' | 'wishlist'

function statusLabel(s: User['status']) {
  if (s === 'online') return 'Online'
  if (s === 'idle') return 'Ausente'
  if (s === 'dnd') return 'Não perturbe'
  return 'Offline'
}

function memberSince(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function WidgetCard({
  widget,
  isSelf,
  onChange,
  onRemove,
}: {
  widget: ProfileWidget
  isSelf: boolean
  onChange: (next: ProfileWidget) => void
  onRemove: () => void
}) {
  if (widget.type === 'favorite_game' || widget.type === 'collection') {
    return (
      <div className="xp-widget-card">
        <div className="xp-widget-head">
          <div>
            <h4>{widget.title}</h4>
            {widget.subtitle ? <span>{widget.subtitle}</span> : null}
          </div>
          {isSelf ? (
            <button type="button" className="xp-widget-remove" onClick={onRemove} title="Remover">
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="xp-widget-game">
          <div className="xp-widget-cover">
            {widget.gameImage ? (
              <img src={widget.gameImage} alt="" />
            ) : (
              <div className="xp-widget-cover-ph">{widget.gameName?.slice(0, 1) || 'G'}</div>
            )}
          </div>
          <div className="xp-widget-game-body">
            {isSelf ? (
              <>
                <input
                  className="xp-inline-title"
                  value={widget.gameName || ''}
                  placeholder="Nome do jogo"
                  onChange={(e) => onChange({ ...widget, gameName: e.target.value })}
                />
                <textarea
                  className="xp-inline-bio"
                  rows={3}
                  value={widget.gameDescription || ''}
                  placeholder="I let everyone know why this is your favorite"
                  onChange={(e) => onChange({ ...widget, gameDescription: e.target.value })}
                />
                <div className="xp-widget-tags">
                  {(widget.tags || []).map((tag) => (
                    <span key={tag} className="xp-tag">
                      {tag}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="xp-tag add"
                    onClick={() => {
                      const tag = window.prompt('Nova tag')
                      if (!tag?.trim()) return
                      onChange({ ...widget, tags: [...(widget.tags || []), tag.trim()] })
                    }}
                  >
                    + Tags
                  </button>
                </div>
              </>
            ) : (
              <>
                <b>{widget.gameName || 'Sem jogo'}</b>
                <p>{widget.gameDescription || 'Sem descrição.'}</p>
                <div className="xp-widget-tags">
                  {(widget.tags || []).map((tag) => (
                    <span key={tag} className="xp-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="xp-widget-card">
      <div className="xp-widget-head">
        <h4>{widget.title}</h4>
        {isSelf ? (
          <button type="button" className="xp-widget-remove" onClick={onRemove}>
            <X size={14} />
          </button>
        ) : null}
      </div>
      {isSelf ? (
        <textarea
          className="xp-inline-bio"
          rows={4}
          value={widget.gameDescription || ''}
          placeholder="Texto do widget"
          onChange={(e) => onChange({ ...widget, gameDescription: e.target.value })}
        />
      ) : (
        <p>{widget.gameDescription || ''}</p>
      )}
    </div>
  )
}

export function ExpandedProfileModal({
  user,
  onClose,
  onEditSettings,
}: {
  user: User
  onClose: () => void
  onEditSettings?: () => void
}) {
  const me = useAppStore((s) => s.me)
  const updateProfile = useAppStore((s) => s.updateProfile)
  const isSelf = user.id === me?.id
  const [tab, setTab] = useState<BoardTab>('board')
  const [board, setBoard] = useState<ProfileBoardData>(() => boardForUser(user))
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setBoard(boardForUser(user))
    setDirty(false)
  }, [user])

  useEffect(() => {
    if (!me || isSelf) return
    setNote(loadProfileNote(me.id, user.id))
  }, [me, user.id, isSelf])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const collectionWidget = useMemo(
    () => board.widgets.find((w) => w.type === 'collection' || w.type === 'favorite_game'),
    [board.widgets],
  )

  function patchBoard(next: ProfileBoardData) {
    setBoard(next)
    setDirty(true)
  }

  function saveBoard() {
    updateProfile({ profileBoard: board })
    setDirty(false)
  }

  function updateWidget(id: string, next: ProfileWidget) {
    patchBoard({
      ...board,
      widgets: board.widgets.map((w) => (w.id === id ? next : w)),
    })
  }

  function removeWidget(id: string) {
    patchBoard({
      ...board,
      widgets: board.widgets.filter((w) => w.id !== id),
    })
  }

  function addWidget() {
    const id = crypto.randomUUID()
    patchBoard({
      ...board,
      widgets: [
        ...board.widgets,
        {
          id,
          type: 'favorite_game',
          title: 'Favorite Game',
          subtitle: 'Choose 1 game',
          gameName: '',
          gameDescription: '',
          tags: [],
        },
      ],
    })
  }

  function updateConnection(id: string, patch: Partial<ProfileConnection>) {
    patchBoard({
      ...board,
      connections: board.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  function addConnection() {
    patchBoard({
      ...board,
      connections: [
        ...board.connections,
        {
          id: crypto.randomUUID(),
          platform: 'custom',
          label: 'Link',
          handle: '',
          stat: '',
        },
      ],
    })
  }

  return (
    <div className="xp-back" onClick={onClose}>
      <div className="xp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Perfil de ${user.name}`}>
        <button type="button" className="xp-close" title="Fechar" onClick={onClose}>
          <X size={18} />
        </button>

        <aside className="xp-side">
          <div className="xp-side-banner" style={profileBannerStyle(user)}>
            {board.activityText ? (
              <div className="xp-activity-pill">
                <Plus size={12} /> {board.activityText}
              </div>
            ) : isSelf ? (
              <input
                className="xp-activity-input"
                placeholder="+ Just finished playing..."
                value={board.activityText || ''}
                onChange={(e) => patchBoard({ ...board, activityText: e.target.value })}
              />
            ) : null}
          </div>

          <div className="xp-side-body">
            <div className="xp-avatar-wrap">
              <Avatar
                name={user.name}
                color={user.color}
                avatar={user.avatar}
                status={user.status}
                size="xl"
                user={user}
                gifMotion="always"
              />
            </div>

            <div className="xp-identity">
              <h2>
                {user.name}
                {isSelf ? <Pencil size={14} className="xp-inline-icon" /> : null}
              </h2>
              <p className="xp-handle">
                {user.username} · {statusLabel(user.status)}
                <UserBadges user={user} />
              </p>
            </div>

            {isSelf ? (
              <div className="xp-actions">
                <button type="button" className="xp-btn edit" onClick={onEditSettings}>
                  <Pencil size={14} /> Edit Profile
                </button>
                <button type="button" className="xp-btn icon" title="Conquistas">
                  <Trophy size={16} />
                </button>
                <button type="button" className="xp-btn icon" title="Mais">
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ) : null}

            {user.bio ? (
              <blockquote className="xp-quote">&ldquo;{user.bio}&rdquo;</blockquote>
            ) : isSelf ? (
              <textarea
                className="xp-quote-edit"
                rows={2}
                placeholder="Sua frase de perfil"
                defaultValue={user.bio || ''}
                onBlur={(e) => {
                  const bio = e.target.value.trim()
                  if (bio !== (user.bio || '')) updateProfile({ bio: bio || undefined })
                }}
              />
            ) : null}

            {collectionWidget && !isSelf ? (
              <div className="xp-mini-collection">
                <span>Game Collection</span>
                <strong>{collectionWidget.gameName || '—'}</strong>
              </div>
            ) : null}

            <div className="xp-section">
              <h4>Member Since</h4>
              <p>{memberSince(user.joinedAt)}</p>
            </div>

            <div className="xp-section">
              <div className="xp-section-head">
                <h4>Connections</h4>
                {isSelf ? (
                  <button type="button" className="xp-link-btn" onClick={addConnection}>
                    + Add
                  </button>
                ) : null}
              </div>
              {board.connections.length === 0 ? (
                <p className="xp-muted">Nenhuma conexão.</p>
              ) : (
                <ul className="xp-connections">
                  {board.connections.map((c) => (
                    <li key={c.id}>
                      <span className="xp-conn-icon">{connectionIcon(c.platform)}</span>
                      <div className="xp-conn-body">
                        {isSelf ? (
                          <>
                            <input
                              className="xp-inline-sm"
                              value={c.label}
                              onChange={(e) => updateConnection(c.id, { label: e.target.value })}
                            />
                            <input
                              className="xp-inline-sm muted"
                              value={c.handle}
                              placeholder="@handle"
                              onChange={(e) => updateConnection(c.id, { handle: e.target.value })}
                            />
                            <input
                              className="xp-inline-sm muted"
                              value={c.stat || ''}
                              placeholder="31,321 Followers"
                              onChange={(e) => updateConnection(c.id, { stat: e.target.value })}
                            />
                          </>
                        ) : (
                          <>
                            <b>{c.label}</b>
                            <span>{c.handle}</span>
                            {c.stat ? <small>{c.stat}</small> : null}
                          </>
                        )}
                      </div>
                      {c.url && !isSelf ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="xp-conn-go">
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!isSelf && me ? (
              <div className="xp-section">
                <h4>Note (only visible to you)</h4>
                <textarea
                  className="xp-note"
                  rows={3}
                  placeholder="Click to add a note"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    saveProfileNote(me.id, user.id, e.target.value)
                  }}
                />
              </div>
            ) : null}
          </div>
        </aside>

        <section className="xp-main">
          <nav className="xp-tabs">
            <button type="button" className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>
              Board
            </button>
            <button type="button" className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>
              Activity
            </button>
            <button type="button" className={tab === 'wishlist' ? 'on' : ''} onClick={() => setTab('wishlist')}>
              Wishlist
            </button>
          </nav>

          {tab === 'board' ? (
            <>
              <div className="xp-board-head">
                <h3>{isSelf ? 'Your Widgets' : `${user.name}'s Widgets`}</h3>
                {isSelf ? (
                  <button type="button" className="xp-add-widget" onClick={addWidget}>
                    <Plus size={14} /> Add Widget
                  </button>
                ) : null}
              </div>
              <div className="xp-widgets">
                {board.widgets.length === 0 ? (
                  <p className="xp-muted">Nenhum widget ainda.</p>
                ) : (
                  board.widgets.map((w) => (
                    <WidgetCard
                      key={w.id}
                      widget={w}
                      isSelf={isSelf}
                      onChange={(next) => updateWidget(w.id, next)}
                      onRemove={() => removeWidget(w.id)}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="xp-empty-tab">
              <p>{tab === 'activity' ? 'Activity' : 'Wishlist'} em breve.</p>
            </div>
          )}

          {isSelf && dirty ? (
            <div className="xp-save-bar">
              <button type="button" className="xp-save-btn" onClick={saveBoard}>
                Salvar perfil
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export function mergeProfileBoardOnUser(user: User): User {
  return { ...user, profileBoard: boardForUser(user) }
}

export { defaultProfileBoard }
