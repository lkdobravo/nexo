import { Headphones, MicOff } from 'lucide-react'

export function AvatarStatusBadges({
  muted,
  deafened,
  size = 'md',
  overlay = true,
  inline = false,
}: {
  muted?: boolean
  deafened?: boolean
  size?: 'sm' | 'md'
  overlay?: boolean
  inline?: boolean
}) {
  if (!muted && !deafened) return null
  const icon = size === 'sm' ? 10 : 14
  const flagClass = inline
    ? 'voice-flag inline-flag'
    : overlay
      ? `voice-flag overlay${size === 'sm' ? ' sm' : ''}`
      : 'voice-flag'
  return (
    <>
      {muted ? (
        <span className={`${flagClass} mute`} title="Microfone desligado">
          <MicOff size={icon} strokeWidth={2.5} />
        </span>
      ) : null}
      {deafened ? (
        <span className={`${flagClass} deaf ${overlay && !inline ? 'deaf-flag' : ''}`} title="Som desligado">
          <Headphones size={icon} strokeWidth={2.5} />
        </span>
      ) : null}
    </>
  )
}
