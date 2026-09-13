// Author/creator: nattapat2871 (https://nattapat2871.me)
import type { CSSProperties } from 'react'

export type MinecraftMotdSegment = Readonly<{
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
  obfuscated?: boolean
}>

export type MinecraftMotd = Readonly<{
  plainText: string
  segments: readonly MinecraftMotdSegment[]
}>

export type MinecraftServerPing = Readonly<{
  index: number
  name: string
  canonicalKey: string | null
  address: string
  requestedAddresses: readonly string[]
  iconDataUrl: string | null
  online: boolean
  status?: Readonly<{
    latencyMs: number
    version: Readonly<{ name: string; protocol: number }> | null
    players: Readonly<{
      online: number
      max: number
      sample: readonly Readonly<{ id: string; name: string }>[]
    }> | null
    motd: MinecraftMotd
    faviconDataUrl: string | null
  }>
  errorCode?: string
  errorMessage?: string
}>

const MOTD_COLORS: Readonly<Record<string, string>> = Object.freeze({
  black: '#64748b',
  dark_blue: '#2563eb',
  dark_green: '#16a34a',
  dark_aqua: '#0891b2',
  dark_red: '#dc2626',
  dark_purple: '#9333ea',
  gold: '#f59e0b',
  gray: '#cbd5e1',
  dark_gray: '#64748b',
  blue: '#60a5fa',
  green: '#4ade80',
  aqua: '#67e8f9',
  red: '#f87171',
  light_purple: '#e879f9',
  yellow: '#fde047',
  white: '#f8fafc'
})

const getMotdSegmentStyle = (segment: MinecraftMotdSegment): CSSProperties => {
  const color = segment.color && (/^#[0-9a-f]{6}$/i.test(segment.color)
    ? segment.color
    : MOTD_COLORS[segment.color])
  const decorations = [
    segment.underlined ? 'underline' : '',
    segment.strikethrough ? 'line-through' : ''
  ].filter(Boolean).join(' ')

  return {
    ...(color ? { color } : {}),
    ...(segment.bold ? { fontWeight: 800 } : {}),
    ...(segment.italic ? { fontStyle: 'italic' } : {}),
    ...(decorations ? { textDecoration: decorations } : {}),
    ...(segment.obfuscated ? { opacity: 0.72, letterSpacing: '0.08em' } : {})
  }
}

type MinecraftServerMotdProps = Readonly<{
  motd: MinecraftMotd | null | undefined
  fallback: string
  className?: string
}>

/** Renders backend-normalized MOTD text as React text nodes; raw server HTML is never interpreted. */
export const MinecraftServerMotd = ({ motd, fallback, className = '' }: MinecraftServerMotdProps) => (
  <span className={`block ${className}`} aria-label={motd?.plainText || fallback}>
    {motd?.segments.length
      ? motd.segments.map((segment, index) => (
        <span key={`${index}:${segment.text.slice(0, 12)}`} style={getMotdSegmentStyle(segment)}>
          {segment.text}
        </span>
      ))
      : fallback}
  </span>
)
