// Author/creator: nattapat2871 (https://nattapat2871.me)

import * as dgram from 'node:dgram'
import { TextDecoder } from 'node:util'

export const MINECRAFT_LAN_MULTICAST_ADDRESS = '224.0.2.60'
export const MINECRAFT_LAN_MULTICAST_PORT = 4_445
export const MAX_MINECRAFT_LAN_PACKET_BYTES = 2_048
export const MAX_MINECRAFT_LAN_MOTD_CODE_POINTS = 160
export const MAX_MINECRAFT_LAN_SERVERS = 256
export const MAX_MINECRAFT_LAN_PACKETS_PER_SCAN = 512
export const MAX_MINECRAFT_LAN_BYTES_PER_SCAN = 256 * 1_024
export const DEFAULT_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS = 1_500
export const MIN_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS = 25
export const MAX_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS = 10_000

export type MinecraftLanServer = {
  address: string
  port: number
  endpoint: string
  motd: string
}

export type MinecraftLanSocketFactory = (options: dgram.SocketOptions) => dgram.Socket

export type MinecraftLanDiscoveryOptions = {
  timeoutMs?: number
  socketFactory?: MinecraftLanSocketFactory
}

const ANNOUNCEMENT_PATTERN = /^\[MOTD\]((?:(?!\[\/MOTD\])[\s\S])*)\[\/MOTD\]\[AD\]([0-9]{1,5})\[\/AD\]$/
const UNSAFE_MOTD_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu
const ANSI_ESCAPE_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

const normalizeSourceAddress = (source: string | Pick<dgram.RemoteInfo, 'address'>) => (
  typeof source === 'string' ? source : source?.address
)

const parseIpv4Octets = (address: unknown) => {
  if (typeof address !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return null
  const octets = address.split('.').map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null
}

export const isPrivateOrLinkLocalIpv4 = (address: unknown): address is string => {
  const octets = parseIpv4Octets(address)
  if (!octets) return false
  if (octets[0] === 10) return true
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  return octets[0] === 169 && octets[1] === 254
}

export const sanitizeMinecraftLanMotd = (value: unknown) => {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(ANSI_ESCAPE_SEQUENCE, '')
    .replace(UNSAFE_MOTD_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(normalized).slice(0, MAX_MINECRAFT_LAN_MOTD_CODE_POINTS).join('')
}

const decodeAnnouncement = (packet: string | Uint8Array) => {
  if (typeof packet === 'string') {
    const byteLength = Buffer.byteLength(packet, 'utf8')
    return byteLength > 0 && byteLength <= MAX_MINECRAFT_LAN_PACKET_BYTES ? packet : null
  }
  if (!(packet instanceof Uint8Array) || packet.byteLength === 0 || packet.byteLength > MAX_MINECRAFT_LAN_PACKET_BYTES) return null
  try {
    return UTF8_DECODER.decode(packet)
  } catch {
    return null
  }
}

export const parseMinecraftLanAnnouncement = (
  packet: string | Uint8Array,
  source: string | Pick<dgram.RemoteInfo, 'address'>
): MinecraftLanServer | null => {
  const address = normalizeSourceAddress(source)
  if (!isPrivateOrLinkLocalIpv4(address)) return null

  const announcement = decodeAnnouncement(packet)
  const match = announcement?.match(ANNOUNCEMENT_PATTERN)
  if (!match) return null

  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null

  return {
    address,
    port,
    endpoint: `${address}:${port}`,
    motd: sanitizeMinecraftLanMotd(match[1])
  }
}

const ipv4SortKey = (address: string) => (
  address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0)
)

export const dedupeAndSortMinecraftLanServers = (
  servers: ReadonlyArray<MinecraftLanServer>
): MinecraftLanServer[] => {
  const byEndpoint = new Map<string, MinecraftLanServer>()
  for (const server of servers) {
    if (!isPrivateOrLinkLocalIpv4(server?.address)) continue
    if (!Number.isInteger(server?.port) || server.port < 1 || server.port > 65_535) continue
    const endpoint = `${server.address}:${server.port}`
    byEndpoint.set(endpoint, {
      address: server.address,
      port: server.port,
      endpoint,
      motd: sanitizeMinecraftLanMotd(server.motd)
    })
  }
  return [...byEndpoint.values()].sort((left, right) => (
    ipv4SortKey(left.address) - ipv4SortKey(right.address)
    || left.port - right.port
    || left.motd.localeCompare(right.motd)
  ))
}

const normalizeTimeoutMs = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS
  return Math.min(
    MAX_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS,
    Math.max(MIN_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS, Math.trunc(parsed))
  )
}

const defaultSocketFactory: MinecraftLanSocketFactory = (options) => dgram.createSocket(options)

export const discoverMinecraftLanServers = (
  options: MinecraftLanDiscoveryOptions = {}
): Promise<MinecraftLanServer[]> => new Promise((resolve, reject) => {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs)
  let socket: dgram.Socket
  try {
    socket = (options.socketFactory || defaultSocketFactory)({ type: 'udp4', reuseAddr: true })
  } catch (error) {
    reject(error)
    return
  }

  const discovered = new Map<string, MinecraftLanServer>()
  let receivedPacketCount = 0
  let receivedByteCount = 0
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const closeSocket = () => {
    try {
      socket.close()
    } catch {
      // A bind failure can leave a socket that was never started. It is already safe to discard.
    }
  }

  const finish = (error?: Error) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    closeSocket()
    if (error) reject(error)
    else resolve(dedupeAndSortMinecraftLanServers([...discovered.values()]))
  }

  socket.on('message', (packet, remoteInfo) => {
    if (settled) return
    receivedPacketCount += 1
    receivedByteCount += packet.byteLength
    const scanBudgetReached = receivedPacketCount >= MAX_MINECRAFT_LAN_PACKETS_PER_SCAN
      || receivedByteCount >= MAX_MINECRAFT_LAN_BYTES_PER_SCAN
    const server = parseMinecraftLanAnnouncement(packet, remoteInfo)
    if (server && (discovered.has(server.endpoint) || discovered.size < MAX_MINECRAFT_LAN_SERVERS)) {
      discovered.set(server.endpoint, server)
    }
    if (scanBudgetReached) finish()
  })
  socket.once('error', (error) => finish(error))
  socket.once('listening', () => {
    try {
      socket.addMembership(MINECRAFT_LAN_MULTICAST_ADDRESS)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Minecraft LAN multicast membership failed.'))
    }
  })

  timer = setTimeout(() => finish(), timeoutMs)
  try {
    socket.unref()
    socket.bind(MINECRAFT_LAN_MULTICAST_PORT, '0.0.0.0')
  } catch (error) {
    finish(error instanceof Error ? error : new Error('Minecraft LAN discovery socket failed to bind.'))
  }
})
