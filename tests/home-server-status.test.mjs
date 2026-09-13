// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MAX_FILTERED_INSTANCE_SERVER_PINGS,
  MAX_INSTANCE_SERVER_PINGS,
  selectMinecraftServerPingTargets,
  selectMinecraftServersForPing
} from '../electron/minecraft/serverPingSelection.ts'
import { sanitizeMinecraftPngDataUrl } from '../electron/minecraft/pngDataUrl.ts'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const motdSource = await readFile(new URL('../src/components/MinecraftServerMotd.tsx', import.meta.url), 'utf8')

const server = (index, address, canonicalKey = `${address}:25565`) => ({
  index,
  name: `Server ${index}`,
  address,
  canonicalKey,
  hidden: false,
  acceptsServerResourcePack: null,
  iconDataUrl: null
})

test('scoped Home selection only returns requested saved servers and deduplicates canonical addresses', () => {
  assert.equal(MAX_FILTERED_INSTANCE_SERVER_PINGS, 4)
  const savedServers = [
    server(0, 'play.example.com'),
    server(1, 'PLAY.example.com', 'play.example.com:25565'),
    server(2, 'second.example.com'),
    server(3, 'unrelated.example.com')
  ]

  const selected = selectMinecraftServersForPing(savedServers, [
    'PLAY.EXAMPLE.COM',
    'second.example.com',
    'not-saved.example.com'
  ])

  assert.deepEqual(selected.map((entry) => entry.index), [0, 2])
  const targets = selectMinecraftServerPingTargets(savedServers, [
    'PLAY.EXAMPLE.COM:25565',
    'play.example.com',
    'second.example.com'
  ])
  assert.deepEqual(targets.map(({ server: entry }) => entry.index), [0, 2])
  assert.deepEqual(targets[0].requestedAddresses, ['PLAY.EXAMPLE.COM:25565', 'play.example.com'])
  assert.equal(selectMinecraftServersForPing(savedServers, 'not-an-array').length, 0)
  assert.equal(selectMinecraftServersForPing(savedServers, ['not-saved.example.com']).length, 0)
})

test('unfiltered Worlds & Servers behavior remains bounded and unchanged', () => {
  assert.equal(MAX_INSTANCE_SERVER_PINGS, 60)
  const savedServers = Array.from({ length: 70 }, (_, index) => server(index, `server-${index}.example.com`))
  assert.equal(selectMinecraftServersForPing(savedServers, undefined).length, 60)
})

test('server icons require a bounded PNG IHDR before reaching Chromium', () => {
  const valid = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZsAAAAASUVORK5CYII='
  assert.equal(sanitizeMinecraftPngDataUrl(valid), valid)
  assert.equal(sanitizeMinecraftPngDataUrl('data:image/png;base64,aWNvbg=='), null)

  const oversized = Buffer.from(valid.slice('data:image/png;base64,'.length), 'base64')
  oversized.writeUInt32BE(4_096, 16)
  assert.equal(sanitizeMinecraftPngDataUrl(`data:image/png;base64,${oversized.toString('base64')}`), null)
})

test('Home status refresh is lazy, grouped, cached, stale-safe, and has no polling interval', () => {
  assert.match(appSource, /if \([\s\S]*!bootReady[\s\S]*activeView !== 'home'/)
  assert.match(appSource, /\|\| windowHidden[\s\S]*\|\| showFirstRunSetup[\s\S]*\|\| showLegalReview/)
  assert.match(appSource, /HOME_SERVER_STATUS_MAX_RECENT = 4/)
  assert.match(appSource, /HOME_SERVER_STATUS_CONCURRENCY = 2/)
  assert.match(appSource, /HOME_SERVER_STATUS_CACHE_TTL_MS = 60_000/)
  assert.equal((appSource.match(/getRecentPlayablePlaces\(recentPlaces, instances\)/g) || []).length, 2)
  assert.match(appSource, /const grouped = new Map/)
  assert.match(appSource, /pingInstanceServers\(group\.instance, addresses\)/)
  assert.match(appSource, /requestId === homeServerStatusRequestIdRef\.current/)
  assert.match(appSource, /homeServerPingInFlightRef/)
  assert.match(appSource, /setHomeServerStatusRefresh\(\(value\) => value \+ 1\)/)
  assert.doesNotMatch(appSource, /setInterval\([\s\S]{0,400}pingInstanceServers/)
})

test('Home reuses safe MOTD text rendering and receives live plus saved icon metadata', () => {
  assert.match(appSource, /<MinecraftServerMotd/)
  assert.match(appSource, /serverPing\?\.status\?\.faviconDataUrl \|\| serverPing\?\.iconDataUrl/)
  assert.match(appSource, /source === '\.\/minisand-logo\.png'/)
  assert.doesNotMatch(appSource, /normalizeBundledImageSource/)
  assert.match(appSource, /className="h-full w-full object-contain"/)
  assert.match(appSource, /serverPing\.status\.players\.online/)
  assert.match(motdSource, /raw server HTML is never interpreted/)
  assert.doesNotMatch(motdSource, /dangerouslySetInnerHTML/)
  assert.match(preloadSource, /pingInstanceServers: \(instance: any, addresses\?: readonly string\[\]\)/)
  assert.match(mainSource, /selectMinecraftServerPingTargets\(await readInstanceServers\(instance\), request\.addresses\)/)
  assert.match(mainSource, /requestedAddresses,/)
  assert.match(appSource, /for \(const requestedAddress of ping\.requestedAddresses \|\| \[\]\)/)
  assert.match(mainSource, /iconDataUrl: server\.iconDataUrl/)
})
