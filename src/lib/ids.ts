export function dmConversationId(a: string, b: string) {
  return `dm:${[a, b].sort().join('_')}`
}

export function tagFromId(id: string) {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % 10000
  return String(n).padStart(4, '0')
}

export function initialFromName(name: string) {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

export const AVATAR_COLORS = [
  '#5865F2',
  '#57F287',
  '#FEE75C',
  '#EB459E',
  '#ED4245',
  '#3BA55D',
  '#F26522',
  '#A855F7',
  '#22D3EE',
  '#F43F5E',
]
