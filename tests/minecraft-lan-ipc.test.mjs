// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLanDiscoveryCoordinator,
  isTrustedRendererSender,
  shouldPublishLanSessionPort,
  summarizeMinecraftLanServers
} from '../electron/minecraft/lanIpc.ts'

const server = {
  address: '192.168.1.20',
  port: 51_234,
  endpoint: '192.168.1.20:51234',
  motd: 'Private description'
}

test('coalesces concurrent discovery and resets after a successful result', async () => {
  let resolveDiscovery
  let calls = 0
  const coordinator = createLanDiscoveryCoordinator(() => {
    calls += 1
    return new Promise((resolve) => { resolveDiscovery = resolve })
  })

  const first = coordinator()
  const second = coordinator()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  resolveDiscovery([server])
  assert.deepEqual(await first, [{
    address: server.address,
    port: server.port,
    endpoint: server.endpoint
  }])

  const third = coordinator()
  assert.notEqual(third, first)
  await Promise.resolve()
  assert.equal(calls, 2)
  resolveDiscovery([])
  assert.deepEqual(await third, [])
})

test('coalesces a rejected discovery and resets so a later request can recover', async () => {
  let rejectDiscovery
  let calls = 0
  const coordinator = createLanDiscoveryCoordinator(() => {
    calls += 1
    return new Promise((_resolve, reject) => { rejectDiscovery = reject })
  })

  const first = coordinator()
  const second = coordinator()
  await Promise.resolve()
  rejectDiscovery(new Error('socket unavailable'))
  await assert.rejects(first, /socket unavailable/)
  await assert.rejects(second, /socket unavailable/)

  const retry = coordinator()
  await Promise.resolve()
  assert.equal(calls, 2)
  rejectDiscovery(new Error('still unavailable'))
  await assert.rejects(retry, /still unavailable/)
})

test('strips MOTD and any extra fields from the renderer LAN summary', () => {
  assert.deepEqual(summarizeMinecraftLanServers([server]), [{
    address: server.address,
    port: server.port,
    endpoint: server.endpoint
  }])
})

test('accepts IPC only from the live main renderer webContents', () => {
  const webContents = { isDestroyed: () => false }
  const window = { isDestroyed: () => false, webContents }
  assert.equal(isTrustedRendererSender(window, webContents), true)
  assert.equal(isTrustedRendererSender(window, {}), false)
  assert.equal(isTrustedRendererSender(null, webContents), false)
  assert.equal(isTrustedRendererSender({ ...window, isDestroyed: () => true }, webContents), false)
  assert.equal(isTrustedRendererSender({
    ...window,
    webContents: { isDestroyed: () => true }
  }, webContents), false)
})

test('publishes a LAN session event only for a new valid port', () => {
  assert.equal(shouldPublishLanSessionPort(null, 54_321), true)
  assert.equal(shouldPublishLanSessionPort(54_321, 54_321), false)
  assert.equal(shouldPublishLanSessionPort(54_321, 0), false)
  assert.equal(shouldPublishLanSessionPort(54_321, 99_999), false)
})
