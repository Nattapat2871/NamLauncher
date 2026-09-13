// Author/creator: nattapat2871 (https://nattapat2871.me)

import type { MinecraftServerListEntry } from './serversDat.ts'
import { tryNormalizeMinecraftServerEndpoint } from './serverEndpoint.ts'

export const MAX_INSTANCE_SERVER_PINGS = 60
export const MAX_FILTERED_INSTANCE_SERVER_PINGS = 4

export type MinecraftServerPingTarget = Readonly<{
  server: MinecraftServerListEntry
  requestedAddresses: readonly string[]
}>

/**
 * Selects only saved servers. A renderer-provided address filter can narrow network work,
 * but can never make the main process ping an address absent from servers.dat.
 */
export const selectMinecraftServerPingTargets = (
  servers: readonly MinecraftServerListEntry[],
  requestedAddresses: unknown
): readonly MinecraftServerPingTarget[] => {
  if (requestedAddresses === undefined) {
    return servers.slice(0, MAX_INSTANCE_SERVER_PINGS).map((server) => ({
      server,
      requestedAddresses: []
    }))
  }
  if (!Array.isArray(requestedAddresses)) return []

  const requestedAddressesByCanonicalKey = new Map<string, string[]>()
  for (const value of requestedAddresses.slice(0, MAX_FILTERED_INSTANCE_SERVER_PINGS)) {
    if (typeof value !== 'string') continue
    const endpoint = tryNormalizeMinecraftServerEndpoint(value)
    if (!endpoint) continue
    const aliases = requestedAddressesByCanonicalKey.get(endpoint.canonicalKey) || []
    if (!aliases.includes(value)) aliases.push(value)
    requestedAddressesByCanonicalKey.set(endpoint.canonicalKey, aliases)
  }
  if (requestedAddressesByCanonicalKey.size === 0) return []

  const selected: MinecraftServerPingTarget[] = []
  const seenCanonicalKeys = new Set<string>()
  for (const server of servers) {
    if (
      !server.canonicalKey
      || !requestedAddressesByCanonicalKey.has(server.canonicalKey)
      || seenCanonicalKeys.has(server.canonicalKey)
    ) continue
    seenCanonicalKeys.add(server.canonicalKey)
    selected.push({
      server,
      requestedAddresses: requestedAddressesByCanonicalKey.get(server.canonicalKey) || []
    })
    if (selected.length >= MAX_FILTERED_INSTANCE_SERVER_PINGS) break
  }
  return selected
}

export const selectMinecraftServersForPing = (
  servers: readonly MinecraftServerListEntry[],
  requestedAddresses: unknown
): readonly MinecraftServerListEntry[] => (
  selectMinecraftServerPingTargets(servers, requestedAddresses).map(({ server }) => server)
)
