import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  LogOut,
  Mic,
  Pencil,
  Search,
  X,
} from 'lucide-react'
import { compressAvatar } from '../lib/avatar'
import { formatUploadLimit, limitsOf, PROFILE_THEMES, tierOf } from '../lib/prisma'
import { AVATAR_COLORS } from '../lib/ids'
import { useAppStore } from '../store'
import type { PresenceStatus, VideoFps, VideoQuality } from '../types'
import { Avatar } from './Avatar'
import { APP_ICONS, APP_THEMES, applyAppIcon, applyAppTheme, PrismaSettings } from './PrismaSettings'

import { defaultUiPrefs, readUiPrefs, saveUiPrefs, type UiPrefs } from '../lib/uiPrefs'
import { isDesktopApp } from '../lib/version'
import { DesktopSettings } from './DesktopSettings'

type TabId =
  | 'account'
  | 'profile'
  | 'prisma'
  | 'security'
  | 'notifications'
  | 'voice'
  | 'appearance'
  | 'accessibility'
  | 'desktop'

const NAV: { group: string; items: { id: TabId; label: string }[] }[] = [
  {
    group: 'Configurações do usuário',
    items: [
      { id: 'account', label: 'Minha conta' },
      { id: 'profile', label: 'Perfis' },
      { id: 'prisma', label: 'Prisma' },
      { id: 'security', label: 'Senha e segurança' },
      { id: 'notifications', label: 'Notificações' },
    ],
  },
  {
    group: 'Experiência de app',
    items: [
      { id: 'voice', label: 'Voz e vídeo' },
      { id: 'appearance', label: 'Aparência' },
      { id: 'accessibility', label: 'Acessibilidade' },
      ...(isDesktopApp() ? [{ id: 'desktop' as const, label: 'Aplicativo desktop' }] : []),
    ],
  },
]

function Row({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="set-row">
      <div className="set-row-meta">
        <span className="set-row-label">{label}</span>
        {hint ? <span className="set-row-hint">{hint}</span> : null}
      </div>
      <div className="set-row-actions">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="set-switch-knob" />
    </button>
  )
}

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen)
  const toggle = useAppStore((s) => s.toggleSettings)
  const devices = useAppStore((s) => s.devices)
  const setDevices = useAppStore((s) => s.setDevices)
  const mediaPrefs = useAppStore((s) => s.mediaPrefs)
  const setMediaPrefs = useAppStore((s) => s.setMediaPrefs)
  const me = useAppStore((s) => s.me)
  const setStatus = useAppStore((s) => s.setStatus)
  const updateProfile = useAppStore((s) => s.updateProfile)
  const changePassword = useAppStore((s) => s.changePassword)
  const logout = useAppStore((s) => s.logout)

  const [tab, setTab] = useState<TabId>('account')
  const [navQuery, setNavQuery] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [color, setColor] = useState(AVATAR_COLORS[0])
  const [bio, setBio] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [editing, setEditing] = useState<'name' | 'username' | null>(null)
  const [revealUser, setRevealUser] = useState(false)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [prefs, setPrefs] = useState<UiPrefs>(defaultUiPrefs)
  const [curPass, setCurPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passMsg, setPassMsg] = useState<string | null>(null)
  const [passErr, setPassErr] = useState<string | null>(null)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  const [busyAvatar, setBusyAvatar] = useState(false)
  const [customStatus, setCustomStatus] = useState('')
  const [profileTheme, setProfileTheme] = useState('default')
  const [bannerDraft, setBannerDraft] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !me) return
    setName(me.name)
    setUsername(me.username)
    setColor(me.color)
    setBio(me.bio || '')
    setCustomStatus(me.customStatus || '')
    setProfileTheme(me.profileTheme || 'default')
    setBannerDraft(me.banner || null)
    setAvatarDraft(me.avatar || null)
    setEditing(null)
    setPassMsg(null)
    setPassErr(null)
    setAvatarErr(null)
    setPrefs(readUiPrefs())
  }, [open, me])

  useEffect(() => {
    if (!open) return
    void (async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      } catch {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch {
          /* list unlabeled devices */
        }
      }
      const all = await navigator.mediaDevices.enumerateDevices()
      setMics(all.filter((d) => d.kind === 'audioinput'))
      setSpeakers(all.filter((d) => d.kind === 'audiooutput'))
      setCams(all.filter((d) => d.kind === 'videoinput'))
    })()
  }, [open])

  const filteredNav = useMemo(() => {
    const q = navQuery.trim().toLowerCase()
    if (!q) return NAV
    return NAV.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0)
  }, [navQuery])

  if (!open || !me) return null

  const statuses: { id: PresenceStatus; label: string }[] = [
    { id: 'online', label: 'Disponível' },
    { id: 'idle', label: 'Ausente' },
    { id: 'dnd', label: 'Não perturbe' },
    { id: 'offline', label: 'Invisível' },
  ]
  const qualities: VideoQuality[] = ['360p', '480p', '720p', '1080p'].filter(
    (q) => ['360p', '480p', '720p', '1080p'].indexOf(q) <= ['360p', '480p', '720p', '1080p'].indexOf(limitsOf(me).maxVideoQuality),
  ) as VideoQuality[]
  const fpsOptions: VideoFps[] = ([12, 15, 24, 30, 60] as VideoFps[]).filter(
    (f) => f <= limitsOf(me).maxFps,
  )
  const prismaLimits = limitsOf(me)
  const displayAvatar = avatarDraft ?? me.avatar
  const title =
    NAV.flatMap((g) => g.items).find((i) => i.id === tab)?.label || 'Configurações'

  const patchPrefs = (next: Partial<UiPrefs>) => {
    const merged = saveUiPrefs(next)
    setPrefs(merged)
  }

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return
    setBusyAvatar(true)
    setAvatarErr(null)
    try {
      const dataUrl = await compressAvatar(file, 256, 0.85, tierOf(me))
      setAvatarDraft(dataUrl)
      updateProfile({ avatar: dataUrl })
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : 'Falha ao carregar a foto.')
    } finally {
      setBusyAvatar(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveProfile = () => {
    updateProfile({
      name: name.trim() || me.name,
      username: username.trim().toLowerCase() || me.username,
      color,
      bio: bio.trim(),
      avatar: avatarDraft,
      customStatus: customStatus.trim() || null,
      profileTheme: profileTheme || null,
      banner: bannerDraft,
    })
    setEditing(null)
  }

  const submitPassword = async () => {
    setPassErr(null)
    setPassMsg(null)
    if (newPass !== confirmPass) {
      setPassErr('As senhas novas não coincidem.')
      return
    }
    const res = await changePassword(curPass, newPass)
    if (res?.error) {
      setPassErr(res.error)
      return
    }
    setCurPass('')
    setNewPass('')
    setConfirmPass('')
    setPassMsg('Senha atualizada.')
  }

  return (
    <div
      className="settings-back"
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') toggle()
      }}
    >
      <div
        className="settings-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações do usuário"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="settings-nav">
          <button
            type="button"
            className="settings-user-card"
            onClick={() => setTab('profile')}
          >
            <Avatar
              name={me.name}
              color={me.color}
              avatar={displayAvatar}
              status={me.status}
              size="lg"
              user={me}
            />
            <div>
              <b>{me.name}</b>
              <span>
                <Pencil size={12} /> Editar perfis
              </span>
            </div>
          </button>

          <label className="settings-search">
            <Search size={14} />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Buscar"
            />
          </label>

          <nav className="settings-nav-list">
            {filteredNav.map((group) => (
              <div key={group.group} className="settings-nav-group">
                <h4>{group.group}</h4>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={tab === item.id ? 'on' : ''}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <button
            type="button"
            className="settings-logout"
            onClick={() => {
              toggle()
              logout()
            }}
          >
            <LogOut size={16} /> Sair da conta
          </button>
        </aside>

        <section className="settings-pane">
          <header className="settings-pane-head">
            <h2>{title}</h2>
            <button type="button" className="settings-close" onClick={toggle} title="Fechar">
              <X size={20} />
              <span>ESC</span>
            </button>
          </header>

          <div className="settings-pane-body">
            {tab === 'account' ? (
              <>
                <h3 className="set-h">Informações da conta</h3>
                <div className="set-card">
                  <Row label="Nome de exibição">
                    {editing === 'name' ? (
                      <>
                        <input
                          className="set-inline-input"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={32}
                        />
                        <button type="button" className="set-btn primary" onClick={saveProfile}>
                          Salvar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="set-value">{me.name}</span>
                        <button type="button" className="set-btn" onClick={() => setEditing('name')}>
                          Editar
                        </button>
                      </>
                    )}
                  </Row>
                  <Row label="Nome de usuário">
                    {editing === 'username' ? (
                      <>
                        <input
                          className="set-inline-input"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          maxLength={20}
                        />
                        <button type="button" className="set-btn primary" onClick={saveProfile}>
                          Salvar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="set-value">
                          {revealUser ? me.username : `${me.username.slice(0, 2)}${'•'.repeat(Math.max(4, me.username.length - 2))}`}
                          <button
                            type="button"
                            className="set-link"
                            onClick={() => setRevealUser((v) => !v)}
                          >
                            {revealUser ? 'Ocultar' : 'Revelar'}
                          </button>
                        </span>
                        <button
                          type="button"
                          className="set-btn"
                          onClick={() => setEditing('username')}
                        >
                          Editar
                        </button>
                      </>
                    )}
                  </Row>
                  <Row label="Tag">
                    <span className="set-value">#{me.tag}</span>
                  </Row>
                  <Row label="Status">
                    <select
                      className="set-select"
                      value={me.status}
                      onChange={(e) => setStatus(e.target.value as PresenceStatus)}
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>

                <h3 className="set-h">Senha e segurança</h3>
                <div className="set-card">
                  <Row label="Senha" hint="••••••••">
                    <button type="button" className="set-btn" onClick={() => setTab('security')}>
                      Editar
                    </button>
                  </Row>
                </div>

                <h3 className="set-h">Situação da conta</h3>
                <div className="set-card set-standing">
                  <Check size={18} className="ok" />
                  <span>Sua conta está em dia.</span>
                </div>
              </>
            ) : null}

            {tab === 'profile' ? (
              <>
                <h3 className="set-h">Avatar</h3>
                <div className="set-card set-avatar-card">
                  <div className="set-avatar-preview" style={{ background: color }}>
                    <Avatar
                      name={name || me.name}
                      color={color}
                      avatar={displayAvatar}
                      size="xxl"
                      gifMotion="always"
                    />
                  </div>
                  <div className="set-avatar-actions">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(e) => void onPickAvatar(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className="set-btn primary"
                      disabled={busyAvatar}
                      onClick={() => fileRef.current?.click()}
                    >
                      {busyAvatar ? 'Enviando…' : 'Trocar foto'}
                    </button>
                    {displayAvatar ? (
                      <button
                        type="button"
                        className="set-btn"
                        onClick={() => {
                          setAvatarDraft(null)
                          updateProfile({ avatar: null })
                        }}
                      >
                        Remover
                      </button>
                    ) : null}
                    <p className="set-hint">
                      PNG, JPG, WEBP
                      {prismaLimits.gifAvatar
                        ? ` ou GIF animado (até ${formatUploadLimit(prismaLimits.avatarGifBytes)})`
                        : ''}
                      .
                    </p>
                    {avatarErr ? <p className="set-error">{avatarErr}</p> : null}
                  </div>
                </div>

                <h3 className="set-h">Sobre mim</h3>
                <div className="set-card set-form">
                  <label>
                    Nome de exibição
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
                  </label>
                  <label>
                    Nome de usuário
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      maxLength={20}
                    />
                  </label>
                  <label>
                    Bio
                    <textarea
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      maxLength={prismaLimits.bioChars}
                      placeholder="Sobre você"
                    />
                  </label>
                  {tierOf(me) !== 'none' ? (
                    <>
                      <label>
                        Status personalizado
                        <input
                          value={customStatus}
                          onChange={(e) => setCustomStatus(e.target.value)}
                          maxLength={128}
                          placeholder="O que você está fazendo?"
                        />
                      </label>
                      <label>Tema do perfil</label>
                      <div className="prisma-theme-grid">
                        {PROFILE_THEMES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`prisma-theme-swatch ${profileTheme === t.id ? 'on' : ''}`}
                            style={{ background: t.css }}
                            title={t.label}
                            onClick={() => setProfileTheme(t.id)}
                          />
                        ))}
                      </div>
                      <label>Banner do perfil</label>
                      <div className="set-banner-row">
                        <input
                          ref={bannerRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            const reader = new FileReader()
                            reader.onload = () => setBannerDraft(String(reader.result))
                            reader.readAsDataURL(file)
                          }}
                        />
                        <button type="button" className="set-btn" onClick={() => bannerRef.current?.click()}>
                          Enviar banner
                        </button>
                        {bannerDraft ? (
                          <button type="button" className="set-btn" onClick={() => setBannerDraft(null)}>
                            Remover banner
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="set-hint">Banner, GIF e temas exigem Prisma — veja a aba Prisma.</p>
                  )}
                  <label>Cor do perfil</label>
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
                  <button type="button" className="set-btn primary wide" onClick={saveProfile}>
                    Salvar perfil
                  </button>
                </div>
              </>
            ) : null}

            {tab === 'prisma' ? <PrismaSettings /> : null}

            {tab === 'security' ? (
              <>
                <h3 className="set-h">Alterar senha</h3>
                <div className="set-card set-form">
                  <label>
                    Senha atual
                    <input
                      type="password"
                      value={curPass}
                      onChange={(e) => setCurPass(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <label>
                    Nova senha
                    <input
                      type="password"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Confirmar nova senha
                    <input
                      type="password"
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  {passErr ? <p className="set-error">{passErr}</p> : null}
                  {passMsg ? <p className="set-ok">{passMsg}</p> : null}
                  <button type="button" className="set-btn primary wide" onClick={() => void submitPassword()}>
                    Atualizar senha
                  </button>
                </div>
              </>
            ) : null}

            {tab === 'notifications' ? (
              <>
                <h3 className="set-h">Sons e alertas</h3>
                <div className="set-card">
                  <Row label="Som de mensagens">
                    <Toggle
                      label="Som de mensagens"
                      checked={prefs.messageSounds}
                      onChange={(v) => patchPrefs({ messageSounds: v })}
                    />
                  </Row>
                  <Row label="Som de chamadas">
                    <Toggle
                      label="Som de chamadas"
                      checked={prefs.callSounds}
                      onChange={(v) => patchPrefs({ callSounds: v })}
                    />
                  </Row>
                  <Row label="Notificações do navegador" hint="Pede permissão ao ativar">
                    <Toggle
                      label="Notificações do navegador"
                      checked={prefs.desktopNotifs}
                      onChange={(v) => {
                        patchPrefs({ desktopNotifs: v })
                        if (v && 'Notification' in window && Notification.permission === 'default') {
                          void Notification.requestPermission()
                        }
                      }}
                    />
                  </Row>
                </div>
              </>
            ) : null}

            {tab === 'voice' ? (
              <>
                <h3 className="set-h">Dispositivos de entrada</h3>
                <div className="set-card set-form">
                  <label>
                    <Mic size={14} /> Microfone
                    <select
                      value={devices.micId}
                      onChange={(e) => setDevices({ micId: e.target.value })}
                    >
                      <option value="">Padrão do sistema</option>
                      {mics.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || 'Microfone'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Saída de som
                    <select
                      value={devices.speakerId}
                      onChange={(e) => setDevices({ speakerId: e.target.value })}
                    >
                      <option value="">Padrão do sistema</option>
                      {speakers.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || 'Alto-falante'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Câmera
                    <select
                      value={devices.camId}
                      onChange={(e) => setDevices({ camId: e.target.value })}
                    >
                      <option value="">Padrão do sistema</option>
                      {cams.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || 'Câmera'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <h3 className="set-h">Qualidade de vídeo</h3>
                <div className="set-card set-form">
                  <label>
                    Resolução
                    <select
                      value={mediaPrefs.videoQuality}
                      onChange={(e) =>
                        setMediaPrefs({ videoQuality: e.target.value as VideoQuality })
                      }
                    >
                      {qualities.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    FPS
                    <select
                      value={mediaPrefs.fps}
                      onChange={(e) =>
                        setMediaPrefs({ fps: Number(e.target.value) as VideoFps })
                      }
                    >
                      {fpsOptions.map((f) => (
                        <option key={f} value={f}>
                          {f} fps
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="set-hint">Qualidade menor = menos peso na máquina e na rede.</p>
                </div>
              </>
            ) : null}

            {tab === 'appearance' ? (
              <>
                <h3 className="set-h">Tema</h3>
                <div className="set-card">
                  <Row label="Tema escuro" hint="O Nexo usa tema escuro por padrão">
                    <span className="set-value">Ativo</span>
                  </Row>
                  <Row label="Modo compacto">
                    <Toggle
                      label="Modo compacto"
                      checked={prefs.compactMode}
                      onChange={(v) => patchPrefs({ compactMode: v })}
                    />
                  </Row>
                </div>
                {tierOf(me) !== 'none' ? (
                  <>
                    <h3 className="set-h">Temas do app (Prisma)</h3>
                    <div className="set-card">
                      <div className="prisma-app-themes">
                        {APP_THEMES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="set-btn"
                            onClick={() => {
                              applyAppTheme(t.id)
                              setPrefs(readUiPrefs())
                            }}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <h3 className="set-h">Ícone do app (Prisma)</h3>
                    <div className="set-card prisma-app-icons">
                      {APP_ICONS.map((ic) => (
                        <button
                          key={ic.id}
                          type="button"
                          className="prisma-app-icon-btn"
                          title={ic.label}
                          onClick={() => {
                            applyAppIcon(ic.id)
                            setPrefs(readUiPrefs())
                          }}
                        >
                          {ic.emoji}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="set-hint">Temas e ícones extras estão na aba Prisma.</p>
                )}
                <h3 className="set-h">Chat</h3>
                <div className="set-card set-form">
                  <label>
                    Escala da fonte ({prefs.chatFontScale}%)
                    <input
                      type="range"
                      min={90}
                      max={120}
                      step={5}
                      value={prefs.chatFontScale}
                      onChange={(e) => patchPrefs({ chatFontScale: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {tab === 'accessibility' ? (
              <>
                <h3 className="set-h">Movimento</h3>
                <div className="set-card">
                  <Row label="Reduzir movimento" hint="Menos animações na interface">
                    <Toggle
                      label="Reduzir movimento"
                      checked={prefs.reduceMotion}
                      onChange={(v) => patchPrefs({ reduceMotion: v })}
                    />
                  </Row>
                </div>
              </>
            ) : null}

            {tab === 'desktop' ? <DesktopSettings /> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
