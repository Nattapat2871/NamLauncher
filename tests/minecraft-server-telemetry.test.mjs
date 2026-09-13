// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMinecraftServerTelemetryState,
  parseMinecraftServerLogEvent
} from '../electron/minecraft/serverTelemetry.ts'

test('detects manual multiplayer connections from common Minecraft log formats', () => {
  assert.deepEqual(
    parseMinecraftServerLogEvent('[Render thread/INFO]: Connecting to play.minisand.online, 25565'),
    { type: 'connected', endpoint: 'play.minisand.online:25565' }
  )
  assert.deepEqual(
    parseMinecraftServerLogEvent('[Render thread/INFO]: Connecting to 192.168.1.20:25570'),
    { type: 'connected', endpoint: '192.168.1.20:25570' }
  )
  assert.deepEqual(
    parseMinecraftServerLogEvent('[Render thread/INFO]: Disconnected from server'),
    { type: 'disconnected' }
  )
})

test('uses saved names while retaining canonical addresses for owner analytics', () => {
  const minisand = createMinecraftServerTelemetryState('play.minisand.online:25565', [
    { canonicalKey: 'play.minisand.online:25565', name: 'MiniSand' }
  ])
  const lan = createMinecraftServerTelemetryState('192.168.1.20:25570')
  const publicIp = createMinecraftServerTelemetryState('203.0.113.10:25565')

  assert.equal(minisand?.label, 'MiniSand')
  assert.equal(minisand?.kind, 'domain')
  assert.match(minisand?.key || '', /^[a-f0-9]{64}$/)
  assert.equal(lan?.label, 'LAN / Private server')
  assert.equal(lan?.kind, 'private_ip')
  assert.equal(lan?.address, '192.168.1.20:25570')
  assert.equal(publicIp?.label, 'Public server')
  assert.equal(publicIp?.kind, 'public_ip')
  assert.equal(publicIp?.address, '203.0.113.10:25565')
})

test('rejects unsafe or unrelated log lines', () => {
  assert.equal(parseMinecraftServerLogEvent('Connecting to https://example.com, 25565'), null)
  assert.equal(parseMinecraftServerLogEvent('Player connected to proxy'), null)
  assert.equal(createMinecraftServerTelemetryState('user@example.com'), null)
})
