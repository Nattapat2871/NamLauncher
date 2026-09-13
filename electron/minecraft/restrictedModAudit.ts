// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

export type RestrictedModSignalCategory = 'automation' | 'combat-client' | 'utility-client'
export type RestrictedModSignalSource = 'metadata-id' | 'filename'

export type RestrictedModSignal = {
  detectorId: string
  category: RestrictedModSignalCategory
  displayName: string
  modVersion: string | null
  source: RestrictedModSignalSource
}

export type RestrictedModScanResult = {
  observations: RestrictedModSignal[]
  scannedFiles: number
  skippedFiles: number
  truncated: boolean
}

type Detector = {
  id: string
  category: RestrictedModSignalCategory
  aliases: string[]
}

const MAX_MOD_FILES = 300
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_METADATA_BYTES = 192 * 1024
const MAX_COMPRESSED_METADATA_BYTES = 256 * 1024
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024
const MAX_SIGNAL_COUNT = 50
const MAX_TEXT = 80
const METADATA_ENTRIES = [
  'fabric.mod.json',
  'quilt.mod.json',
  'META-INF/mods.toml',
  'META-INF/neoforge.mods.toml'
] as const

// This is a conservative signal registry, not a verdict. Exact metadata IDs
// are preferred; filename matching is only a fallback when metadata is absent.
const DETECTORS: Detector[] = [
  { id: 'meteor-client', category: 'combat-client', aliases: ['meteorclient', 'meteor-client', 'meteor'] },
  { id: 'wurst-client', category: 'combat-client', aliases: ['wurst', 'wurst-client', 'wurstclient'] },
  { id: 'baritone', category: 'automation', aliases: ['baritone'] },
  { id: 'liquidbounce', category: 'combat-client', aliases: ['liquidbounce', 'liquid-bounce'] },
  { id: 'impact-client', category: 'combat-client', aliases: ['impact', 'impact-client'] },
  { id: 'aristois', category: 'combat-client', aliases: ['aristois'] },
  { id: 'inertia-client', category: 'combat-client', aliases: ['inertia', 'inertia-client'] },
  { id: 'bleachhack', category: 'combat-client', aliases: ['bleachhack', 'bleach-hack'] },
  { id: 'mathax', category: 'combat-client', aliases: ['mathax', 'mathax-client'] },
  { id: 'rusherhack', category: 'combat-client', aliases: ['rusherhack', 'rusher-hack'] },
  { id: 'future-client', category: 'combat-client', aliases: ['future', 'future-client'] },
  { id: 'lambda-client', category: 'utility-client', aliases: ['lambda', 'lambda-client'] },
  { id: 'kami-blue', category: 'utility-client', aliases: ['kami-blue', 'kamiblue'] },
  { id: 'salhack', category: 'combat-client', aliases: ['salhack', 'sal-hack'] },
  { id: 'thunderhack', category: 'combat-client', aliases: ['thunderhack', 'thunder-hack'] },
  { id: 'coffee-client', category: 'combat-client', aliases: ['coffeeclient', 'coffee-client'] },
  { id: 'earthhack', category: 'combat-client', aliases: ['earthhack', 'earth-hack'] },
  { id: 'phobos', category: 'combat-client', aliases: ['phobos'] },
  { id: 'gamesense', category: 'combat-client', aliases: ['gamesense', 'game-sense'] },
  { id: 'konas', category: 'combat-client', aliases: ['konas'] },
  { id: 'boze-client', category: 'combat-client', aliases: ['boze', 'boze-client'] },
  { id: 'mio-client', category: 'combat-client', aliases: ['mio', 'mio-client'] }
]

const cleanText = (value: unknown, fallback = '') => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_TEXT) || fallback

const normalizeIdentifier = (value: unknown) => cleanText(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const detectorForExactId = (value: string) => {
  const normalized = normalizeIdentifier(value)
  return DETECTORS.find((detector) => detector.aliases.some((alias) => normalizeIdentifier(alias) === normalized)) || null
}

const detectorForFilename = (value: string) => {
  const normalized = normalizeIdentifier(path.basename(value, path.extname(value)))
  return DETECTORS.find((detector) => detector.aliases.some((alias) => {
    const target = normalizeIdentifier(alias)
    return normalized === target || normalized.startsWith(`${target}-`)
  })) || null
}

const safeJson = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const firstTomlValue = (source: string, key: string) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*["']([^"'\\r\\n]{1,120})["']`, 'i'))
  return cleanText(match?.[1])
}

const readAt = (descriptor: number, length: number, position: number) => {
  const buffer = Buffer.allocUnsafe(length)
  const bytesRead = fs.readSync(descriptor, buffer, 0, length, position)
  if (bytesRead !== length) throw new Error('Unexpected end of ZIP archive.')
  return buffer
}

const readMetadataEntry = (archivePath: string) => {
  const descriptor = fs.openSync(archivePath, 'r')
  try {
    const archiveSize = fs.fstatSync(descriptor).size
    const tailSize = Math.min(archiveSize, 65_557)
    if (tailSize < 22) return null
    const tail = readAt(descriptor, tailSize, archiveSize - tailSize)
    let eocd = -1
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) === 0x06054b50) {
        eocd = offset
        break
      }
    }
    if (eocd < 0) return null
    const centralSize = tail.readUInt32LE(eocd + 12)
    const centralOffset = tail.readUInt32LE(eocd + 16)
    if (
      centralSize <= 0
      || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
      || centralOffset + centralSize > archiveSize
    ) return null
    const central = readAt(descriptor, centralSize, centralOffset)
    const entries = new Map<string, {
      method: number
      compressedSize: number
      uncompressedSize: number
      localOffset: number
    }>()
    let cursor = 0
    while (cursor + 46 <= central.length) {
      if (central.readUInt32LE(cursor) !== 0x02014b50) break
      const method = central.readUInt16LE(cursor + 10)
      const compressedSize = central.readUInt32LE(cursor + 20)
      const uncompressedSize = central.readUInt32LE(cursor + 24)
      const nameLength = central.readUInt16LE(cursor + 28)
      const extraLength = central.readUInt16LE(cursor + 30)
      const commentLength = central.readUInt16LE(cursor + 32)
      const localOffset = central.readUInt32LE(cursor + 42)
      const next = cursor + 46 + nameLength + extraLength + commentLength
      if (next > central.length) break
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
      if ((METADATA_ENTRIES as readonly string[]).includes(name)) {
        entries.set(name, { method, compressedSize, uncompressedSize, localOffset })
      }
      cursor = next
    }

    for (const entryName of METADATA_ENTRIES) {
      const entry = entries.get(entryName)
      if (
        !entry
        || entry.uncompressedSize <= 0
        || entry.uncompressedSize > MAX_METADATA_BYTES
        || entry.compressedSize <= 0
        || entry.compressedSize > MAX_COMPRESSED_METADATA_BYTES
        || entry.localOffset + 30 > archiveSize
      ) continue
      const local = readAt(descriptor, 30, entry.localOffset)
      if (local.readUInt32LE(0) !== 0x04034b50) continue
      const nameLength = local.readUInt16LE(26)
      const extraLength = local.readUInt16LE(28)
      const dataOffset = entry.localOffset + 30 + nameLength + extraLength
      if (dataOffset + entry.compressedSize > archiveSize) continue
      const compressed = readAt(descriptor, entry.compressedSize, dataOffset)
      const content = entry.method === 0
        ? compressed
        : entry.method === 8
          ? zlib.inflateRawSync(compressed, { maxOutputLength: MAX_METADATA_BYTES })
          : null
      if (!content || content.length <= 0 || content.length > MAX_METADATA_BYTES) continue
      return { entryName, source: content.toString('utf8').slice(0, MAX_METADATA_BYTES) }
    }
    return null
  } finally {
    fs.closeSync(descriptor)
  }
}

const readMetadata = (archivePath: string) => {
  const entry = readMetadataEntry(archivePath)
  if (!entry) return null
  const { entryName, source } = entry
  if (entryName === 'fabric.mod.json') {
    const parsed = safeJson(source)
    if (!parsed) return null
    return {
      id: cleanText(parsed.id),
      name: cleanText(parsed.name),
      version: cleanText(parsed.version)
    }
  }
  if (entryName === 'quilt.mod.json') {
    const parsed = safeJson(source)
    const loader = parsed?.quilt_loader
    if (!loader || typeof loader !== 'object' || Array.isArray(loader)) return null
    const metadata = (loader as Record<string, unknown>).metadata
    return {
      id: cleanText((loader as Record<string, unknown>).id),
      name: cleanText(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).name
        : ''),
      version: cleanText((loader as Record<string, unknown>).version)
    }
  }
  return {
    id: firstTomlValue(source, 'modId'),
    name: firstTomlValue(source, 'displayName'),
    version: firstTomlValue(source, 'version')
  }
}

export const scanRestrictedMods = (gameDirectory: string): RestrictedModScanResult => {
  const result: RestrictedModScanResult = {
    observations: [],
    scannedFiles: 0,
    skippedFiles: 0,
    truncated: false
  }
  const root = path.resolve(gameDirectory)
  const modsDirectory = path.join(root, 'mods')
  if (!fs.existsSync(modsDirectory)) return result

  const rootInfo = fs.lstatSync(root)
  const modsInfo = fs.lstatSync(modsDirectory)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !modsInfo.isDirectory() || modsInfo.isSymbolicLink()) {
    throw new Error('The active instance mods directory is not a safe local directory.')
  }

  const names = fs.readdirSync(modsDirectory)
    .filter((name) => name.toLowerCase().endsWith('.jar'))
    .sort((left, right) => {
      // Inspect conservative filename matches first so an attacker cannot hide a
      // known client behind hundreds of alphabetically earlier, unrelated JARs.
      const leftPriority = detectorForFilename(left) ? 0 : 1
      const rightPriority = detectorForFilename(right) ? 0 : 1
      return leftPriority - rightPriority || left.localeCompare(right)
    })
  if (names.length > MAX_MOD_FILES) result.truncated = true

  const seen = new Set<string>()
  for (const name of names.slice(0, MAX_MOD_FILES)) {
    const filePath = path.join(modsDirectory, name)
    const relative = path.relative(modsDirectory, filePath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      result.skippedFiles += 1
      continue
    }
    const info = fs.lstatSync(filePath)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_ARCHIVE_BYTES) {
      result.skippedFiles += 1
      continue
    }
    result.scannedFiles += 1

    let metadata: ReturnType<typeof readMetadata> = null
    try {
      metadata = readMetadata(filePath)
    } catch {
      result.skippedFiles += 1
    }
    const metadataDetector = metadata?.id ? detectorForExactId(metadata.id) : null
    // Metadata is untrusted input. A renamed metadata id must not suppress the
    // same conservative filename signal used for malformed or absent metadata.
    const detector = metadataDetector || detectorForFilename(name)
    if (!detector || seen.has(detector.id)) continue
    seen.add(detector.id)
    result.observations.push({
      detectorId: detector.id,
      category: detector.category,
      displayName: cleanText(metadata?.name, detector.id),
      modVersion: cleanText(metadata?.version) || null,
      source: metadataDetector ? 'metadata-id' : 'filename'
    })
    if (result.observations.length >= MAX_SIGNAL_COUNT) {
      result.truncated = true
      break
    }
  }
  return result
}
