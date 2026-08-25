import { useEffect, useState } from 'react'
import {
  Gem,
  Sparkles,
  Image,
  Smile,
  Monitor,
  Upload,
  Palette,
  Rocket,
  MessageSquare,
  Shield,
  Search,
  Crown,
  Zap,
  Type,
} from 'lucide-react'
import {
  APP_ICONS,
  APP_THEMES,
  formatUploadLimit,
  limitsOf,
  PRISMA_LABEL,
  PROFILE_THEMES,
  tierOf,
} from '../lib/prisma'
import { socket } from '../lib/socket'
import { useAppStore } from '../store'
import type { PrismaTier, User } from '../types'
import { Avatar } from './Avatar'
import { PrismaBadge } from './PrismaBadge'

import { PREFS_KEY } from '../lib/uiPrefs'

type Benefit = { icon: typeof Gem; title: string; desc: string; basic?: boolean; full?: boolean }

const BENEFITS: Benefit[] = [
  { icon: Gem, title: 'Emblema Prisma', desc: 'Mostre seu status com um emblema exclusivo no perfil.', basic: true, full: true },
  { icon: Image, title: 'Avatar animado', desc: 'Use GIFs como foto de perfil.', basic: true, full: true },
  { icon: Palette, title: 'Banner e temas', desc: 'Banner personalizado e temas de perfil.', basic: true, full: true },
  { icon: Type, title: 'Status personalizado', desc: 'Texto de status visível para amigos.', basic: true, full: true },
  { icon: Upload, title: 'Arquivos maiores', desc: 'Envie imagens até 50 MB (Basic) ou 500 MB (Prisma).', basic: true, full: true },
  { icon: Smile, title: 'Emojis personalizados', desc: 'Use emojis customizados em qualquer chat.', basic: true, full: true },
  { icon: Palette, title: 'Temas do app', desc: 'Mais de 20 paletas de cores e ícones do app.', basic: true, full: true },
  { icon: MessageSquare, title: 'Mensagens longas', desc: 'Até 4.000 caracteres por mensagem.', full: true },
  { icon: Monitor, title: 'Transmissão HD', desc: '1080p e 60 fps em chamadas e tela compartilhada.', full: true },
  { icon: Rocket, title: '2 Impulsos de servidor', desc: 'Impulsione servidores com benefícios exclusivos.', full: true },
  { icon: Zap, title: 'Super reações', desc: 'Reações animadas com efeito especial.', full: true },
  { icon: Crown, title: 'Até 200 servidores', desc: 'Entre em mais comunidades.', full: true },
]

function AdminPanel() {
  const me = useAppStore((s) => s.me)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<(User & { isAdmin?: boolean })[]>([])
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!me?.isAdmin) return
    const t = window.setTimeout(() => {
      setBusy(true)
      socket.emit('admin:users', { query }, (res: { ok?: boolean; users?: User[]; error?: string }) => {
        setBusy(false)
        if (res.error) setHint(res.error)
        else setUsers(res.users || [])
      })
    }, 250)
    return () => window.clearTimeout(t)
  }, [query, me?.isAdmin])

  if (!me?.isAdmin) return null

  function setTier(userId: string, tier: PrismaTier) {
    socket.emit('admin:setTier', { userId, tier }, (res: { ok?: boolean; user?: User; error?: string }) => {
      if (res.error) setHint(res.error)
      else if (res.user) {
        setUsers((list) => list.map((u) => (u.id === userId ? { ...u, ...res.user! } : u)))
        if (userId === me?.id) useAppStore.setState({ me: { ...me!, ...res.user } })
        setHint('Plano atualizado.')
      }
    })
  }

  function setAdmin(userId: string, isAdmin: boolean) {
    socket.emit('admin:setAdmin', { userId, isAdmin }, (res: { ok?: boolean; error?: string }) => {
      if (res.error) setHint(res.error)
      else {
        setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isAdmin } : u)))
        setHint('Permissão de admin atualizada.')
      }
    })
  }

  return (
    <div className="prisma-admin">
      <div className="prisma-admin-head">
        <Shield size={20} />
        <div>
          <h3>Painel de administrador</h3>
          <p>Gerencie Prisma e permissões de usuários.</p>
        </div>
      </div>
      <div className="prisma-admin-search">
        <Search size={16} />
        <input
          placeholder="Buscar por nome, usuário ou ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {hint ? <p className="prisma-hint">{hint}</p> : null}
      <div className="prisma-admin-list">
        {busy ? <p className="empty">Buscando…</p> : null}
        {users.map((u) => (
          <div key={u.id} className="prisma-admin-row">
            <Avatar name={u.name} color={u.color} avatar={u.avatar} size="md" />
            <div className="grow">
              <b>
                {u.name} <PrismaBadge tier={tierOf(u)} size="sm" />
              </b>
              <span>
                @{u.username} · {PRISMA_LABEL[tierOf(u)]}
                {u.isAdmin ? ' · Admin' : ''}
              </span>
            </div>
            <select
              value={tierOf(u)}
              onChange={(e) => setTier(u.id, e.target.value as PrismaTier)}
              aria-label={`Plano de ${u.name}`}
            >
              <option value="none">Grátis</option>
              <option value="basic">Prisma Basic</option>
              <option value="full">Prisma</option>
            </select>
            <label className="prisma-admin-check">
              <input
                type="checkbox"
                checked={Boolean(u.isAdmin)}
                disabled={u.id === me?.id}
                onChange={(e) => setAdmin(u.id, e.target.checked)}
              />
              Admin
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PrismaSettings() {
  const me = useAppStore((s) => s.me)!
  const tier = tierOf(me)
  const limits = limitsOf(me)

  return (
    <div className="prisma-page">
      <div className="prisma-hero">
        <div className="prisma-hero-glow" />
        <Sparkles size={36} className="prisma-hero-icon" />
        <h2>Desbloqueie o Prisma</h2>
        <p>
          Seu plano atual: <strong>{PRISMA_LABEL[tier]}</strong>
          {tier !== 'none' ? (
            <>
              {' '}
              <PrismaBadge tier={tier} />
            </>
          ) : null}
        </p>
        <p className="prisma-hero-sub">
          Upload até {formatUploadLimit(limits.uploadBytes)} · {limits.messageChars} caracteres ·{' '}
          {limits.maxVideoQuality} / {limits.maxFps} fps
        </p>
      </div>

      <div className="prisma-plans">
        <div className={`prisma-plan ${tier === 'basic' ? 'active' : ''}`}>
          <Gem size={28} />
          <h3>Prisma Basic</h3>
          <p className="prisma-price">Grátis via admin</p>
          <ul>
            <li>Emblema Prisma Basic</li>
            <li>Avatar animado e banner</li>
            <li>Upload até 50 MB</li>
            <li>Temas e emojis customizados</li>
          </ul>
        </div>
        <div className={`prisma-plan featured ${tier === 'full' ? 'active' : ''}`}>
          <Sparkles size={28} />
          <h3>Prisma</h3>
          <p className="prisma-price">Grátis via admin</p>
          <ul>
            <li>Tudo do Basic</li>
            <li>Upload até 500 MB</li>
            <li>4.000 caracteres · HD 1080p/60fps</li>
            <li>2 impulsos · Super reações</li>
          </ul>
        </div>
      </div>

      <h3 className="prisma-section-title">Todos os benefícios</h3>
      <div className="prisma-benefits">
        {BENEFITS.map((b) => {
          const Icon = b.icon
          const available = tier === 'full' ? b.full || b.basic : tier === 'basic' ? b.basic : false
          return (
            <div key={b.title} className={`prisma-benefit ${available ? 'on' : 'off'}`}>
              <Icon size={22} />
              <div>
                <b>{b.title}</b>
                <span>{b.desc}</span>
              </div>
            </div>
          )
        })}
      </div>

      {me.isAdmin ? <AdminPanel /> : null}
    </div>
  )
}

export function applyAppTheme(themeId: string) {
  const theme = APP_THEMES.find((t) => t.id === themeId) || APP_THEMES[0]
  const root = document.documentElement
  for (const t of APP_THEMES) {
    for (const key of Object.keys(t.vars)) root.style.removeProperty(key)
  }
  for (const [k, v] of Object.entries(theme?.vars || {})) root.style.setProperty(k, v)
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...raw, appTheme: themeId }))
  } catch {
    /* */
  }
}

export function applyAppIcon(iconId: string) {
  const icon = APP_ICONS.find((i) => i.id === iconId) || APP_ICONS[0]
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon?.emoji || '💬'}</text></svg>`,
  )}`
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...raw, appIcon: iconId }))
  } catch {
    /* */
  }
}

export { PROFILE_THEMES, APP_THEMES, APP_ICONS }
