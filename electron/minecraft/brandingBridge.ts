// Author/creator: nattapat2871 (https://nattapat2871.me)

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { assertPathWithinRoot } from '../pathSafety.ts'

export const BRANDING_BRIDGE_ID = 'namlauncher-game-companion'
export const BRANDING_BRIDGE_VERSION = '1.2.3'
export const BRIDGE_MANIFEST_FILENAME = 'game-bridge-manifest.json'

const LEGACY_BRIDGE_ID = 'namlauncher-branding-bridge'
const MAX_BRIDGE_JAR_SIZE = 16 * 1024 * 1024
const MAX_METADATA_SIZE = 128 * 1024
const MAX_MANIFEST_SIZE = 128 * 1024
const MANAGED_FILENAME_PATTERN = /^namlauncher-(?:branding-bridge|game-companion)-[A-Za-z0-9.+-]+\.jar$/
const MANAGED_CONTENT_FILENAME_PATTERN = /^namlauncher-(?:branding-bridge|game-companion)-[A-Za-z0-9.+-]+\.jar(?:\.(?:disable|disabled))?$/i
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,80}$/
const SAFE_MINECRAFT_VERSION_PATTERN = /^[A-Za-z0-9._+-]{1,40}$/
const NUMERIC_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SUPPORTED_LOADERS = new Set(['fabric', 'forge', 'neoforge'])

export type BridgeArtifact = Readonly<{
  id: typeof BRANDING_BRIDGE_ID
  version: string
  launcherVersion: '1.2.3'
  loader: 'fabric' | 'forge' | 'neoforge'
  minimumLoaderVersion?: string
  minecraftVersion: string
  supportStatus: 'maintained' | 'legacy-frozen'
  environment: 'client'
  filename: string
  sha256: string
  size: number
  author: 'nattapat2871 (https://nattapat2871.me)'
}>

export type BridgeManifest = Readonly<{
  schemaVersion: 2
  launcherVersion: '1.2.3'
  artifacts: readonly BridgeArtifact[]
  author: 'nattapat2871 (https://nattapat2871.me)'
}>

type InstanceBridgeTarget = Readonly<{
  loader: string
  minecraftVersion: string
  fabricLoaderVersion?: string
}>

type BridgeOwnershipMarker = Readonly<{
  schemaVersion: 1 | 2
  id: string
  version: string
  filename: string
  sha256: string
  managedBy: 'NamLauncher'
  author: 'nattapat2871 (https://nattapat2871.me)'
}>

export type BrandingBridgeProvisionResult = Readonly<{
  status: 'installed' | 'current' | 'removed' | 'not-applicable' | 'unavailable' | 'collision'
  filename: string | null
  removed: number
  supportStatus: 'maintained' | 'legacy-frozen' | null
}>

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const sha256 = (filePath: string) => (
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
)

const normalizeLoader = (value: string) => value.trim().toLowerCase().replace(/[-_]/g, '')

const isVersionAtLeast = (candidate: string | undefined, minimum: string) => {
  const normalizedCandidate = String(candidate || '').trim()
  if (!NUMERIC_VERSION_PATTERN.test(normalizedCandidate) || !NUMERIC_VERSION_PATTERN.test(minimum)) return false
  const candidateParts = normalizedCandidate.split('.').map(Number)
  const minimumParts = minimum.split('.').map(Number)
  const length = Math.max(candidateParts.length, minimumParts.length)
  for (let index = 0; index < length; index += 1) {
    const left = candidateParts[index] || 0
    const right = minimumParts[index] || 0
    if (left !== right) return left > right
  }
  return true
}

const parseArtifact = (value: unknown): BridgeArtifact | null => {
  if (!isRecord(value)) return null
  const filename = typeof value.filename === 'string' ? value.filename : ''
  if (
    value.id !== BRANDING_BRIDGE_ID
    || typeof value.version !== 'string'
    || !SAFE_VERSION_PATTERN.test(value.version)
    || value.launcherVersion !== '1.2.3'
    || typeof value.loader !== 'string'
    || !SUPPORTED_LOADERS.has(normalizeLoader(value.loader))
    || (value.minimumLoaderVersion !== undefined && (
      normalizeLoader(value.loader) !== 'fabric'
      || typeof value.minimumLoaderVersion !== 'string'
      || !NUMERIC_VERSION_PATTERN.test(value.minimumLoaderVersion)
    ))
    || typeof value.minecraftVersion !== 'string'
    || !SAFE_MINECRAFT_VERSION_PATTERN.test(value.minecraftVersion)
    || (value.supportStatus !== 'maintained' && value.supportStatus !== 'legacy-frozen')
    || value.environment !== 'client'
    || path.basename(filename) !== filename
    || !MANAGED_FILENAME_PATTERN.test(filename)
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
    || typeof value.size !== 'number'
    || !Number.isSafeInteger(value.size)
    || value.size <= 0
    || value.size > MAX_BRIDGE_JAR_SIZE
    || value.author !== 'nattapat2871 (https://nattapat2871.me)'
  ) return null
  return { ...value, loader: normalizeLoader(value.loader) } as BridgeArtifact
}

export const parseBrandingBridgeManifest = (value: unknown): BridgeManifest | null => {
  if (!isRecord(value) || value.schemaVersion !== 2 || value.launcherVersion !== '1.2.3'
    || value.author !== 'nattapat2871 (https://nattapat2871.me)' || !Array.isArray(value.artifacts)
    || value.artifacts.length < 1 || value.artifacts.length > 32) return null
  const artifacts = value.artifacts.map(parseArtifact)
  if (artifacts.some((artifact) => !artifact)) return null
  const verified = artifacts as BridgeArtifact[]
  const filenames = new Set(verified.map((artifact) => artifact.filename))
  const targets = new Set(verified.map((artifact) => `${artifact.loader}:${artifact.minecraftVersion}`))
  if (filenames.size !== verified.length || targets.size !== verified.length) return null
  return {
    schemaVersion: 2,
    launcherVersion: '1.2.3',
    artifacts: verified,
    author: 'nattapat2871 (https://nattapat2871.me)'
  }
}

const readZipMetadata = (jarPath: string) => {
  try {
    const info = fs.lstatSync(jarPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_BRIDGE_JAR_SIZE) return null
    const archive = new AdmZip(jarPath)
    for (const entryName of ['fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      const entry = archive.getEntry(entryName)
      if (!entry || entry.isDirectory) continue
      const declaredSize = Number((entry.header as { size?: number }).size || 0)
      if (declaredSize <= 0 || declaredSize > MAX_METADATA_SIZE) return null
      return { entryName, text: archive.readAsText(entry, 'utf8') }
    }
  } catch {
    // Untrusted or malformed archives are never treated as launcher-managed.
  }
  return null
}

const hasCompanionMetadata = (jarPath: string) => {
  const metadata = readZipMetadata(jarPath)
  if (!metadata) return false
  if (metadata.entryName === 'fabric.mod.json') {
    try {
      const value: unknown = JSON.parse(metadata.text)
      return isRecord(value) && (value.id === BRANDING_BRIDGE_ID || value.id === LEGACY_BRIDGE_ID)
    } catch {
      return false
    }
  }
  return /(?:^|\r?\n)\s*modId\s*=\s*["']namlauncher_game_companion["']\s*(?:\r?\n|$)/m.test(metadata.text)
}

const isExpectedArtifact = (jarPath: string, artifact: BridgeArtifact) => {
  try {
    const info = fs.lstatSync(jarPath)
    return info.isFile() && !info.isSymbolicLink() && info.size === artifact.size
      && sha256(jarPath) === artifact.sha256 && hasCompanionMetadata(jarPath)
  } catch {
    return false
  }
}

const readManifest = (root: string) => {
  try {
    const manifestPath = path.join(root, BRIDGE_MANIFEST_FILENAME)
    assertPathWithinRoot(root, manifestPath)
    const info = fs.lstatSync(manifestPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_MANIFEST_SIZE) return null
    return parseBrandingBridgeManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  } catch {
    return null
  }
}

const readVerifiedBundle = (bundleRoots: readonly string[], target: InstanceBridgeTarget) => {
  let targetDeclared = false
  const loader = normalizeLoader(target.loader)
  for (const unresolvedRoot of bundleRoots) {
    try {
      const root = path.resolve(unresolvedRoot)
      const manifest = readManifest(root)
      if (!manifest) continue
      const artifact = manifest.artifacts.find((candidate) => (
        candidate.loader === loader && candidate.minecraftVersion === target.minecraftVersion
      ))
      if (!artifact) continue
      targetDeclared = true
      if (artifact.minimumLoaderVersion
        && !isVersionAtLeast(target.fabricLoaderVersion, artifact.minimumLoaderVersion)) continue
      const artifactPath = path.join(root, artifact.filename)
      assertPathWithinRoot(root, artifactPath)
      if (isExpectedArtifact(artifactPath, artifact)) return { artifactPath, artifact, targetDeclared }
    } catch {
      // A packaged candidate is untrusted until its metadata, size, and digest all verify.
    }
  }
  return { artifactPath: null, artifact: null, targetDeclared }
}

const readOwnershipMarker = (instanceRoot: string): BridgeOwnershipMarker | null => {
  const markerPath = path.join(instanceRoot, 'namlauncher-managed-game-bridge.json')
  assertPathWithinRoot(instanceRoot, markerPath)
  try {
    const value: unknown = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    if (!isRecord(value)) return null
    const filename = typeof value.filename === 'string' ? value.filename : ''
    const digest = typeof value.sha256 === 'string' ? value.sha256 : ''
    const version = typeof value.version === 'string' ? value.version : ''
    if ((value.schemaVersion !== 1 && value.schemaVersion !== 2)
      || (value.id !== BRANDING_BRIDGE_ID && value.id !== LEGACY_BRIDGE_ID)
      || value.managedBy !== 'NamLauncher'
      || value.author !== 'nattapat2871 (https://nattapat2871.me)'
      || path.basename(filename) !== filename || !MANAGED_FILENAME_PATTERN.test(filename)
      || !SHA256_PATTERN.test(digest) || !SAFE_VERSION_PATTERN.test(version)) return null
    return value as BridgeOwnershipMarker
  } catch {
    return null
  }
}

const listManagedBridgeFiles = (instanceRoot: string, modsDirectory: string) => {
  const candidates = new Set<string>()
  const marker = readOwnershipMarker(instanceRoot)
  if (marker) {
    const candidate = path.join(modsDirectory, marker.filename)
    assertPathWithinRoot(modsDirectory, candidate)
    try {
      const info = fs.lstatSync(candidate)
      if (info.isFile() && !info.isSymbolicLink() && sha256(candidate) === marker.sha256
        && hasCompanionMetadata(candidate)) candidates.add(candidate)
    } catch {
      // The bounded metadata scan below can still recover an orphaned managed companion.
    }
  }

  let inspected = 0
  for (const entry of fs.readdirSync(modsDirectory, { withFileTypes: true })) {
    if (inspected >= 4096) break
    inspected += 1
    if (!entry.isFile() || !MANAGED_CONTENT_FILENAME_PATTERN.test(entry.name)) continue
    const candidate = path.join(modsDirectory, entry.name)
    assertPathWithinRoot(modsDirectory, candidate)
    try {
      const info = fs.lstatSync(candidate)
      if (info.isFile() && !info.isSymbolicLink() && hasCompanionMetadata(candidate)) candidates.add(candidate)
    } catch {
      // Ignore untrusted or concurrently removed files.
    }
  }
  return [...candidates]
}

export const listManagedBrandingBridgeFiles = (options: Readonly<{
  instanceRoot: string
  gameDirectory: string
}>) => {
  const modsDirectory = path.join(options.gameDirectory, 'mods')
  assertPathWithinRoot(options.instanceRoot, modsDirectory)
  if (!fs.existsSync(modsDirectory)) return []
  return listManagedBridgeFiles(options.instanceRoot, modsDirectory)
}

export const isManagedBrandingBridgeFile = (options: Readonly<{
  instanceRoot: string
  gameDirectory: string
  filePath: string
}>) => {
  const resolvedFile = path.resolve(options.filePath)
  return listManagedBrandingBridgeFiles(options).some((candidate) => path.resolve(candidate) === resolvedFile)
}

const writeMarker = (instanceRoot: string, artifact: BridgeArtifact) => {
  const markerPath = path.join(instanceRoot, 'namlauncher-managed-game-bridge.json')
  const temporaryPath = `${markerPath}.${crypto.randomUUID()}.tmp`
  assertPathWithinRoot(instanceRoot, markerPath)
  assertPathWithinRoot(instanceRoot, temporaryPath)
  fs.writeFileSync(temporaryPath, `${JSON.stringify({
    schemaVersion: 2,
    id: BRANDING_BRIDGE_ID,
    version: artifact.version,
    loader: artifact.loader,
    minecraftVersion: artifact.minecraftVersion,
    filename: artifact.filename,
    sha256: artifact.sha256,
    managedBy: 'NamLauncher',
    author: 'nattapat2871 (https://nattapat2871.me)',
    installedAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    fs.rmSync(markerPath, { force: true })
    fs.renameSync(temporaryPath, markerPath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

const removeMarker = (instanceRoot: string) => {
  const markerPath = path.join(instanceRoot, 'namlauncher-managed-game-bridge.json')
  assertPathWithinRoot(instanceRoot, markerPath)
  fs.rmSync(markerPath, { force: true })
}

const removeManagedFiles = (modsDirectory: string, candidates: readonly string[], keepPath?: string) => {
  let removed = 0
  for (const candidate of candidates) {
    if (keepPath && path.resolve(candidate) === path.resolve(keepPath)) continue
    assertPathWithinRoot(modsDirectory, candidate)
    fs.rmSync(candidate, { force: true })
    removed += 1
  }
  return removed
}

const quarantineManagedFiles = (modsDirectory: string, candidates: readonly string[], keepPath?: string) => {
  const quarantined: Array<{ originalPath: string; quarantinePath: string }> = []
  try {
    for (const candidate of candidates) {
      if (keepPath && path.resolve(candidate) === path.resolve(keepPath)) continue
      assertPathWithinRoot(modsDirectory, candidate)
      const quarantinePath = path.join(
        modsDirectory,
        `.${path.basename(candidate)}.${crypto.randomUUID()}.namlauncher-backup`
      )
      assertPathWithinRoot(modsDirectory, quarantinePath)
      fs.renameSync(candidate, quarantinePath)
      quarantined.push({ originalPath: candidate, quarantinePath })
    }
    return quarantined
  } catch (error) {
    for (const item of quarantined.reverse()) {
      if (fs.existsSync(item.quarantinePath) && !fs.existsSync(item.originalPath)) {
        fs.renameSync(item.quarantinePath, item.originalPath)
      }
    }
    throw error
  }
}

const restoreQuarantinedFiles = (items: readonly { originalPath: string; quarantinePath: string }[]) => {
  for (const item of [...items].reverse()) {
    if (fs.existsSync(item.quarantinePath) && !fs.existsSync(item.originalPath)) {
      fs.renameSync(item.quarantinePath, item.originalPath)
    }
  }
}

const discardQuarantinedFiles = (items: readonly { quarantinePath: string }[]) => {
  for (const item of items) fs.rmSync(item.quarantinePath, { force: true })
}

const atomicallyInstallBridge = (sourcePath: string, targetPath: string, artifact: BridgeArtifact, canReplace: boolean) => {
  const directory = path.dirname(targetPath)
  const nonce = crypto.randomUUID()
  const temporaryPath = path.join(directory, `.${artifact.filename}.${nonce}.tmp`)
  const backupPath = path.join(directory, `.${artifact.filename}.${nonce}.bak`)
  assertPathWithinRoot(directory, temporaryPath)
  assertPathWithinRoot(directory, backupPath)
  fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL)
  try {
    if (!isExpectedArtifact(temporaryPath, artifact)) throw new Error('Game companion copy failed integrity verification.')
    if (fs.existsSync(targetPath)) {
      if (!canReplace) throw new Error('Game companion destination is owned by another mod.')
      fs.renameSync(targetPath, backupPath)
    }
    try {
      fs.renameSync(temporaryPath, targetPath)
    } catch (error) {
      if (fs.existsSync(backupPath) && !fs.existsSync(targetPath)) fs.renameSync(backupPath, targetPath)
      throw error
    }
    fs.rmSync(backupPath, { force: true })
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

export const provisionBrandingBridge = (options: Readonly<{
  instanceRoot: string
  gameDirectory: string
  target: InstanceBridgeTarget
  bundleRoots: readonly string[]
}>): BrandingBridgeProvisionResult => {
  const instanceRoot = path.resolve(options.instanceRoot)
  const gameDirectory = path.resolve(options.gameDirectory)
  const modsDirectory = path.join(gameDirectory, 'mods')
  assertPathWithinRoot(instanceRoot, gameDirectory)
  assertPathWithinRoot(gameDirectory, modsDirectory)
  fs.mkdirSync(modsDirectory, { recursive: true })
  assertPathWithinRoot(gameDirectory, modsDirectory)

  const managedFiles = listManagedBridgeFiles(instanceRoot, modsDirectory)
  const loader = normalizeLoader(options.target.loader)
  if (!SUPPORTED_LOADERS.has(loader)) {
    const removed = removeManagedFiles(modsDirectory, managedFiles)
    removeMarker(instanceRoot)
    return { status: removed > 0 ? 'removed' : 'not-applicable', filename: null, removed, supportStatus: null }
  }

  const bundle = readVerifiedBundle(options.bundleRoots, options.target)
  if (!bundle.artifact || !bundle.artifactPath) {
    if (bundle.targetDeclared) return { status: 'unavailable', filename: null, removed: 0, supportStatus: null }
    const removed = removeManagedFiles(modsDirectory, managedFiles)
    removeMarker(instanceRoot)
    return { status: removed > 0 ? 'removed' : 'not-applicable', filename: null, removed, supportStatus: null }
  }

  const targetPath = path.join(modsDirectory, bundle.artifact.filename)
  assertPathWithinRoot(modsDirectory, targetPath)
  if (isExpectedArtifact(targetPath, bundle.artifact)) {
    const quarantined = quarantineManagedFiles(modsDirectory, managedFiles, targetPath)
    try {
      writeMarker(instanceRoot, bundle.artifact)
      discardQuarantinedFiles(quarantined)
      return {
        status: 'current', filename: path.basename(targetPath), removed: quarantined.length,
        supportStatus: bundle.artifact.supportStatus
      }
    } catch (error) {
      restoreQuarantinedFiles(quarantined)
      throw error
    }
  }

  const targetExists = fs.existsSync(targetPath)
  const targetIsManaged = targetExists && managedFiles.some((candidate) => path.resolve(candidate) === path.resolve(targetPath))
  if (targetExists && !targetIsManaged) {
    const removed = removeManagedFiles(modsDirectory, managedFiles, targetPath)
    removeMarker(instanceRoot)
    return { status: 'collision', filename: path.basename(targetPath), removed, supportStatus: null }
  }

  const quarantined = quarantineManagedFiles(modsDirectory, managedFiles, targetPath)
  try {
    atomicallyInstallBridge(bundle.artifactPath, targetPath, bundle.artifact, targetIsManaged)
    writeMarker(instanceRoot, bundle.artifact)
    discardQuarantinedFiles(quarantined)
    return {
      status: 'installed', filename: path.basename(targetPath), removed: quarantined.length,
      supportStatus: bundle.artifact.supportStatus
    }
  } catch (error) {
    restoreQuarantinedFiles(quarantined)
    throw error
  }
}
