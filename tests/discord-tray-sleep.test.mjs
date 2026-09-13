// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'

const discordSource = await readFile(new URL('../electron/discord.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const settings = { discordRpcEnabled: true, discordClientId: 'test-client', launcherVersion: '1.1.16' }

function createRpcHarness() {
  const clients = [], timers = new Map()
  let timerId = 0
  class Client extends EventEmitter {
    activities = []; cleared = []; destroyed = 0
    login() { return Promise.resolve() }
    setActivity(presence, pid) {
      this.activities.push({ presence, pid })
      return this.pendingActivity || Promise.resolve()
    }
    clearActivity(pid) { this.cleared.push(pid); return this.pendingClear || Promise.resolve() }
    destroy() { this.destroyed++; this.emit('disconnected'); return Promise.resolve() }
    constructor() { super(); clients.push(this) }
  }
  const code = stripTypeScriptTypes(discordSource.replace(/^import .*$/gm, '').replace(/^export /gm, ''))
  const Manager = runInNewContext(code + '\nDiscordManager', {
    DiscordRPC: { Client }, log: { info() {}, debug() {}, warn() {} }, process, Date,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId },
    clearTimeout: id => timers.delete(id)
  })
  return { manager: new Manager(), clients, timers }
}

test('tray shutdown clears game activity and stale callbacks cannot reconnect or publish', async () => {
  const { manager, clients, timers } = createRpcHarness()
  manager.configure(settings)
  clients[0].emit('ready')
  await flush()
  manager.setLauncherGameStatus('Instance', '1.20.1', 'Player', '', 7654, null)
  await flush()
  manager.shutdown()
  manager.setIdleStatus()
  manager.setInGameStatus('Old instance', '1.20.1', 'Player', '', 7654, null)
  manager.setLauncherGameStatus('Old instance', '1.20.1', 'Player', '', 7654, null)
  clients[0].emit('ready')
  clients[0].emit('disconnected')
  await flush()
  assert.ok(clients[0].cleared.includes(7654))
  assert.equal(clients[0].destroyed, 1)
  assert.equal(clients.length, 1)
  assert.equal(timers.size, 0)
  assert.equal(manager.getStatus().state, 'suspended')
  assert.equal(manager.getStatus().lastActivity, null)
  assert.equal(await manager.waitUntilConnected(), false)
  manager.configure(settings)
  clients[1].emit('ready')
  await flush()
  assert.equal(manager.getStatus().state, 'connected')
  assert.equal(clients[1].activities.length, 1)
})

test('an in-flight game publish is cleared with its actual pid and cannot revive state after sleep', async () => {
  const { manager, clients, timers } = createRpcHarness()
  manager.configure(settings); clients[0].emit('ready'); await flush()
  let resolveActivity
  clients[0].pendingActivity = new Promise(resolve => { resolveActivity = resolve })
  manager.setLauncherGameStatus('Game', '1.20.1', 'Player', '', 4321, null)
  await flush()
  manager.shutdown()
  resolveActivity(); await flush()
  assert.equal(clients[0].cleared.at(-1), 4321)
  assert.equal(manager.getStatus().lastActivity, null)
  assert.equal(manager.getStatus().connected, false)
  assert.equal(timers.size, 0)
})

test('tray shutdown cancels scheduled reconnects and never overrides an explicit disabled setting', async () => {
  const { manager, clients, timers } = createRpcHarness()
  manager.configure(settings); clients[0].emit('ready'); await flush()
  clients[0].emit('disconnected')
  assert.equal(timers.size, 1)
  const staleReconnect = [...timers.values()][0]
  manager.shutdown()
  assert.equal(timers.size, 0)
  staleReconnect()
  assert.equal(clients.length, 1)
  manager.configure({ ...settings, discordRpcEnabled: false })
  manager.setIdleStatus()
  await flush()
  assert.equal(clients.length, 1)
  assert.equal(manager.getStatus().state, 'disabled')
})

test('tray shutdown while Discord is still connecting ignores a late ready event', async () => {
  const { manager, clients, timers } = createRpcHarness()
  manager.configure(settings)
  manager.shutdown()
  clients[0].emit('ready'); await flush()
  assert.equal(clients[0].activities.length, 0)
  assert.equal(clients[0].destroyed, 1)
  assert.equal(manager.getStatus().state, 'suspended')
  assert.equal(timers.size, 0)
})

test('an old publish rejection or queued transition cannot disturb a reopened RPC connection', async () => {
  const { manager, clients, timers } = createRpcHarness()
  manager.configure(settings); clients[0].emit('ready'); await flush()
  let rejectActivity
  clients[0].pendingActivity = new Promise((_, reject) => { rejectActivity = reject })
  manager.setIdleStatus()
  // Force a changed payload so the previous idle signature is not deduplicated.
  manager.setLauncherGameStatus('Game', '1.20.1', 'Player', '', 4321, null)
  await flush()
  manager.shutdown(); manager.configure(settings); clients[1].emit('ready'); await flush()
  rejectActivity(new Error('socket closed')); await flush()
  assert.equal(manager.getStatus().state, 'connected')
  assert.equal(clients[1].destroyed, 0)
  assert.equal(timers.size, 0)

  let resolveClear
  clients[1].pendingClear = new Promise(resolve => { resolveClear = resolve })
  manager.setLauncherGameStatus('Stale transition', '1.20.1', 'Player', '', 9876, null)
  manager.shutdown(); manager.configure(settings); clients[2].emit('ready'); await flush()
  resolveClear(); await flush()
  assert.ok(clients[2].activities.every(item => item.presence.state !== 'Stale transition'))
})

test('tray sleep gates every presence refresh while taskbar minimization and heartbeat remain independent', () => {
  const events = []
  let runningGame = null, hasTray = true
  const extract = (start, end) => mainSource.slice(mainSource.indexOf(start), mainSource.indexOf(end))
  const code = [
    'let launcherRestingInTray = false; let isAppQuitting = false;',
    extract('const syncDiscordForLauncherState =', 'const cleanupStaleLaunches ='),
    extract('const showMainWindow =', 'const requestAppQuit ='),
    extract('const hideLauncherToTray =', 'const closeLauncherWindow ='),
    extract('const configureDiscordForActiveGames =', "trustedIpcHandle('set-discord-settings'"),
    '({ showMainWindow, hideLauncherToTray, minimizeLauncherToTaskbar, configureDiscordForActiveGames })'
  ].join('\n')
  let visible = true, minimized = false
  const lifecycle = runInNewContext(stripTypeScriptTypes(code), {
    mainWindow: {
      isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible,
      restore() { minimized = false; visible = true }, show() { visible = true }, hide() { visible = false },
      minimize() { minimized = true }, setSkipTaskbar() {}, moveTop() {}, focus() {}, webContents: { focus() {} }
    },
    getLatestRunningGame: () => runningGame, readLauncherSettings: () => settings,
    getDiscordRuntimeSettings: value => value, getMinecraftDiscordRuntimeSettings: value => value,
    discordManager: { shutdown: () => events.push('sleep'), configure: () => events.push('configure'),
      setIdleStatus: () => events.push('idle'), setLauncherGameStatus: () => events.push('game') },
    minecraftDiscordManager: { shutdown() {} },
    keepOnlineHeartbeatRunning: () => events.push('heartbeat'), ensureTray: () => hasTray,
    tray: { setToolTip() {} }, app: { getVersion: () => '1.1.16' }, hasActiveMinecraft: () => !!runningGame,
    getActiveMinecraftCount: () => 1
  })
  lifecycle.hideLauncherToTray()
  assert.deepEqual(events, ['heartbeat', 'sleep'])
  runningGame = { instanceName: 'Game' }
  lifecycle.configureDiscordForActiveGames(settings)
  lifecycle.configureDiscordForActiveGames({ ...settings, discordRpcEnabled: false })
  assert.deepEqual(events, ['heartbeat', 'sleep', 'sleep', 'sleep'])
  lifecycle.showMainWindow()
  assert.deepEqual(events.slice(-2), ['configure', 'game'])
  events.length = 0
  lifecycle.minimizeLauncherToTaskbar()
  assert.deepEqual(events, ['heartbeat', 'configure', 'game'])
  hasTray = false; events.length = 0
  lifecycle.hideLauncherToTray()
  lifecycle.configureDiscordForActiveGames(settings)
  assert.ok(!events.includes('sleep'), 'No tray available: keep the ordinary taskbar fallback')
})
