// Author/creator: nattapat2871 (https://nattapat2871.me)

import crypto from 'node:crypto'
import { isIP } from 'node:net'
import { tryNormalizeMinecraftServerEndpoint } from './serverEndpoint.ts'

export type MinecraftServerKind = 'domain' | 'private_ip' | 'public_ip' | 'local'

export type MinecraftServerTelemetryState = Readonly<{
  key: string
  address: string
  label: string
  kind: MinecraftServerKind
}>

export type MinecraftServerLogEvent = Readonly<{
  type: 'connected'
  endpoint: string
}> | Readonly<{
  type: 'disconnected'
}>

type NamedServer = Readonly<{
  canonicalKey: string | null
  name: string
}>

const CONNECT_PATTERNS = [
  /\bConnecting to\s+(\[[0-9a-f:]+]|[^\s,]+)\s*,\s*(\d{1,5})\b/i,
  /\bConnecting to\s+(\[[0-9a-f:]+]|[^\s,]+):(\d{1,5})\b/i
]

const DISCONNECT_PATTERN = /\b(?:Disconnected from server|Disconnecting from server|Lost connection(?::|\b)|Connection closed)\b/i

const isPrivateIpv4 = (host: string) => {
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

const isPrivateIpv6 = (host: string) => {
  const value = host.toLowerCase()
  return value === '::1' || value.startsWith('fe8') || value.startsWith('fe9')
    || value.startsWith('fea') || value.startsWith('feb')
    || value.startsWith('fc') || value.startsWith('fd')
}

const normalizeServerLabel = (value: unknown, fallback: string) => {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

export const parseMinecraftServerLogEvent = (rawLine: unknown): MinecraftServerLogEvent | null => {
  const line = String(rawLine || '')
  for (const pattern of CONNECT_PATTERNS) {
    const match = pattern.exec(line)
    if (!match) continue
    const endpoint = tryNormalizeMinecraftServerEndpoint(`${match[1]}:${match[2]}`)
    if (endpoint) return Object.freeze({ type: 'connected', endpoint: endpoint.canonicalKey })
  }
  return DISCONNECT_PATTERN.test(line) ? Object.freeze({ type: 'disconnected' }) : null
}

export const createMinecraftServerTelemetryState = (
  rawEndpoint: string,
  namedServers: readonly NamedServer[] = []
): MinecraftServerTelemetryState | null => {
  const endpoint = tryNormalizeMinecraftServerEndpoint(rawEndpoint)
  if (!endpoint) return null

  const saved = namedServers.find((server) => server.canonicalKey === endpoint.canonicalKey)
  const ipVersion = isIP(endpoint.host)
  let kind: MinecraftServerKind = 'domain'
  let fallbackLabel = endpoint.host
  if (endpoint.host === 'localhost') {
    kind = 'local'
    fallbackLabel = 'Local server'
  } else if (ipVersion === 4 || ipVersion === 6) {
    const isPrivate = ipVersion === 4 ? isPrivateIpv4(endpoint.host) : isPrivateIpv6(endpoint.host)
    kind = isPrivate ? 'private_ip' : 'public_ip'
    fallbackLabel = isPrivate ? 'LAN / Private server' : 'Public server'
  }

  return Object.freeze({
    key: crypto.createHash('sha256').update(endpoint.canonicalKey, 'utf8').digest('hex'),
    address: endpoint.canonicalKey,
    label: normalizeServerLabel(saved?.name, fallbackLabel),
    kind
  })
}
