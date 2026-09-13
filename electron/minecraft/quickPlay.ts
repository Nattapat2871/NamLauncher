// Author/creator: nattapat2871 (https://nattapat2871.me)

import type { MinecraftServerEndpoint } from './serverEndpoint.ts'

export type NamLauncherQuickPlayRequest =
  | Readonly<{ type: 'server'; address: string }>
  | Readonly<{ type: 'world'; folderName: string }>

export type MinecraftLauncherQuickPlay = Readonly<{
  type: 'singleplayer' | 'multiplayer' | 'legacy'
  identifier: string
}>

export const supportsModernMinecraftQuickPlay = (minecraftVersion: string) => {
  const value = String(minecraftVersion || '').trim()
  const calendarVersion = value.match(/^(\d{2,})(?:\.|$)/)
  if (calendarVersion) return Number(calendarVersion[1]) >= 26
  const snapshotVersion = value.match(/^(\d{2})w(\d{2})[a-z](?:_or_[a-z])?$/i)
  if (snapshotVersion) {
    const year = Number(snapshotVersion[1])
    const week = Number(snapshotVersion[2])
    return year > 23 || (year === 23 && week >= 14)
  }
  const releaseVersion = value.match(/^1\.(\d+)/)
  return Boolean(releaseVersion && Number(releaseVersion[1]) >= 20)
}

export const createServerQuickPlay = (
  endpoint: MinecraftServerEndpoint,
  minecraftVersion: string
): MinecraftLauncherQuickPlay | null => {
  if (supportsModernMinecraftQuickPlay(minecraftVersion)) {
    return Object.freeze({ type: 'multiplayer', identifier: endpoint.address })
  }

  // minecraft-launcher-core's legacy flag formatter cannot represent IPv6 safely.
  if (endpoint.ipVersion === 6) return null
  return Object.freeze({
    type: 'legacy',
    identifier: endpoint.port === 25565 ? endpoint.host : `${endpoint.host}:${endpoint.port}`
  })
}

export const createWorldQuickPlay = (
  folderName: string,
  minecraftVersion: string
): MinecraftLauncherQuickPlay | null => (
  supportsModernMinecraftQuickPlay(minecraftVersion)
    ? Object.freeze({ type: 'singleplayer', identifier: folderName })
    : null
)
