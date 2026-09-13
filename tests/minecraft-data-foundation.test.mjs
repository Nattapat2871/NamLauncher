// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as nbt from 'prismarine-nbt'

import { PARTNER_SERVERS } from '../shared/partnerServers.ts'
import {
  MinecraftNbtFileError,
  encodeJavaNbt,
  readJavaNbtFile,
  writeJavaNbtFileAtomic
} from '../electron/minecraft/nbtFiles.ts'
import {
  normalizeMinecraftServerEndpoint
} from '../electron/minecraft/serverEndpoint.ts'
import {
  addMinecraftServerDat,
  mergePartnerServersDat,
  removeMinecraftServerDat,
  readMinecraftServersDat
} from '../electron/minecraft/serversDat.ts'
import {
  encodeMinecraftVarInt,
  normalizeMinecraftMotd,
  pingMinecraftServer
} from '../electron/minecraft/serverStatus.ts'
import {
  readMinecraftWorldSummary,
  scanMinecraftWorlds
} from '../electron/minecraft/worlds.ts'

const worldsSource = await readFile(new URL('../electron/minecraft/worlds.ts', import.meta.url), 'utf8')

const withTemporaryDirectory = async (callback) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-minecraft-data-'))
  try {
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const toLongPair = (value) => {
  const bigint = BigInt(value)
  return [
    Number(BigInt.asIntN(32, bigint >> 32n)),
    Number(BigInt.asIntN(32, bigint))
  ]
}

const createWorldRoot = ({ name, lastPlayed, gameType = 0, difficulty = 2, version = '1.21.8' }) => ({
  type: 'compound',
  name: '',
  value: {
    Data: {
      type: 'compound',
      value: {
        LevelName: { type: 'string', value: name },
        LastPlayed: { type: 'long', value: toLongPair(lastPlayed) },
        GameType: { type: 'int', value: gameType },
        Difficulty: { type: 'byte', value: difficulty },
        hardcore: { type: 'byte', value: 1 },
        allowCommands: { type: 'byte', value: 0 },
        DataVersion: { type: 'int', value: 4440 },
        Version: {
          type: 'compound',
          value: { Name: { type: 'string', value: version } }
        }
      }
    }
  }
})

test('defines the three requested partner servers and websites in stable provisioning order', () => {
  assert.deepEqual(PARTNER_SERVERS, [
    {
      id: 'minisand',
      name: 'MiniSand',
      address: 'play.minisand.online',
      websiteUrl: 'https://minisand.online/',
      iconUrl: './minisand-logo.png',
      relationship: 'partner'
    },
    {
      id: 'namcraft',
      name: 'NamCraft',
      address: 'namcraft.nattapat2871.me',
      websiteUrl: 'https://namcraft.nattapat2871.me/',
      iconUrl: 'https://namcraft.nattapat2871.me/icon.png',
      relationship: 'owned'
    },
    {
      id: 'teddyblock',
      name: 'TeddyBlock',
      address: 'play.tdblock.online',
      websiteUrl: 'https://tdblock.online/',
      iconUrl: 'https://tdblock.online/server/logo-128.png',
      relationship: 'partner'
    }
  ])
  assert.ok(Object.isFrozen(PARTNER_SERVERS))
  assert.ok(PARTNER_SERVERS.every(Object.isFrozen))
})

test('normalizes Minecraft hostnames, default ports, IDNs, and IPv6 for deduplication', () => {
  assert.equal(normalizeMinecraftServerEndpoint('PLAY.MINISAND.ONLINE.:25565').canonicalKey, 'play.minisand.online:25565')
  assert.equal(normalizeMinecraftServerEndpoint('PLAY.MINISAND.ONLINE.:25565').address, 'play.minisand.online:25565')
  assert.equal(normalizeMinecraftServerEndpoint('play.minisand.online').canonicalKey, 'play.minisand.online:25565')
  assert.equal(normalizeMinecraftServerEndpoint('[2001:db8::1]:25566').canonicalKey, '[2001:db8::1]:25566')
  assert.equal(normalizeMinecraftServerEndpoint('2001:db8::1').address, '[2001:db8::1]')
  const idn = normalizeMinecraftServerEndpoint('เซิร์ฟเวอร์.example')
  assert.match(idn.host, /^xn--[a-z0-9-]+\.example$/)
  assert.equal(normalizeMinecraftServerEndpoint(idn.host).host, idn.host)

  for (const invalid of ['https://example.com', 'user@example.com', 'example.com/path', 'example.com:0', 'example.com:65536', 'bad host']) {
    assert.throws(() => normalizeMinecraftServerEndpoint(invalid))
  }
})

test('merges partner servers idempotently while preserving order, unknown tags, compression, and a backup', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'servers.dat')
    const originalRoot = {
      type: 'compound',
      name: '',
      value: {
        launcherMetadata: { type: 'longArray', value: [[1, 2], [3, 4]] },
        servers: {
          type: 'list',
          value: {
            type: 'compound',
            value: [{
              name: { type: 'string', value: 'My custom MiniSand name' },
              ip: { type: 'string', value: 'PLAY.MINISAND.ONLINE:25565' },
              acceptTextures: { type: 'byte', value: 1 },
              customTag: { type: 'int', value: 2871 }
            }]
          }
        }
      }
    }
    await writeJavaNbtFileAtomic(serversPath, originalRoot, 'gzip')
    const originalBytes = await readFile(serversPath)

    const first = await mergePartnerServersDat(serversPath)
    assert.equal(first.changed, true)
    assert.deepEqual(first.addedServerIds, ['namcraft', 'teddyblock'])
    assert.equal(first.totalServers, 3)
    assert.ok(first.backupPath)
    assert.deepEqual(await readFile(first.backupPath), originalBytes)

    const parsed = await readJavaNbtFile(serversPath)
    assert.equal(parsed.compression, 'gzip')
    assert.equal(parsed.root.value.launcherMetadata.type, 'longArray')
    const rawEntries = parsed.root.value.servers.value.value
    assert.equal(rawEntries[0].name.value, 'My custom MiniSand name')
    assert.equal(rawEntries[0].customTag.value, 2871)
    assert.deepEqual(rawEntries.map((entry) => entry.ip.value), [
      'PLAY.MINISAND.ONLINE:25565',
      'namcraft.nattapat2871.me',
      'play.tdblock.online'
    ])

    const second = await mergePartnerServersDat(serversPath)
    assert.equal(second.changed, false)
    assert.equal(second.backupPath, null)
    assert.equal(second.bytesWritten, 0)
    assert.equal((await readMinecraftServersDat(serversPath)).servers.length, 3)
  })
})

test('creates a new servers.dat with all partners and no unnecessary backup', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'nested', 'servers.dat')
    const result = await mergePartnerServersDat(serversPath)
    assert.equal(result.changed, true)
    assert.equal(result.backupPath, null)
    assert.deepEqual((await readMinecraftServersDat(serversPath)).servers.map((server) => server.address), [
      'play.minisand.online',
      'namcraft.nattapat2871.me',
      'play.tdblock.online'
    ])
  })
})

test('accepts Minecraft empty end-typed lists and upgrades them when seeding partners', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'servers.dat')
    const emptyVanillaRoot = {
      type: 'compound',
      name: '',
      value: {
        servers: { type: 'list', value: { type: 'end', value: [] } }
      }
    }
    await writeJavaNbtFileAtomic(serversPath, emptyVanillaRoot, 'gzip')
    assert.deepEqual((await readMinecraftServersDat(serversPath)).servers, [])
    const result = await mergePartnerServersDat(serversPath)
    assert.equal(result.totalServers, 3)
  })
})

test('adds and removes a custom server with duplicate and stale-list protection', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'servers.dat')
    const added = await addMinecraftServerDat(serversPath, '  Local SMP  ', 'EXAMPLE.COM:25566')
    assert.equal(added.server.name, 'Local SMP')
    assert.equal(added.server.address, 'example.com:25566')
    assert.equal(added.server.canonicalKey, 'example.com:25566')
    assert.equal(added.backupPath, null)

    await assert.rejects(
      addMinecraftServerDat(serversPath, 'Duplicate', 'example.com:25566'),
      (error) => error?.code === 'DUPLICATE_SERVER'
    )
    await assert.rejects(
      addMinecraftServerDat(serversPath, 'Bad address', 'https://example.com'),
      (error) => error?.code === 'INVALID_ENDPOINT'
    )
    await assert.rejects(
      addMinecraftServerDat(serversPath, '\u0000Bad name', 'another.example'),
      (error) => error?.code === 'INVALID_NAME'
    )

    await addMinecraftServerDat(serversPath, 'Second', 'second.example')
    await assert.rejects(
      removeMinecraftServerDat(serversPath, 0, 'second.example'),
      (error) => error?.code === 'STALE_SERVER_LIST'
    )

    const removed = await removeMinecraftServerDat(serversPath, 0, 'example.com:25566')
    assert.equal(removed.server.name, 'Local SMP')
    assert.deepEqual(removed.servers.map((server) => server.address), ['second.example'])
    assert.ok(removed.backupPath)
    const persisted = await readMinecraftServersDat(serversPath)
    assert.deepEqual(persisted.servers.map((server) => server.address), ['second.example'])
  })
})

test('serializes concurrent servers.dat additions so no successful mutation is lost', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'servers.dat')
    await Promise.all([
      addMinecraftServerDat(serversPath, 'Alpha', 'alpha.example'),
      addMinecraftServerDat(serversPath, 'Beta', 'beta.example'),
      addMinecraftServerDat(serversPath, 'Gamma', 'gamma.example')
    ])
    const addresses = (await readMinecraftServersDat(serversPath)).servers.map((server) => server.address)
    assert.deepEqual(addresses, ['alpha.example', 'beta.example', 'gamma.example'])

    const duplicateResults = await Promise.allSettled([
      addMinecraftServerDat(serversPath, 'Delta', 'delta.example'),
      addMinecraftServerDat(serversPath, 'Duplicate Delta', 'DELTA.EXAMPLE:25565')
    ])
    assert.equal(duplicateResults.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(duplicateResults.filter((result) => result.status === 'rejected' && result.reason?.code === 'DUPLICATE_SERVER').length, 1)
  })
})

test('CRUD preserves unknown root and entry tags, order, and uncompressed encoding', async () => {
  await withTemporaryDirectory(async (directory) => {
    const serversPath = path.join(directory, 'servers.dat')
    const originalRoot = {
      type: 'compound',
      name: '',
      value: {
        unknownRoot: { type: 'intArray', value: [2871, 42] },
        servers: {
          type: 'list',
          value: {
            type: 'compound',
            value: [{
              name: { type: 'string', value: 'First' },
              ip: { type: 'string', value: 'first.example' },
              unknownEntry: { type: 'long', value: [123, 456] }
            }]
          }
        }
      }
    }
    await writeJavaNbtFileAtomic(serversPath, originalRoot, 'none')
    await addMinecraftServerDat(serversPath, 'Second', 'second.example')
    await removeMinecraftServerDat(serversPath, 1, 'second.example')

    const persisted = await readJavaNbtFile(serversPath)
    assert.equal(persisted.compression, 'none')
    assert.deepEqual(persisted.root.value.unknownRoot.value, [2871, 42])
    assert.deepEqual(persisted.root.value.servers.value.value.map((entry) => entry.name.value), ['First'])
    assert.deepEqual(Array.from(persisted.root.value.servers.value.value[0].unknownEntry.value), [123, 456])
  })
})

test('rejects NBT trailing data and bounded decompression overflow', async () => {
  await withTemporaryDirectory(async (directory) => {
    const trailingPath = path.join(directory, 'trailing.dat')
    const root = createWorldRoot({ name: 'Bounded', lastPlayed: 1 })
    const raw = await encodeJavaNbt(root, 'none')
    await writeFile(trailingPath, Buffer.concat([raw, Buffer.from([1, 2, 3])]))
    await assert.rejects(
      readJavaNbtFile(trailingPath),
      (error) => error instanceof MinecraftNbtFileError && error.code === 'TRAILING_DATA'
    )

    const compressedPath = path.join(directory, 'compressed.dat')
    const largeRoot = {
      type: 'compound',
      name: '',
      value: { text: { type: 'string', value: 'x'.repeat(20_000) } }
    }
    await writeFile(compressedPath, await encodeJavaNbt(largeRoot, 'gzip'))
    await assert.rejects(
      readJavaNbtFile(compressedPath, { maxUncompressedBytes: 1_024 }),
      (error) => error instanceof MinecraftNbtFileError && error.code === 'DECOMPRESSED_TOO_LARGE'
    )
  })
})

test('reads and sorts world summaries, falls back to level.dat_old, and isolates corrupt worlds', async () => {
  await withTemporaryDirectory(async (instanceDirectory) => {
    const saves = path.join(instanceDirectory, 'saves')
    const oldWorld = path.join(saves, 'old-world')
    const newWorld = path.join(saves, 'new-world')
    const corruptWorld = path.join(saves, 'corrupt-world')
    await Promise.all([
      mkdir(oldWorld, { recursive: true }),
      mkdir(newWorld, { recursive: true }),
      mkdir(corruptWorld, { recursive: true })
    ])
    await writeJavaNbtFileAtomic(
      path.join(oldWorld, 'level.dat_old'),
      createWorldRoot({ name: 'โลกเก่า', lastPlayed: 1_700_000_000_000, gameType: 0 }),
      'gzip'
    )
    await writeFile(path.join(oldWorld, 'level.dat'), Buffer.from('corrupt primary'))
    await writeJavaNbtFileAtomic(
      path.join(newWorld, 'level.dat'),
      createWorldRoot({ name: 'Creative Lab', lastPlayed: 1_800_000_000_000, gameType: 1, difficulty: 3 }),
      'gzip'
    )
    await writeFile(path.join(newWorld, 'icon.png'), Buffer.from('small-icon'))
    await writeFile(path.join(corruptWorld, 'level.dat'), Buffer.from('not nbt'))

    const direct = await readMinecraftWorldSummary(oldWorld)
    assert.equal(direct.displayName, 'โลกเก่า')
    assert.equal(direct.recoveredFromBackup, true)
    assert.equal(path.basename(direct.levelDataPath), 'level.dat_old')
    assert.equal(direct.gameMode, 'survival')
    assert.equal(direct.lastPlayedAt, 1_700_000_000_000)

    const scan = await scanMinecraftWorlds(instanceDirectory)
    assert.deepEqual(scan.worlds.map((world) => world.displayName), ['Creative Lab', 'โลกเก่า'])
    assert.equal(scan.worlds[0].gameMode, 'creative')
    assert.equal(scan.worlds[0].difficulty, 'hard')
    assert.equal(scan.worlds[0].hardcore, true)
    assert.equal(scan.worlds[0].minecraftVersion, '1.21.8')
    assert.equal(scan.worlds[0].iconPath, await realpath(path.join(newWorld, 'icon.png')))
    assert.equal(scan.failures.length, 1)
    assert.equal(scan.failures[0].folderName, 'corrupt-world')
  })
})

test('bounds concurrent world metadata reads for large save folders', () => {
  assert.match(worldsSource, /const WORLD_SCAN_CONCURRENCY = 8/)
  assert.match(worldsSource, /mapWithConcurrency\(candidates, WORLD_SCAN_CONCURRENCY/)
})

test('normalizes JSON and legacy MOTD components without producing HTML', () => {
  const motd = normalizeMinecraftMotd({
    text: 'Welcome ',
    color: 'aqua',
    extra: [
      { text: 'Master', bold: true },
      '\u00a7c!\u00a7r <script>\u0000alert(1)</script>'
    ]
  })
  assert.equal(motd.plainText, 'Welcome Master! <script>alert(1)</script>')
  assert.ok(motd.segments.some((segment) => segment.text === 'Master' && segment.bold && segment.color === 'aqua'))
  assert.ok(motd.segments.some((segment) => segment.text === '!' && segment.color === 'red'))
  assert.equal(typeof motd.segments[0].text, 'string')
})

test('pings a Java status endpoint with bounded framing and returns structured MOTD', async () => {
  const statusPayload = {
    version: { name: 'NamCraft 1.21.8', protocol: 772 },
    players: { online: 7, max: 100, sample: [{ id: 'abc', name: 'Rimuru' }] },
    description: { text: 'Nam', color: 'aqua', extra: [{ text: 'Craft', bold: true }] },
    favicon: `data:image/png;base64,${Buffer.from('icon').toString('base64')}`,
    enforcesSecureChat: true
  }
  const json = Buffer.from(JSON.stringify(statusPayload))
  const responsePayload = Buffer.concat([encodeMinecraftVarInt(0), encodeMinecraftVarInt(json.length), json])
  const response = Buffer.concat([encodeMinecraftVarInt(responsePayload.length), responsePayload])

  const server = createServer((socket) => {
    socket.once('data', () => socket.end(response))
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const status = await pingMinecraftServer(`127.0.0.1:${address.port}`, { useSrv: false, timeoutMs: 1_000 })
    assert.equal(status.players.online, 7)
    assert.equal(status.players.sample[0].name, 'Rimuru')
    assert.equal(status.version.protocol, 772)
    assert.equal(status.motd.plainText, 'NamCraft')
    assert.equal(status.motd.segments[1].bold, true)
    assert.equal(status.enforcesSecureChat, true)
    assert.ok(status.latencyMs >= 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('rejects status packets that declare a response beyond the configured cap', async () => {
  const server = createServer((socket) => {
    socket.once('data', () => socket.end(encodeMinecraftVarInt(2_000)))
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    await assert.rejects(
      pingMinecraftServer(`127.0.0.1:${address.port}`, { useSrv: false, timeoutMs: 1_000, maxResponseBytes: 1_024 }),
      (error) => error?.code === 'RESPONSE_TOO_LARGE'
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('bounds a silent server ping by timeout and supports cancellation', async () => {
  const connections = new Set()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const endpoint = `127.0.0.1:${address.port}`
    const startedAt = performance.now()
    await assert.rejects(
      pingMinecraftServer(endpoint, { useSrv: false, timeoutMs: 250 }),
      (error) => error?.code === 'TIMEOUT'
    )
    assert.ok(performance.now() - startedAt < 1_000)

    const abortController = new AbortController()
    const pending = pingMinecraftServer(endpoint, {
      useSrv: false,
      timeoutMs: 2_000,
      signal: abortController.signal
    })
    abortController.abort()
    await assert.rejects(pending, (error) => error?.code === 'ABORTED')
  } finally {
    for (const socket of connections) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('bounds SRV discovery and preserves direct-host fallback time', async () => {
  const source = await readFile(new URL('../electron/minecraft/serverStatus.ts', import.meta.url), 'utf8')
  assert.match(source, /const lookupBudgetMs = Math\.min\(1_500, remainingMs\)/)
  assert.match(source, /error\.code === 'ABORTED'/)
  assert.match(source, /socketTimeoutMs = Math\.ceil\(deadline - performance\.now\(\)\)/)
})

test('prismarine-nbt preserves every unknown tag in semantic round trips', async () => {
  const root = {
    type: 'compound',
    name: 'AllTags',
    value: {
      byte: { type: 'byte', value: -1 },
      short: { type: 'short', value: 2 },
      int: { type: 'int', value: 3 },
      long: { type: 'long', value: [4, 5] },
      float: { type: 'float', value: 1.25 },
      double: { type: 'double', value: 2.5 },
      string: { type: 'string', value: 'NamLauncher' },
      byteArray: { type: 'byteArray', value: [1, -1] },
      intArray: { type: 'intArray', value: [3, -3] },
      longArray: { type: 'longArray', value: [[6, 7], [-8, -9]] },
      list: { type: 'list', value: { type: 'string', value: ['a', 'b'] } },
      compound: { type: 'compound', value: { nested: { type: 'byte', value: 1 } } }
    }
  }
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'all-tags.nbt')
    await writeJavaNbtFileAtomic(filePath, root, 'gzip')
    const parsed = await readJavaNbtFile(filePath)
    assert.equal(nbt.equal(root, parsed.root), true)
  })
})
