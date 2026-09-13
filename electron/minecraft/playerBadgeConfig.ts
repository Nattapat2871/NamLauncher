// Author/creator: nattapat2871 (https://nattapat2871.me)

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertPathWithinRoot } from '../pathSafety.ts'

export const PLAYER_BADGE_CONFIG_FILENAME = 'namlauncher-player-badge.json'
export const PLAYER_BADGE_CONFIG_SCHEMA = 1

const UUID_COMPACT_PATTERN = /^[0-9a-f]{32}$/

export const normalizePlayerBadgeUuid = (value: unknown) => {
  const compact = String(value || '').trim().toLowerCase().replaceAll('-', '')
  if (!UUID_COMPACT_PATTERN.test(compact)) return null
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20)
  ].join('-')
}

const isAllowedLookupEndpoint = (value: string) => {
  try {
    const endpoint = new URL(value)
    if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) return false
    if (endpoint.pathname !== '/api/player-badges/lookup') return false
    if (endpoint.protocol === 'https:' && endpoint.hostname === 'namlauncher.nattapat2871.me') {
      return !endpoint.port || endpoint.port === '443'
    }
    return endpoint.protocol === 'http:'
      && (endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost')
  } catch {
    return false
  }
}

export const writePlayerBadgeConfig = (options: Readonly<{
  gameDirectory: string
  enabled: boolean
  playerUuid: unknown
  lookupEndpoint: string
}>) => {
  const gameDirectory = path.resolve(options.gameDirectory)
  const configDirectory = path.join(gameDirectory, 'config')
  const configPath = path.join(configDirectory, PLAYER_BADGE_CONFIG_FILENAME)
  assertPathWithinRoot(gameDirectory, configDirectory)
  assertPathWithinRoot(gameDirectory, configPath)
  const playerUuid = normalizePlayerBadgeUuid(options.playerUuid)
  const enabled = options.enabled === true && playerUuid !== null
  if (enabled && !isAllowedLookupEndpoint(options.lookupEndpoint)) {
    throw new Error('Player badge lookup endpoint is not trusted.')
  }
  fs.mkdirSync(configDirectory, { recursive: true })
  const directoryInfo = fs.lstatSync(configDirectory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error('Player badge configuration directory is not a safe local directory.')
  }

  const payload = {
    schemaVersion: PLAYER_BADGE_CONFIG_SCHEMA,
    enabled,
    selfPlayerUuid: enabled ? playerUuid : null,
    lookupEndpoint: enabled ? options.lookupEndpoint : null,
    refreshSeconds: 30,
    requestTimeoutSeconds: 4,
    author: 'nattapat2871 (https://nattapat2871.me)'
  }
  const temporaryPath = `${configPath}.${crypto.randomUUID()}.tmp`
  assertPathWithinRoot(configDirectory, temporaryPath)
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  try {
    fs.rmSync(configPath, { force: true })
    fs.renameSync(temporaryPath, configPath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
  return { configPath, enabled, playerUuid: enabled ? playerUuid : null }
}
