// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MAX_MINECRAFT_LAN_BYTES_PER_SCAN,
  MAX_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS,
  MAX_MINECRAFT_LAN_MOTD_CODE_POINTS,
  MAX_MINECRAFT_LAN_PACKET_BYTES,
  MAX_MINECRAFT_LAN_PACKETS_PER_SCAN,
  MAX_MINECRAFT_LAN_SERVERS,
  MIN_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS,
  MINECRAFT_LAN_MULTICAST_ADDRESS,
  MINECRAFT_LAN_MULTICAST_PORT,
  dedupeAndSortMinecraftLanServers,
  discoverMinecraftLanServers,
  isPrivateOrLinkLocalIpv4,
  parseMinecraftLanAnnouncement,
  sanitizeMinecraftLanMotd
} from '../electron/minecraft/lanDiscovery.ts'

class FakeDiscoverySocket extends EventEmitter {
  constructor({ bindError, membershipError } = {}) {
    super()
    this.bindError = bindError
    this.membershipError = membershipError
    this.bindCalls = []
    this.memberships = []
    this.closeCalls = 0
    this.unrefCalls = 0
    this.sendCalls = 0
  }

  bind(port, address) {
    if (this.bindError) throw this.bindError
    this.bindCalls.push([port, address])
    queueMicrotask(() => this.emit('listening'))
  }

  addMembership(address) {
    if (this.membershipError) throw this.membershipError
    this.memberships.push(address)
  }

  close() {
    this.closeCalls += 1
  }

  unref() {
    this.unrefCalls += 1
    return this
  }

  send() {
    this.sendCalls += 1
    throw new Error('Passive discovery must not send UDP packets')
  }
}

const announce = (motd, port) => Buffer.from(`[MOTD]${motd}[/MOTD][AD]${port}[/AD]`, 'utf8')

test('parses standard announcements only from private or link-local IPv4 sources', () => {
  assert.deepEqual(parseMinecraftLanAnnouncement(announce('Living Room', 25565), '192.168.1.20'), {
    address: '192.168.1.20',
    port: 25565,
    endpoint: '192.168.1.20:25565',
    motd: 'Living Room'
  })
  assert.equal(parseMinecraftLanAnnouncement(announce('Link local', 49152), { address: '169.254.8.3' }).endpoint, '169.254.8.3:49152')
  assert.equal(parseMinecraftLanAnnouncement(announce('Low boundary', 1), '10.0.0.2').port, 1)
  assert.equal(parseMinecraftLanAnnouncement(announce('High boundary', 65535), '10.0.0.2').port, 65535)

  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.255.1', '169.254.1.1']) {
    assert.equal(isPrivateOrLinkLocalIpv4(address), true, address)
  }
  for (const address of ['127.0.0.1', '172.32.0.1', '203.0.113.5', '224.0.2.60', '::1', '010.0.0.1']) {
    assert.equal(parseMinecraftLanAnnouncement(announce('Rejected', 25565), address), null, address)
  }
})

test('rejects malformed, oversized, invalid UTF-8, and out-of-range announcements', () => {
  const oversized = Buffer.alloc(MAX_MINECRAFT_LAN_PACKET_BYTES + 1, 0x41)
  const invalidUtf8 = Buffer.from([0x5b, 0x4d, 0x4f, 0x54, 0x44, 0x5d, 0xc3, 0x28])
  const invalidPackets = [
    Buffer.from('not-an-announcement'),
    Buffer.from('[MOTD]Missing port[/MOTD]'),
    Buffer.from('[MOTD]Wrong order[AD]25565[/AD][/MOTD]'),
    Buffer.from('[MOTD]Spoof[/MOTD]nested[/MOTD][AD]25565[/AD]'),
    announce('Zero', 0),
    announce('Too high', 65536),
    Buffer.from('[MOTD]Text[/MOTD][AD]-1[/AD]'),
    Buffer.from('[MOTD]Text[/MOTD][AD]1[/AD]trailing'),
    oversized,
    invalidUtf8
  ]
  for (const packet of invalidPackets) {
    assert.equal(parseMinecraftLanAnnouncement(packet, '192.168.1.2'), null)
  }
})

test('sanitizes controls and bidi markers, normalizes whitespace, and bounds MOTD by code point', () => {
  const repeated = '🐉'.repeat(MAX_MINECRAFT_LAN_MOTD_CODE_POINTS + 5)
  assert.equal(sanitizeMinecraftLanMotd('  Safe\n\u001b[31mName\u202e  here\u0000 '), 'Safe Name here')
  const bounded = sanitizeMinecraftLanMotd(repeated)
  assert.equal(Array.from(bounded).length, MAX_MINECRAFT_LAN_MOTD_CODE_POINTS)
  assert.equal(bounded.endsWith('🐉'), true)
})

test('deduplicates by endpoint, keeps the latest safe MOTD, and sorts IPv4 numerically then by port', () => {
  const result = dedupeAndSortMinecraftLanServers([
    { address: '192.168.1.10', port: 25565, endpoint: 'ignored', motd: 'Old' },
    { address: '192.168.1.2', port: 50000, endpoint: 'ignored', motd: 'Second port' },
    { address: '192.168.1.2', port: 25565, endpoint: 'ignored', motd: 'First' },
    { address: '192.168.1.10', port: 25565, endpoint: 'ignored', motd: 'Latest\nname' },
    { address: '203.0.113.4', port: 25565, endpoint: 'ignored', motd: 'Public' }
  ])

  assert.deepEqual(result.map(({ endpoint, motd }) => ({ endpoint, motd })), [
    { endpoint: '192.168.1.2:25565', motd: 'First' },
    { endpoint: '192.168.1.2:50000', motd: 'Second port' },
    { endpoint: '192.168.1.10:25565', motd: 'Latest name' }
  ])
})

test('passively collects, filters, deduplicates, and closes a reuseAddr multicast socket on timeout', async () => {
  const socket = new FakeDiscoverySocket()
  const socketOptions = []
  const resultPromise = discoverMinecraftLanServers({
    timeoutMs: 25,
    socketFactory: (options) => {
      socketOptions.push(options)
      return socket
    }
  })

  await Promise.resolve()
  socket.emit('message', announce('Ten', 25565), { address: '192.168.1.10' })
  socket.emit('message', announce('Two old', 25565), { address: '192.168.1.2' })
  socket.emit('message', announce('Two latest', 25565), { address: '192.168.1.2' })
  socket.emit('message', announce('Public', 25565), { address: '198.51.100.4' })
  socket.emit('message', Buffer.from('garbage'), { address: '192.168.1.3' })

  const result = await resultPromise
  assert.deepEqual(socketOptions, [{ type: 'udp4', reuseAddr: true }])
  assert.deepEqual(socket.bindCalls, [[MINECRAFT_LAN_MULTICAST_PORT, '0.0.0.0']])
  assert.deepEqual(socket.memberships, [MINECRAFT_LAN_MULTICAST_ADDRESS])
  assert.equal(socket.unrefCalls, 1)
  assert.equal(socket.sendCalls, 0)
  assert.equal(socket.closeCalls, 1)
  assert.deepEqual(result.map(({ endpoint, motd }) => ({ endpoint, motd })), [
    { endpoint: '192.168.1.2:25565', motd: 'Two latest' },
    { endpoint: '192.168.1.10:25565', motd: 'Ten' }
  ])
})

test('resolves an empty result and closes the socket when the bounded timeout expires', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const socket = new FakeDiscoverySocket()
  const resultPromise = discoverMinecraftLanServers({ timeoutMs: 25, socketFactory: () => socket })
  await Promise.resolve()

  assert.equal(socket.closeCalls, 0)
  context.mock.timers.tick(25)
  assert.deepEqual(await resultPromise, [])
  assert.equal(socket.closeCalls, 1)
})

test('clamps low and high discovery timeouts before scheduling socket cleanup', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })

  const lowSocket = new FakeDiscoverySocket()
  const lowResult = discoverMinecraftLanServers({ timeoutMs: -50, socketFactory: () => lowSocket })
  await Promise.resolve()
  context.mock.timers.tick(MIN_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS - 1)
  assert.equal(lowSocket.closeCalls, 0)
  context.mock.timers.tick(1)
  assert.deepEqual(await lowResult, [])
  assert.equal(lowSocket.closeCalls, 1)

  const highSocket = new FakeDiscoverySocket()
  const highResult = discoverMinecraftLanServers({ timeoutMs: Number.MAX_SAFE_INTEGER, socketFactory: () => highSocket })
  await Promise.resolve()
  context.mock.timers.tick(MAX_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS - 1)
  assert.equal(highSocket.closeCalls, 0)
  context.mock.timers.tick(1)
  assert.deepEqual(await highResult, [])
  assert.equal(highSocket.closeCalls, 1)
})

test('bounds unique discoveries while allowing an existing endpoint to refresh', async () => {
  const socket = new FakeDiscoverySocket()
  const resultPromise = discoverMinecraftLanServers({ timeoutMs: 25, socketFactory: () => socket })
  await Promise.resolve()

  for (let index = 0; index < MAX_MINECRAFT_LAN_SERVERS + 20; index += 1) {
    const secondOctet = Math.floor(index / (256 * 256))
    const thirdOctet = Math.floor(index / 256) % 256
    const fourthOctet = index % 256
    socket.emit('message', announce(`Server ${index}`, 25565), {
      address: `10.${secondOctet}.${thirdOctet}.${fourthOctet}`
    })
  }
  socket.emit('message', announce('Refreshed', 25565), { address: '10.0.0.0' })

  const result = await resultPromise
  assert.equal(result.length, MAX_MINECRAFT_LAN_SERVERS)
  assert.equal(result[0].motd, 'Refreshed')
  assert.equal(result.some(({ address }) => address === '10.0.1.19'), false)
  assert.equal(socket.closeCalls, 1)
})

test('stops a duplicate-endpoint packet flood at the per-scan packet budget', async () => {
  const socket = new FakeDiscoverySocket()
  const resultPromise = discoverMinecraftLanServers({ timeoutMs: 10_000, socketFactory: () => socket })
  await Promise.resolve()

  for (let index = 0; index < MAX_MINECRAFT_LAN_PACKETS_PER_SCAN + 20; index += 1) {
    socket.emit('message', announce(`Flood ${index}`, 25565), { address: '192.168.1.20' })
  }

  const result = await resultPromise
  assert.equal(socket.closeCalls, 1)
  assert.equal(result.length, 1)
  assert.equal(result[0].endpoint, '192.168.1.20:25565')
  assert.equal(result[0].motd, `Flood ${MAX_MINECRAFT_LAN_PACKETS_PER_SCAN - 1}`)
})

test('counts malformed packet bytes and stops at the per-scan byte budget', async () => {
  const socket = new FakeDiscoverySocket()
  const resultPromise = discoverMinecraftLanServers({ timeoutMs: 10_000, socketFactory: () => socket })
  const packet = Buffer.alloc(MAX_MINECRAFT_LAN_PACKET_BYTES, 0x41)
  const packetsToByteLimit = Math.ceil(MAX_MINECRAFT_LAN_BYTES_PER_SCAN / packet.byteLength)
  await Promise.resolve()

  for (let index = 0; index < packetsToByteLimit - 1; index += 1) {
    socket.emit('message', packet, { address: '192.168.1.20' })
  }
  assert.equal(socket.closeCalls, 0)
  socket.emit('message', packet, { address: '192.168.1.20' })

  assert.deepEqual(await resultPromise, [])
  assert.equal(socket.closeCalls, 1)
  socket.emit('message', announce('Ignored after close', 25565), { address: '192.168.1.20' })
  assert.equal(socket.closeCalls, 1)
})

test('rejects membership errors and still closes the socket exactly once', async () => {
  const socket = new FakeDiscoverySocket({ membershipError: new Error('membership unavailable') })
  await assert.rejects(
    discoverMinecraftLanServers({ timeoutMs: 25, socketFactory: () => socket }),
    /membership unavailable/
  )
  assert.equal(socket.closeCalls, 1)
  assert.equal(socket.sendCalls, 0)
})

test('rejects synchronous bind failures and safely closes the unstarted socket', async () => {
  const socket = new FakeDiscoverySocket({ bindError: new Error('bind unavailable') })
  await assert.rejects(
    discoverMinecraftLanServers({ timeoutMs: 25, socketFactory: () => socket }),
    /bind unavailable/
  )
  assert.equal(socket.unrefCalls, 1)
  assert.equal(socket.closeCalls, 1)
})

test('rejects an asynchronous socket error, clears its timeout, and closes exactly once', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const socket = new FakeDiscoverySocket()
  const resultPromise = discoverMinecraftLanServers({ timeoutMs: 25, socketFactory: () => socket })
  await Promise.resolve()

  socket.emit('error', new Error('asynchronous socket failure'))
  await assert.rejects(resultPromise, /asynchronous socket failure/)
  context.mock.timers.runAll()
  assert.equal(socket.closeCalls, 1)
})

test('rejects a synchronous socket factory failure without starting a timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  await assert.rejects(
    discoverMinecraftLanServers({
      socketFactory: () => {
        throw new Error('socket factory unavailable')
      }
    }),
    /socket factory unavailable/
  )
  context.mock.timers.runAll()
})

test('source stays passive and retains packet, timeout, multicast, and reuseAddr bounds', async () => {
  const source = await readFile(new URL('../electron/minecraft/lanDiscovery.ts', import.meta.url), 'utf8')
  assert.match(source, /MAX_MINECRAFT_LAN_PACKET_BYTES\s*=\s*2_048/)
  assert.match(source, /MAX_MINECRAFT_LAN_PACKETS_PER_SCAN\s*=\s*512/)
  assert.match(source, /MAX_MINECRAFT_LAN_BYTES_PER_SCAN\s*=\s*256 \* 1_024/)
  assert.match(source, /MAX_MINECRAFT_LAN_SERVERS\s*=\s*256/)
  assert.match(source, /MAX_MINECRAFT_LAN_DISCOVERY_TIMEOUT_MS\s*=\s*10_000/)
  assert.match(source, /\{ type: 'udp4', reuseAddr: true \}/)
  assert.doesNotMatch(source, /socket\.send\s*\(/)
})
