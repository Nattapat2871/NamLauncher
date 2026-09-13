// Author/creator: nattapat2871 (https://nattapat2871.me)

import { resolveSrv } from 'node:dns/promises'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import {
  normalizeMinecraftServerEndpoint,
  type MinecraftServerEndpoint
} from './serverEndpoint.ts'
import { sanitizeMinecraftPngDataUrl } from './pngDataUrl.ts'

const DEFAULT_TIMEOUT_MS = 3_500
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_MOTD_CHARACTERS = 8_192
const MAX_MOTD_SEGMENTS = 512

export type MinecraftMotdStyle = Readonly<{
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
  obfuscated?: boolean
}>

export type MinecraftMotdSegment = Readonly<MinecraftMotdStyle & { text: string }>

export type MinecraftMotd = Readonly<{
  plainText: string
  segments: readonly MinecraftMotdSegment[]
}>

export type MinecraftServerStatus = Readonly<{
  endpoint: MinecraftServerEndpoint
  connectedHost: string
  connectedPort: number
  latencyMs: number
  version: Readonly<{ name: string; protocol: number }> | null
  players: Readonly<{
    online: number
    max: number
    sample: readonly Readonly<{ id: string; name: string }>[]
  }> | null
  motd: MinecraftMotd
  faviconDataUrl: string | null
  enforcesSecureChat: boolean | null
}>

export type MinecraftServerPingOptions = Readonly<{
  timeoutMs?: number
  maxResponseBytes?: number
  protocolVersion?: number
  useSrv?: boolean
  signal?: AbortSignal
}>

export class MinecraftServerPingError extends Error {
  readonly code: 'ABORTED' | 'TIMEOUT' | 'NETWORK' | 'PROTOCOL' | 'RESPONSE_TOO_LARGE' | 'INVALID_RESPONSE'

  constructor(code: MinecraftServerPingError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MinecraftServerPingError'
    this.code = code
  }
}

export const encodeMinecraftVarInt = (input: number) => {
  if (!Number.isInteger(input)) throw new TypeError('Minecraft VarInt value must be an integer.')
  let value = input >>> 0
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    bytes.push(byte)
  } while (value !== 0 && bytes.length < 5)
  return Buffer.from(bytes)
}

const decodeMinecraftVarInt = (buffer: Buffer, offset: number) => {
  let value = 0
  for (let index = 0; index < 5; index += 1) {
    const position = offset + index
    if (position >= buffer.length) return null
    const byte = buffer[position]
    value |= (byte & 0x7f) << (7 * index)
    if ((byte & 0x80) === 0) return { value: value >>> 0, bytes: index + 1 }
  }
  throw new MinecraftServerPingError('PROTOCOL', 'Minecraft response contains an invalid VarInt.')
}

const encodeMinecraftString = (value: string) => {
  const encoded = Buffer.from(value, 'utf8')
  return Buffer.concat([encodeMinecraftVarInt(encoded.length), encoded])
}

const framePacket = (payload: Buffer) => Buffer.concat([encodeMinecraftVarInt(payload.length), payload])

const createStatusRequest = (endpoint: MinecraftServerEndpoint, protocolVersion: number) => {
  const port = Buffer.allocUnsafe(2)
  port.writeUInt16BE(endpoint.port)
  const handshake = Buffer.concat([
    encodeMinecraftVarInt(0),
    encodeMinecraftVarInt(protocolVersion),
    encodeMinecraftString(endpoint.host),
    port,
    encodeMinecraftVarInt(1)
  ])
  return Buffer.concat([framePacket(handshake), framePacket(Buffer.from([0]))])
}

const LEGACY_COLORS: Readonly<Record<string, string>> = Object.freeze({
  '0': 'black', '1': 'dark_blue', '2': 'dark_green', '3': 'dark_aqua',
  '4': 'dark_red', '5': 'dark_purple', '6': 'gold', '7': 'gray',
  '8': 'dark_gray', '9': 'blue', a: 'green', b: 'aqua', c: 'red',
  d: 'light_purple', e: 'yellow', f: 'white'
})

const appendLegacyText = (
  rawText: string,
  inherited: MinecraftMotdStyle,
  output: MinecraftMotdSegment[],
  characterBudget: { remaining: number }
) => {
  const sanitizedText = rawText.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
  let style: MinecraftMotdStyle = { ...inherited }
  let pending = ''
  const flush = () => {
    if (!pending || output.length >= MAX_MOTD_SEGMENTS || characterBudget.remaining <= 0) return
    const text = pending.slice(0, characterBudget.remaining)
    characterBudget.remaining -= text.length
    output.push(Object.freeze({ text, ...style }))
    pending = ''
  }

  for (let index = 0; index < sanitizedText.length && characterBudget.remaining > 0; index += 1) {
    if (sanitizedText[index] !== '\u00a7' || index + 1 >= sanitizedText.length) {
      pending += sanitizedText[index]
      continue
    }
    const code = sanitizedText[index + 1].toLowerCase()
    if (!(code in LEGACY_COLORS) && !'klmnor'.includes(code)) {
      pending += sanitizedText[index]
      continue
    }
    flush()
    index += 1
    if (code in LEGACY_COLORS) style = { color: LEGACY_COLORS[code] }
    else if (code === 'k') style = { ...style, obfuscated: true }
    else if (code === 'l') style = { ...style, bold: true }
    else if (code === 'm') style = { ...style, strikethrough: true }
    else if (code === 'n') style = { ...style, underlined: true }
    else if (code === 'o') style = { ...style, italic: true }
    else if (code === 'r') style = {}
  }
  flush()
}

const readStyle = (value: Record<string, unknown>, inherited: MinecraftMotdStyle): MinecraftMotdStyle => {
  const style: Record<string, string | boolean | undefined> = { ...inherited }
  if (typeof value.color === 'string' && /^#[0-9a-f]{6}$|^[a-z_]+$/i.test(value.color)) style.color = value.color
  for (const key of ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const) {
    if (typeof value[key] === 'boolean') style[key] = value[key]
  }
  return style
}

const flattenComponent = (
  value: unknown,
  inherited: MinecraftMotdStyle,
  output: MinecraftMotdSegment[],
  characterBudget: { remaining: number },
  depth = 0
) => {
  if (depth > 32 || output.length >= MAX_MOTD_SEGMENTS || characterBudget.remaining <= 0 || value == null) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    appendLegacyText(String(value), inherited, output, characterBudget)
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) flattenComponent(child, inherited, output, characterBudget, depth + 1)
    return
  }
  if (typeof value !== 'object') return

  const component = value as Record<string, unknown>
  const style = readStyle(component, inherited)
  if (typeof component.text === 'string') appendLegacyText(component.text, style, output, characterBudget)
  else if (typeof component.translate === 'string') appendLegacyText(component.translate, style, output, characterBudget)
  if (Array.isArray(component.with)) {
    for (const child of component.with) flattenComponent(child, style, output, characterBudget, depth + 1)
  }
  if (Array.isArray(component.extra)) {
    for (const child of component.extra) flattenComponent(child, style, output, characterBudget, depth + 1)
  }
}

export const normalizeMinecraftMotd = (description: unknown): MinecraftMotd => {
  const segments: MinecraftMotdSegment[] = []
  flattenComponent(description, {}, segments, { remaining: MAX_MOTD_CHARACTERS })
  return Object.freeze({
    plainText: segments.map((segment) => segment.text).join(''),
    segments: Object.freeze(segments)
  })
}

const safeInteger = (value: unknown) => (
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null
)

const parseStatusPayload = (
  value: unknown,
  endpoint: MinecraftServerEndpoint,
  connectedHost: string,
  connectedPort: number,
  latencyMs: number
): MinecraftServerStatus => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MinecraftServerPingError('INVALID_RESPONSE', 'Minecraft status response must be a JSON object.')
  }
  const response = value as Record<string, unknown>
  const versionValue = response.version && typeof response.version === 'object'
    ? response.version as Record<string, unknown>
    : null
  const protocol = safeInteger(versionValue?.protocol)
  const version = versionValue && typeof versionValue.name === 'string' && protocol !== null
    ? Object.freeze({ name: versionValue.name.slice(0, 256), protocol })
    : null

  const playersValue = response.players && typeof response.players === 'object'
    ? response.players as Record<string, unknown>
    : null
  const online = safeInteger(playersValue?.online)
  const max = safeInteger(playersValue?.max)
  const sample = Array.isArray(playersValue?.sample)
    ? playersValue.sample.slice(0, 100).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const player = entry as Record<string, unknown>
      if (typeof player.id !== 'string' || typeof player.name !== 'string') return []
      return [Object.freeze({ id: player.id.slice(0, 64), name: player.name.slice(0, 128) })]
    })
    : []
  const players = playersValue && online !== null && max !== null
    ? Object.freeze({ online: Math.max(0, online), max: Math.max(0, max), sample: Object.freeze(sample) })
    : null

  return Object.freeze({
    endpoint,
    connectedHost,
    connectedPort,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    version,
    players,
    motd: normalizeMinecraftMotd(response.description),
    faviconDataUrl: sanitizeMinecraftPngDataUrl(response.favicon),
    enforcesSecureChat: typeof response.enforcesSecureChat === 'boolean' ? response.enforcesSecureChat : null
  })
}

const resolveConnectionTarget = async (
  endpoint: MinecraftServerEndpoint,
  useSrv: boolean,
  deadline: number,
  signal?: AbortSignal
) => {
  if (!useSrv || !endpoint.srvEligible) return { host: endpoint.host, port: endpoint.port }
  if (signal?.aborted) throw new MinecraftServerPingError('ABORTED', 'Minecraft server ping was cancelled.')
  const remainingMs = Math.ceil(deadline - performance.now())
  if (remainingMs <= 0) throw new MinecraftServerPingError('TIMEOUT', 'Minecraft server did not respond in time.')
  const lookupBudgetMs = Math.min(1_500, remainingMs)

  let timer: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new MinecraftServerPingError('TIMEOUT', 'Minecraft SRV lookup did not respond in time.')),
        lookupBudgetMs
      )
      timer.unref()
      abortListener = () => reject(new MinecraftServerPingError('ABORTED', 'Minecraft server ping was cancelled.'))
      signal?.addEventListener('abort', abortListener, { once: true })
    })
    const records = await Promise.race([
      resolveSrv(`_minecraft._tcp.${endpoint.host}`),
      timeout
    ])
    const candidates = records
      .filter((record) => record.port >= 1 && record.port <= 65535 && record.name)
      .sort((left, right) => left.priority - right.priority || right.weight - left.weight)
    const selected = candidates[0]
    return selected
      ? { host: selected.name.endsWith('.') ? selected.name.slice(0, -1) : selected.name, port: selected.port }
      : { host: endpoint.host, port: endpoint.port }
  } catch (error) {
    if (error instanceof MinecraftServerPingError && error.code === 'ABORTED') throw error
    return { host: endpoint.host, port: endpoint.port }
  } finally {
    if (timer) clearTimeout(timer)
    if (abortListener) signal?.removeEventListener('abort', abortListener)
  }
}

export const pingMinecraftServer = async (
  address: string,
  options: MinecraftServerPingOptions = {}
): Promise<MinecraftServerStatus> => {
  const endpoint = normalizeMinecraftServerEndpoint(address)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const protocolVersion = options.protocolVersion ?? -1
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new TypeError('timeoutMs must be between 250 and 30000.')
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 4 * 1024 * 1024) {
    throw new TypeError('maxResponseBytes must be between 1024 and 4194304.')
  }
  if (!Number.isInteger(protocolVersion)) throw new TypeError('protocolVersion must be an integer.')
  if (options.signal?.aborted) throw new MinecraftServerPingError('ABORTED', 'Minecraft server ping was cancelled.')

  const startedAt = performance.now()
  const deadline = startedAt + timeoutMs
  const target = await resolveConnectionTarget(endpoint, options.useSrv !== false, deadline, options.signal)
  const socketTimeoutMs = Math.ceil(deadline - performance.now())
  if (socketTimeoutMs <= 0) throw new MinecraftServerPingError('TIMEOUT', 'Minecraft server did not respond in time.')
  if (options.signal?.aborted) throw new MinecraftServerPingError('ABORTED', 'Minecraft server ping was cancelled.')
  return new Promise<MinecraftServerStatus>((resolve, reject) => {
    let socket: Socket | null = null
    let settled = false
    let received = Buffer.alloc(0)

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort)
      socket?.removeAllListeners()
      socket?.destroy()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const succeed = (status: MinecraftServerStatus) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(status)
    }
    const onAbort = () => fail(new MinecraftServerPingError('ABORTED', 'Minecraft server ping was cancelled.'))
    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      socket = createConnection({ host: target.host, port: target.port })
      socket.setNoDelay(true)
      socket.setTimeout(socketTimeoutMs)
      socket.once('connect', () => socket?.write(createStatusRequest(endpoint, protocolVersion)))
      socket.once('timeout', () => fail(new MinecraftServerPingError('TIMEOUT', 'Minecraft server did not respond in time.')))
      socket.once('error', (error) => fail(new MinecraftServerPingError('NETWORK', 'Could not connect to Minecraft server.', { cause: error })))
      socket.once('end', () => fail(new MinecraftServerPingError('NETWORK', 'Minecraft server closed the connection before sending status.')))
      socket.on('data', (chunk: Buffer) => {
        if (settled) return
        received = Buffer.concat([received, chunk])
        if (received.length > maxResponseBytes + 10) {
          fail(new MinecraftServerPingError('RESPONSE_TOO_LARGE', 'Minecraft status response exceeded the size limit.'))
          return
        }

        try {
          const packetLength = decodeMinecraftVarInt(received, 0)
          if (!packetLength) return
          if (packetLength.value > maxResponseBytes) {
            fail(new MinecraftServerPingError('RESPONSE_TOO_LARGE', 'Minecraft status response exceeded the size limit.'))
            return
          }
          const frameEnd = packetLength.bytes + packetLength.value
          if (received.length < frameEnd) return
          const packet = received.subarray(packetLength.bytes, frameEnd)
          const packetId = decodeMinecraftVarInt(packet, 0)
          if (!packetId || packetId.value !== 0) throw new MinecraftServerPingError('PROTOCOL', 'Unexpected Minecraft status packet.')
          const jsonLength = decodeMinecraftVarInt(packet, packetId.bytes)
          if (!jsonLength || jsonLength.value > maxResponseBytes) {
            throw new MinecraftServerPingError('RESPONSE_TOO_LARGE', 'Minecraft status JSON exceeded the size limit.')
          }
          const jsonStart = packetId.bytes + jsonLength.bytes
          const jsonEnd = jsonStart + jsonLength.value
          if (jsonEnd !== packet.length) throw new MinecraftServerPingError('PROTOCOL', 'Minecraft status packet length is invalid.')
          const json = JSON.parse(packet.subarray(jsonStart, jsonEnd).toString('utf8'))
          succeed(parseStatusPayload(json, endpoint, target.host, target.port, performance.now() - startedAt))
        } catch (error) {
          fail(error instanceof MinecraftServerPingError
            ? error
            : new MinecraftServerPingError('INVALID_RESPONSE', 'Minecraft server returned invalid status JSON.', { cause: error }))
        }
      })
    } catch (error) {
      fail(new MinecraftServerPingError('NETWORK', 'Could not initialize Minecraft server connection.', { cause: error }))
    }
  })
}
