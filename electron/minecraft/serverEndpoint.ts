// Author/creator: nattapat2871 (https://nattapat2871.me)

import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

export const DEFAULT_MINECRAFT_SERVER_PORT = 25565
const MAX_ENDPOINT_LENGTH = 320

export type MinecraftServerEndpoint = Readonly<{
  host: string
  port: number
  explicitPort: boolean
  address: string
  canonicalKey: string
  ipVersion: 0 | 4 | 6
  srvEligible: boolean
}>

export class InvalidMinecraftServerEndpointError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMinecraftServerEndpointError'
  }
}

const parsePort = (value: string | undefined) => {
  if (value === undefined) return DEFAULT_MINECRAFT_SERVER_PORT
  if (!/^\d{1,5}$/.test(value)) {
    throw new InvalidMinecraftServerEndpointError('Server port must be a number between 1 and 65535.')
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidMinecraftServerEndpointError('Server port must be between 1 and 65535.')
  }
  return port
}

const normalizeHost = (rawHost: string) => {
  const withoutTrailingDot = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost
  if (!withoutTrailingDot) {
    throw new InvalidMinecraftServerEndpointError('Server host is required.')
  }

  const ipVersion = isIP(withoutTrailingDot) as 0 | 4 | 6
  if (ipVersion !== 0) return { host: withoutTrailingDot.toLowerCase(), ipVersion }

  const asciiHost = domainToASCII(withoutTrailingDot).toLowerCase()
  if (!asciiHost || asciiHost.length > 253) {
    throw new InvalidMinecraftServerEndpointError('Server host is not a valid hostname.')
  }

  const labels = asciiHost.split('.')
  const valid = labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label)
  ))
  if (!valid) {
    throw new InvalidMinecraftServerEndpointError('Server host is not a valid hostname.')
  }

  return { host: asciiHost, ipVersion: 0 as const }
}

export const normalizeMinecraftServerEndpoint = (input: string): MinecraftServerEndpoint => {
  const value = input.trim()
  if (!value || value.length > MAX_ENDPOINT_LENGTH) {
    throw new InvalidMinecraftServerEndpointError('Server address is empty or too long.')
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(value)) {
    throw new InvalidMinecraftServerEndpointError('Server address cannot contain whitespace or control characters.')
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /[\\/?#@]/.test(value)) {
    throw new InvalidMinecraftServerEndpointError('Enter a Minecraft server address, not a URL.')
  }

  let rawHost = value
  let rawPort: string | undefined
  let explicitPort = false

  if (value.startsWith('[')) {
    const match = /^\[([^\]]+)](?::(\d+))?$/.exec(value)
    if (!match || isIP(match[1]) !== 6) {
      throw new InvalidMinecraftServerEndpointError('Bracketed server addresses must contain a valid IPv6 host.')
    }
    rawHost = match[1]
    rawPort = match[2]
    explicitPort = rawPort !== undefined
  } else {
    const colonCount = (value.match(/:/g) || []).length
    if (colonCount === 1) {
      const separator = value.lastIndexOf(':')
      rawHost = value.slice(0, separator)
      rawPort = value.slice(separator + 1)
      explicitPort = true
    } else if (colonCount > 1) {
      if (isIP(value) !== 6) {
        throw new InvalidMinecraftServerEndpointError('IPv6 server address is invalid.')
      }
      rawHost = value
    }
  }

  const { host, ipVersion } = normalizeHost(rawHost)
  const port = parsePort(rawPort)
  const displayHost = ipVersion === 6 ? `[${host}]` : host
  const address = explicitPort
    ? `${displayHost}:${port}`
    : displayHost

  return Object.freeze({
    host,
    port,
    explicitPort,
    address,
    canonicalKey: `${displayHost}:${port}`,
    ipVersion,
    srvEligible: ipVersion === 0 && !explicitPort && host !== 'localhost'
  })
}

export const tryNormalizeMinecraftServerEndpoint = (input: string) => {
  try {
    return normalizeMinecraftServerEndpoint(input)
  } catch {
    return null
  }
}
