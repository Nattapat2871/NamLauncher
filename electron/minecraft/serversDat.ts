// Author/creator: nattapat2871 (https://nattapat2871.me)

import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { NBT } from 'prismarine-nbt'
import { PARTNER_SERVERS, type PartnerServerDefinition } from '../../shared/partnerServers.ts'
import { readJavaNbtFile, writeJavaNbtFileAtomic, type NbtCompression } from './nbtFiles.ts'
import { tryNormalizeMinecraftServerEndpoint } from './serverEndpoint.ts'
import { sanitizeMinecraftPngDataUrl } from './pngDataUrl.ts'

type NbtTag = {
  type: string
  value: unknown
}

type ServerCompoundValue = Record<string, NbtTag | undefined>

type CompoundListTag = {
  type: 'list'
  value: {
    type: 'compound'
    value: ServerCompoundValue[]
  }
}

export type MinecraftServerListEntry = Readonly<{
  index: number
  name: string
  address: string
  canonicalKey: string | null
  hidden: boolean
  acceptsServerResourcePack: boolean | null
  iconDataUrl: string | null
}>

export type PartnerServerMergeResult = Readonly<{
  changed: boolean
  addedServerIds: readonly string[]
  totalServers: number
  backupPath: string | null
  bytesWritten: number
}>

export type MinecraftServerMutationResult = Readonly<{
  changed: boolean
  server: MinecraftServerListEntry | null
  servers: readonly MinecraftServerListEntry[]
  backupPath: string | null
  bytesWritten: number
}>

export class MinecraftServerDatMutationError extends Error {
  readonly code: 'DUPLICATE_SERVER' | 'STALE_SERVER_LIST' | 'INVALID_INDEX' | 'INVALID_NAME' | 'INVALID_ENDPOINT'

  constructor(code: MinecraftServerDatMutationError['code'], message: string) {
    super(message)
    this.name = 'MinecraftServerDatMutationError'
    this.code = code
  }
}

const createEmptyServersRoot = (): NBT => ({
  type: 'compound',
  name: '',
  value: {
    servers: {
      type: 'list',
      value: { type: 'compound', value: [] }
    }
  }
}) as NBT

const getServersList = (root: NBT, createWhenMissing: boolean): CompoundListTag => {
  const current = root.value.servers as NbtTag | undefined
  if (current === undefined && createWhenMissing) {
    const created: CompoundListTag = {
      type: 'list',
      value: { type: 'compound', value: [] }
    }
    root.value.servers = created as never
    return created
  }

  if (!current || current.type !== 'list' || typeof current.value !== 'object' || current.value === null) {
    throw new Error('servers.dat must contain a compound list named "servers".')
  }
  const listValue = current.value as { type?: unknown; value?: unknown }
  if (listValue.type === 'end' && Array.isArray(listValue.value) && listValue.value.length === 0) {
    listValue.type = 'compound'
  }
  if (listValue.type !== 'compound' || !Array.isArray(listValue.value)) {
    throw new Error('servers.dat must contain a compound list named "servers".')
  }
  return current as CompoundListTag
}

const readStringTag = (value: NbtTag | undefined) => (
  value?.type === 'string' && typeof value.value === 'string' ? value.value : null
)

const readByteTag = (value: NbtTag | undefined) => (
  value?.type === 'byte' && typeof value.value === 'number' ? value.value : null
)

const toListEntry = (value: ServerCompoundValue, index: number): MinecraftServerListEntry => {
  const address = readStringTag(value.ip) || ''
  const normalized = tryNormalizeMinecraftServerEndpoint(address)
  const resourcePack = readByteTag(value.acceptTextures)
  return Object.freeze({
    index,
    name: readStringTag(value.name) || address || `Server ${index + 1}`,
    address,
    canonicalKey: normalized?.canonicalKey ?? null,
    hidden: readByteTag(value.hidden) === 1,
    acceptsServerResourcePack: resourcePack === null ? null : resourcePack === 1,
    iconDataUrl: sanitizeMinecraftPngDataUrl(readStringTag(value.icon))
  })
}

const partnerToNbt = (server: PartnerServerDefinition): ServerCompoundValue => ({
  name: { type: 'string', value: server.name },
  ip: { type: 'string', value: server.address },
  hidden: { type: 'byte', value: 0 }
})

const fileExists = async (filePath: string) => {
  try {
    const info = await lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('servers.dat path must be a regular file.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const mutationTails = new Map<string, Promise<void>>()

const withServersDatMutationLock = async <T>(filePath: string, action: () => Promise<T>): Promise<T> => {
  const resolved = pathKey(filePath)
  const previous = mutationTails.get(resolved) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  mutationTails.set(resolved, tail)
  await previous

  try {
    return await action()
  } finally {
    release()
    if (mutationTails.get(resolved) === tail) mutationTails.delete(resolved)
  }
}

const pathKey = (filePath: string) => {
  const resolved = path.resolve(filePath).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const readOrCreateServersDat = async (filePath: string) => {
  const exists = await fileExists(filePath)
  if (!exists) return { root: createEmptyServersRoot(), compression: 'gzip' as NbtCompression }
  const parsed = await readJavaNbtFile(filePath)
  return { root: parsed.root, compression: parsed.compression }
}

const summarizeServers = (list: CompoundListTag) => (
  Object.freeze(list.value.value.map(toListEntry))
)

export const readMinecraftServersDat = async (filePath: string) => {
  const result = await readJavaNbtFile(filePath)
  const list = getServersList(result.root, false)
  return Object.freeze({
    servers: Object.freeze(list.value.value.map(toListEntry)),
    compression: result.compression
  })
}

const mergePartnerServersDatUnlocked = async (
  filePath: string,
  partnerServers: readonly PartnerServerDefinition[] = PARTNER_SERVERS
): Promise<PartnerServerMergeResult> => {
  const loaded = await readOrCreateServersDat(filePath)
  const { root, compression } = loaded

  const list = getServersList(root, true)
  const existingKeys = new Set<string>()
  for (const entry of list.value.value) {
    const address = readStringTag(entry.ip)
    const endpoint = address ? tryNormalizeMinecraftServerEndpoint(address) : null
    if (endpoint) existingKeys.add(endpoint.canonicalKey)
  }

  const addedServerIds: string[] = []
  for (const partner of partnerServers) {
    const endpoint = tryNormalizeMinecraftServerEndpoint(partner.address)
    if (!endpoint) throw new Error(`Partner server ${partner.id} has an invalid Minecraft address.`)
    if (existingKeys.has(endpoint.canonicalKey)) continue
    list.value.value.push(partnerToNbt(partner))
    existingKeys.add(endpoint.canonicalKey)
    addedServerIds.push(partner.id)
  }

  if (addedServerIds.length === 0) {
    return Object.freeze({
      changed: false,
      addedServerIds: Object.freeze([]),
      totalServers: list.value.value.length,
      backupPath: null,
      bytesWritten: 0
    })
  }

  const written = await writeJavaNbtFileAtomic(filePath, root, compression)
  return Object.freeze({
    changed: true,
    addedServerIds: Object.freeze(addedServerIds),
    totalServers: list.value.value.length,
    backupPath: written.backupPath,
    bytesWritten: written.bytesWritten
  })
}

export const mergePartnerServersDat = async (
  filePath: string,
  partnerServers: readonly PartnerServerDefinition[] = PARTNER_SERVERS
) => withServersDatMutationLock(
  filePath,
  () => mergePartnerServersDatUnlocked(filePath, partnerServers)
)

const addMinecraftServerDatUnlocked = async (
  filePath: string,
  name: string,
  address: string
): Promise<MinecraftServerMutationResult> => {
  const safeName = name.trim()
  if (!safeName || safeName.length > 128 || /[\u0000-\u001f\u007f]/.test(safeName)) {
    throw new MinecraftServerDatMutationError('INVALID_NAME', 'Server name must contain 1 to 128 printable characters.')
  }
  const endpoint = tryNormalizeMinecraftServerEndpoint(address)
  if (!endpoint) {
    throw new MinecraftServerDatMutationError('INVALID_ENDPOINT', 'Minecraft server address is invalid.')
  }

  const { root, compression } = await readOrCreateServersDat(filePath)
  const list = getServersList(root, true)
  const servers = summarizeServers(list)
  if (servers.some((server) => server.canonicalKey === endpoint.canonicalKey)) {
    throw new MinecraftServerDatMutationError('DUPLICATE_SERVER', 'This Minecraft server is already in the list.')
  }

  list.value.value.push({
    name: { type: 'string', value: safeName },
    ip: { type: 'string', value: endpoint.address },
    hidden: { type: 'byte', value: 0 }
  })
  const written = await writeJavaNbtFileAtomic(filePath, root, compression)
  const updatedServers = summarizeServers(list)
  return Object.freeze({
    changed: true,
    server: updatedServers.at(-1) ?? null,
    servers: updatedServers,
    backupPath: written.backupPath,
    bytesWritten: written.bytesWritten
  })
}

export const addMinecraftServerDat = async (
  filePath: string,
  name: string,
  address: string
) => withServersDatMutationLock(
  filePath,
  () => addMinecraftServerDatUnlocked(filePath, name, address)
)

const removeMinecraftServerDatUnlocked = async (
  filePath: string,
  index: number,
  expectedCanonicalKey: string
): Promise<MinecraftServerMutationResult> => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new MinecraftServerDatMutationError('INVALID_INDEX', 'Server index must be a non-negative integer.')
  }
  const expected = tryNormalizeMinecraftServerEndpoint(expectedCanonicalKey)
  if (!expected) throw new MinecraftServerDatMutationError('STALE_SERVER_LIST', 'Expected server address is invalid.')

  const parsed = await readJavaNbtFile(filePath)
  const list = getServersList(parsed.root, false)
  if (index >= list.value.value.length) {
    throw new MinecraftServerDatMutationError('INVALID_INDEX', 'Server index is outside the current list.')
  }
  const current = toListEntry(list.value.value[index], index)
  if (current.canonicalKey !== expected.canonicalKey) {
    throw new MinecraftServerDatMutationError(
      'STALE_SERVER_LIST',
      'The server list changed before removal. Refresh it and try again.'
    )
  }

  list.value.value.splice(index, 1)
  const written = await writeJavaNbtFileAtomic(filePath, parsed.root, parsed.compression)
  return Object.freeze({
    changed: true,
    server: current,
    servers: summarizeServers(list),
    backupPath: written.backupPath,
    bytesWritten: written.bytesWritten
  })
}

export const removeMinecraftServerDat = async (
  filePath: string,
  index: number,
  expectedCanonicalKey: string
) => withServersDatMutationLock(
  filePath,
  () => removeMinecraftServerDatUnlocked(filePath, index, expectedCanonicalKey)
)
