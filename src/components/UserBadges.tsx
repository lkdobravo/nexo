import { Shield } from 'lucide-react'
import type { User } from '../types'
import { PrismaBadge } from './PrismaBadge'

export function UserBadges({
  user,
  size = 'sm',
}: {
  user: Pick<User, 'prismaTier' | 'isAdmin'>
  size?: 'sm' | 'md'
}) {
  const tier = user.prismaTier || 'none'
  if (tier === 'none' && !user.isAdmin) return null

  return (
    <span className="user-badges" aria-label="Emblemas">
      {tier !== 'none' ? <PrismaBadge tier={tier} size={size} /> : null}
      {user.isAdmin ? (
        <span className="user-badge admin" title="Administrador">
          <Shield size={size === 'sm' ? 12 : 14} />
        </span>
      ) : null}
    </span>
  )
}
