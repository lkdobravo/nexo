import { Gem, Sparkles } from 'lucide-react'
import type { PrismaTier } from '../types'

export function PrismaBadge({
  tier,
  size = 'md',
  className = '',
}: {
  tier: PrismaTier
  size?: 'sm' | 'md'
  className?: string
}) {
  if (!tier || tier === 'none') return null
  const px = size === 'sm' ? 14 : 18
  const Icon = tier === 'full' ? Sparkles : Gem
  return (
    <span
      className={`prisma-badge ${tier} ${size} ${className}`.trim()}
      title={tier === 'full' ? 'Prisma' : 'Prisma Basic'}
    >
      <Icon size={px} strokeWidth={2.2} />
    </span>
  )
}
