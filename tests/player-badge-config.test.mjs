// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  normalizePlayerBadgeUuid,
  PLAYER_BADGE_CONFIG_FILENAME,
  writePlayerBadgeConfig
} from '../electron/minecraft/playerBadgeConfig.ts'

test('normalizes compact and dashed Minecraft UUIDs without accepting arbitrary text', () => {
  assert.equal(
    normalizePlayerBadgeUuid('12345678123442349234123456789ABC'),
    '12345678-1234-4234-9234-123456789abc'
  )
  assert.equal(
    normalizePlayerBadgeUuid('12345678-1234-4234-9234-123456789ABC'),
    '12345678-1234-4234-9234-123456789abc'
  )
  assert.equal(normalizePlayerBadgeUuid('not-a-player-uuid'), null)
})

test('writes a bounded secret-free player badge configuration and disables invalid identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-badge-config-'))
  try {
    const enabled = writePlayerBadgeConfig({
      gameDirectory: root,
      enabled: true,
      playerUuid: '12345678123442349234123456789abc',
      lookupEndpoint: 'https://namlauncher.nattapat2871.me/api/player-badges/lookup'
    })
    const payload = JSON.parse(await readFile(
      path.join(root, 'config', PLAYER_BADGE_CONFIG_FILENAME),
      'utf8'
    ))
    assert.equal(enabled.enabled, true)
    assert.equal(payload.enabled, true)
    assert.equal(payload.selfPlayerUuid, '12345678-1234-4234-9234-123456789abc')
    assert.equal(payload.lookupEndpoint, 'https://namlauncher.nattapat2871.me/api/player-badges/lookup')
    assert.equal(JSON.stringify(payload).includes('token'), false)

    const disabled = writePlayerBadgeConfig({
      gameDirectory: root,
      enabled: true,
      playerUuid: 'invalid',
      lookupEndpoint: 'https://attacker.invalid/api/player-badges/lookup'
    })
    assert.equal(disabled.enabled, false)
    assert.equal(JSON.parse(await readFile(
      path.join(root, 'config', PLAYER_BADGE_CONFIG_FILENAME),
      'utf8'
    )).lookupEndpoint, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects third-party endpoints and a symlinked configuration directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-badge-safe-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-badge-outside-'))
  try {
    assert.throws(() => writePlayerBadgeConfig({
      gameDirectory: root,
      enabled: true,
      playerUuid: '12345678123442349234123456789abc',
      lookupEndpoint: 'https://attacker.invalid/api/player-badges/lookup'
    }), /not trusted/)

    await symlink(outside, path.join(root, 'config'), 'junction')
    assert.throws(() => writePlayerBadgeConfig({
      gameDirectory: root,
      enabled: true,
      playerUuid: '12345678123442349234123456789abc',
      lookupEndpoint: 'https://namlauncher.nattapat2871.me/api/player-badges/lookup'
    }), /(?:not a safe local directory|symbolic link|junction)/)
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') t.skip('Symlink creation is unavailable')
    else throw error
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('wires the default-enabled setting, launch configuration, presence heartbeat, and shutdown', async () => {
  const [mainSource, appSource, textSource] = await Promise.all([
    readFile(path.resolve('electron', 'main.ts'), 'utf8'),
    readFile(path.resolve('src', 'App.tsx'), 'utf8'),
    readFile(path.resolve('src', 'appText.ts'), 'utf8')
  ])
  assert.match(mainSource, /playerBadgeEnabled: settings\.playerBadgeEnabled \?\? true/)
  assert.match(mainSource, /writePlayerBadgeConfig\(\{[\s\S]*lookupEndpoint: `\$\{STATS_API_BASE\}\/api\/player-badges\/lookup`/)
  assert.match(mainSource, /startPlayerBadgePresence\(runningGame, settings\)/)
  assert.match(mainSource, /queuePlayerBadgePresence\(game, 'heartbeat'\)/)
  assert.match(mainSource, /queuePlayerBadgePresence\(closedGame, 'end'\)/)
  assert.match(mainSource, /player_badge_enabled: readLauncherSettings\(\)\.playerBadgeEnabled/)
  assert.match(mainSource, /configureGameSessionTelemetry[\s\S]*queueGameSessionEvent\(game, 'heartbeat'\)/)
  assert.match(mainSource, /player_uuid_aliases: playerUuidAliases/)
  assert.match(mainSource, /getOfflineUuid\(game\.playerName\)/)
  assert.match(mainSource, /\['msa', 'offline'\]\.includes\(game\.accountType\)/)
  assert.match(appSource, /playerBadgeEnabled: true/)
  assert.match(appSource, /settings\.playerBadge\.title/)
  assert.match(textSource, /บัญชี Microsoft และ Offline[\s\S]*มองเห็นกันได้ทั้งสองประเภท/)
})
