import { useEffect, useState, type MouseEvent, type KeyboardEvent } from 'react'
import { gifStaticFrame, isAnimatedGif } from '../lib/gifStatic'
import type { PresenceStatus, PrismaTier } from '../types'
import { PrismaBadge } from './PrismaBadge'

const sizeMap = { sm: 24, md: 32, lg: 40, xl: 80, xxl: 100, call: 88 }

export type GifMotion = 'static' | 'hover' | 'always' | 'speaking'

export function Avatar({
  name,
  color,
  status,
  size = 'md',
  className = '',
  avatar,
  onClick,
  prismaTier,
  showPrismaBadge = false,
  user,
  gifMotion = 'static',
  speaking = false,
}: {
  name: string
  color: string
  status?: PresenceStatus
  size?: keyof typeof sizeMap
  className?: string
  avatar?: string | null
  onClick?: (e: MouseEvent) => void
  prismaTier?: PrismaTier
  showPrismaBadge?: boolean
  user?: { prismaTier?: PrismaTier }
  /** Quando o GIF anima: static=nunca, hover=mouse em cima, always=sempre, speaking=só ao falar */
  gifMotion?: GifMotion
  speaking?: boolean
}) {
  const px = sizeMap[size]
  const tier = prismaTier ?? user?.prismaTier ?? 'none'
  const isGif = isAnimatedGif(avatar)
  const [hovering, setHovering] = useState(false)
  const [staticSrc, setStaticSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!avatar || !isGif) {
      setStaticSrc(null)
      return
    }
    let cancelled = false
    void gifStaticFrame(avatar)
      .then((frame) => {
        if (!cancelled) setStaticSrc(frame)
      })
      .catch(() => {
        if (!cancelled) setStaticSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [avatar, isGif])

  const shouldAnimate =
    isGif &&
    (gifMotion === 'always' ||
      (gifMotion === 'hover' && hovering) ||
      (gifMotion === 'speaking' && speaking))

  const imgSrc = avatar && isGif && !shouldAnimate && staticSrc ? staticSrc : avatar
  const showImg = Boolean(imgSrc && (!isGif || shouldAnimate || staticSrc))

  return (
    <div
      className={`avatar-wrap size-${size} ${className} ${onClick ? 'clickable' : ''}`}
      style={{ width: px, height: px, minWidth: px, minHeight: px }}
      onMouseEnter={gifMotion === 'hover' ? () => setHovering(true) : undefined}
      onMouseLeave={gifMotion === 'hover' ? () => setHovering(false) : undefined}
    >
      <div
        className={`avatar ${onClick ? 'clickable' : ''} ${isGif && shouldAnimate ? 'gif-live' : ''}`}
        style={{
          background: color,
          fontSize: px * 0.38,
        }}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onClick(e as unknown as MouseEvent)
                }
              }
            : undefined
        }
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {showImg ? (
          <img
            key={shouldAnimate ? 'gif' : 'static'}
            src={imgSrc!}
            alt=""
            draggable={false}
          />
        ) : (
          name.slice(0, 2).toUpperCase()
        )}
      </div>
      {status ? <i className={`status ${status}`} aria-hidden /> : null}
      {showPrismaBadge && tier !== 'none' ? (
        <PrismaBadge tier={tier} size={size === 'sm' ? 'sm' : 'md'} className="avatar-prisma-badge" />
      ) : null}
    </div>
  )
}
