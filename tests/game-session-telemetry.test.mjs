// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  GAME_SESSION_HEARTBEAT_INTERVAL_MS,
  getGameSessionEndReason,
  normalizeGameSessionLoader
} from '../shared/gameSessionTelemetry.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const textSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('normalizes bounded loader values and close reasons', () => {
  assert.equal(normalizeGameSessionLoader('Fabric'), 'fabric')
  assert.equal(normalizeGameSessionLoader('unsupported'), 'unknown')
  assert.equal(getGameSessionEndReason(true), 'user-stop')
  assert.equal(getGameSessionEndReason(false), 'game-exit')
  assert.equal(GAME_SESSION_HEARTBEAT_INTERVAL_MS, 45_000)
})

test('emits start, heartbeat, and end without exposing account credentials', () => {
  assert.match(mainSource, /postGameSessionEvent[\s\S]*'\/api\/game-sessions\/events'/)
  assert.match(mainSource, /player_badge_enabled: readLauncherSettings\(\)\.playerBadgeEnabled/)
  assert.match(mainSource, /startGameSessionTelemetry\(runningGame, settings\)/)
  assert.match(mainSource, /sendGameSessionHeartbeats[\s\S]*queueGameSessionEvent\(game, 'heartbeat'\)/)
  assert.match(mainSource, /queueGameSessionEvent\(closedGame, 'end'/)
  assert.match(mainSource, /endReason: 'launcher-exit'/)
  assert.match(mainSource, /Object\.assign\(sessionHeaders, getLauncherDiscordIdentityHeader\(\)\)/)
  assert.match(mainSource, /server_address: game\.currentServer\.address/)
  assert.doesNotMatch(mainSource, /game-sessions\/events[\s\S]{0,1000}(access_token|refresh_token|authorization\?\.)/i)
})

test('publishes the current badge preference across the full session lifecycle', () => {
  assert.match(
    mainSource,
    /const configureGameSessionTelemetry[\s\S]*game\.telemetryActive[\s\S]*queueGameSessionEvent\(game, 'heartbeat'\)[\s\S]*startGameSessionTelemetry\(game, settings\)/
  )
  assert.match(mainSource, /event === 'start'[\s\S]*event === 'end'/)
  assert.match(mainSource, /player_badge_enabled: readLauncherSettings\(\)\.playerBadgeEnabled/)
})

test('keeps mandatory tray heartbeat independent from Discord visibility', () => {
  assert.match(mainSource, /anonymousStatsEnabled: true/)
  assert.match(mainSource, /gameplayTelemetryEnabled: true/)
  assert.match(mainSource, /restrictedModAuditEnabled: true/)
  assert.match(mainSource, /const keepOnlineHeartbeatRunning[\s\S]*isAppQuitting[\s\S]*onlineHeartbeatTimer/)
  assert.doesNotMatch(mainSource, /if \(!settings\.anonymousStatsEnabled/)
  assert.doesNotMatch(mainSource, /if \(!settings\.gameplayTelemetryEnabled/)
  assert.doesNotMatch(mainSource, /if \(!settings\.restrictedModAuditEnabled/)
  assert.doesNotMatch(appSource, /anonymousStatsEnabled: !discordSettings\.anonymousStatsEnabled/)
  assert.doesNotMatch(appSource, /gameplayTelemetryEnabled: !discordSettings\.gameplayTelemetryEnabled/)
  assert.doesNotMatch(appSource, /restrictedModAuditEnabled: !discordSettings\.restrictedModAuditEnabled/)
  assert.doesNotMatch(appSource, /settings\.restrictedModAudit/)
  assert.doesNotMatch(textSource, /settings\.restrictedModAudit/)
  assert.match(appSource, /settings\.required/)
  assert.match(textSource, /Required service heartbeat; this setting cannot be disabled/)
  assert.match(mainSource, /sendOnlineHeartbeat\(\)[\s\S]*sendGameSessionHeartbeats\(\)/)
})
