import type { CSSProperties } from 'react'
import { PROFILE_THEMES } from './prisma'
import type { User } from '../types'

export function profileBannerStyle(user: User): CSSProperties {
  if (user.banner) {
    return {
      backgroundImage: `url(${user.banner})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  const theme = PROFILE_THEMES.find((t) => t.id === user.profileTheme)
  if (theme) return { background: theme.css }
  return { background: user.color }
}
