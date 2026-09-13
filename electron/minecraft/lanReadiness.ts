// Author/creator: nattapat2871 (https://nattapat2871.me)

export type LanNetworkInterface = {
  address?: unknown
  family?: unknown
  internal?: unknown
}

export type LanReadinessInput = {
  interfaces: Record<string, LanNetworkInterface[] | undefined>
  detectedPort?: unknown
}

const normalize = (value: unknown) => String(value || '').trim()

const isPrivateIpv4 = (address: string) => {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return parts[0] === 192 && parts[1] === 168
}

export const getPrivateLanAddresses = (interfaces: LanReadinessInput['interfaces']) => {
  const results: string[] = []
  const seen = new Set<string>()
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      const address = normalize(entry?.address)
      const family = normalize(entry?.family).toLowerCase()
      if (entry?.internal === true || (family !== 'ipv4' && family !== '4') || !isPrivateIpv4(address) || seen.has(address)) continue
      seen.add(address)
      results.push(address)
    }
  }
  return results.sort((left, right) => left.localeCompare(right))
}

export const detectLanPortFromLogLine = (line: unknown) => {
  const text = normalize(line)
  const patterns = [
    /Started serving on(?: port)?\s+(\d{1,5})/i,
    /Local game hosted on port\s+(\d{1,5})/i,
    /Started Minecraft server on \*:(\d{1,5})/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const port = Number(match?.[1] || 0)
    if (port >= 1 && port <= 65_535) return port
  }
  return null
}

export const assessLanReadiness = (input: LanReadinessInput) => {
  const addresses = getPrivateLanAddresses(input.interfaces)
  const port = Number(input.detectedPort)
  const detectedPort = Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
  return {
    addresses,
    detectedPort
  }
}
