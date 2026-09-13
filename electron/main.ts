// Author/creator: nattapat2871 (https://nattapat2871.me)
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, safeStorage, shell, Tray } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, MessageBoxOptions, NativeImage, OpenDialogOptions, SaveDialogOptions } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import zlib from 'zlib'
import os from 'os'
import { spawn } from 'child_process'
import { pipeline } from 'node:stream/promises'
import { createServer, type Server } from 'http'
import https from 'https'
import { fileURLToPath, pathToFileURL } from 'url'
import tls from 'tls'
import axios from 'axios'
import { ProviderRequestGate, retryAfterMilliseconds } from './networkRetry.ts'
import { SharedProviderRequests } from './sharedProviderRequests.ts'
import { shouldInstallForgeProfileDirectly } from './minecraft/forgeProfile.ts'
import AdmZip from 'adm-zip'
import MCLC from 'minecraft-launcher-core'
import * as msmc from 'msmc'
import log from 'electron-log'
import { ensureJavaExists, getMinecraftLaunchJavaPath } from './javaManager'
import { discordManager, minecraftDiscordManager, MINECRAFT_OFFICIAL_APPLICATION_ID } from './discord'
import { normalizeLoader, parseNeoForgeMetadata, sortLoaderVersions, type LoaderType } from './loaderSupport'
import { fetchLegalDocument, type LegalLanguage } from './legal'
import {
  revokeLauncherDiscordSession,
  startLauncherDiscordLink,
  validateLauncherDiscordSession,
  waitForLauncherDiscordLink,
  type LauncherDiscordProfile
} from './launcherDiscordAuth.ts'
import { PROVIDER_USER_AGENT } from './appIdentity'
import {
  applyCustomJavaArgumentPolicy,
  normalizePerformanceProfile,
  resolvePerformancePolicy,
  type PerformanceProfile
} from './performancePolicy'
import { assertPathWithinRoot } from './pathSafety'
import { reconcileMatchingContentFileCollision } from './contentFileCollision.ts'
import {
  selectHomeDiscoveryProjects,
  type HomeDiscoveryLane,
  type HomeDiscoveryLaneResult
} from './homeDiscovery'
import { assessLanReadiness, detectLanPortFromLogLine } from './minecraft/lanReadiness'
import { discoverMinecraftLanServers } from './minecraft/lanDiscovery'
import {
  createLanDiscoveryCoordinator,
  isTrustedRendererSender,
  shouldPublishLanSessionPort
} from './minecraft/lanIpc'
import {
  isManagedBrandingBridgeFile,
  listManagedBrandingBridgeFiles,
  provisionBrandingBridge
} from './minecraft/brandingBridge'
import { normalizeMinecraftTextureId, verifyMinecraftTextureFile } from './minecraft/discordTexture.ts'
import { normalizePlayerBadgeUuid, writePlayerBadgeConfig } from './minecraft/playerBadgeConfig.ts'
import { scanRestrictedMods } from './minecraft/restrictedModAudit.ts'
import {
  addMinecraftServerDat,
  createServerQuickPlay,
  createWorldQuickPlay,
  mergePartnerServersDat,
  normalizeMinecraftServerEndpoint,
  pingMinecraftServer,
  readMinecraftServersDat,
  removeMinecraftServerDat,
  scanMinecraftWorlds,
  selectMinecraftServerPingTargets,
  createMinecraftServerTelemetryState,
  getForgeArtifactCoordinates,
  parseMinecraftServerLogEvent,
  type MinecraftServerTelemetryState
} from './minecraft/index.ts'
import { PARTNER_SERVERS, PARTNER_SERVER_REVISION } from '../shared/partnerServers.ts'
import {
  OFFLINE_USERNAME_ERROR_MESSAGE,
  isOfflineUsernameValidationError,
  isValidOfflineUsername
} from '../shared/offlineUsername.ts'
import { redactLabeledPlayerNames } from '../shared/privacyRedaction.ts'
import {
  buildLauncherInstallerTempPath,
  LauncherUpdateBlockedError,
  getLauncherUpdateBlockedResult
} from '../shared/launcherUpdate.ts'
import { getLauncherUpdateCleanupRetryDelay } from '../shared/launcherUpdateCleanup.ts'
import { createStartupUpdateController, selectStartupUpdateTarget } from '../shared/startupUpdate.ts'
import { launchWindowsAutoInstaller } from './updates/windowsAutoInstaller.ts'
import { resolveWindowsInstallScope } from './updates/windowsInstallScope.ts'
import { installPlatformAutoUpdate } from './updates/platformAutoUpdate.ts'
import { recoverLegacyLauncherDataPath } from './dataLocationRecovery.ts'
import { WindowResponsivenessMonitor } from './windowResponsiveness.ts'
import {
  assertFileSha256,
  normalizeLauncherInstallerSha256
} from '../shared/launcherUpdateIntegrity.ts'
import {
  GAME_SESSION_HEARTBEAT_INTERVAL_MS,
  getGameSessionEndReason,
  normalizeGameSessionLoader,
  type GameSessionEndReason,
  type GameSessionEventName
} from '../shared/gameSessionTelemetry.ts'
import {
  formatMinecraftCrashDiagnosisForReport,
  getMinecraftCrashDiagnosis,
  type MinecraftCrashDiagnosis
} from '../shared/minecraftCrashDiagnosis.ts'
import {
  classifyMinecraftProcessFailure,
  isLocalMinecraftLaunchFailure,
  type MinecraftFailureClassification,
  type MinecraftGameIssue
} from '../shared/minecraftFailureClassification.ts'
import {
  getModrinthPackFileIdentity,
  planModpackClientFiles
} from '../shared/modpackCompatibility.ts'
import {
  buildModrinthSearchFacets,
  isLibraryLoader,
  normalizeLibraryGameVersion,
  normalizeLibrarySearchFilters,
  normalizeLibrarySearchLimit,
  normalizeLibrarySearchOffset,
  normalizeLibrarySearchQuery,
  normalizeLibraryTotalHits,
  type LibraryEnvironment,
  type LibrarySort
} from '../shared/librarySearchFilters.ts'

const configureSystemCertificateStore = () => {
  const tlsWithSystemStore = tls as typeof tls & {
    getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[]
    setDefaultCACertificates?: (certificates: string[]) => void
  }

  if (typeof tlsWithSystemStore.getCACertificates !== 'function') return

  try {
    const defaultCertificates = tlsWithSystemStore.getCACertificates('default')
    const systemCertificates = tlsWithSystemStore.getCACertificates('system')
    if (!systemCertificates.length) return

    const trustedCertificates = Array.from(new Set([
      ...defaultCertificates,
      ...systemCertificates
    ]))

    tlsWithSystemStore.setDefaultCACertificates?.(trustedCertificates)
    https.globalAgent.options.ca = trustedCertificates
    axios.defaults.httpsAgent = https.globalAgent
    log.info(`Loaded ${systemCertificates.length} system CA certificates for HTTPS requests.`)
  } catch (err) {
    log.warn('Could not load system CA certificates for HTTPS requests.', err)
  }
}

configureSystemCertificateStore()

const { Client } = MCLC

type ModrinthProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader'
type InstanceContentKind = 'mods' | 'resourcepacks' | 'shaderpacks' | 'screenshots'
type ContentProvider = 'modrinth' | 'curseforge'

type LauncherStorageDevice = {
  model: string
  size?: string | null
  mediaType?: string | null
}

type LauncherSystemReport = {
  os: string
  cpu: string
  cpu_cores?: number
  ram_gb: number
  gpu: string[]
  storage: LauncherStorageDevice[]
  platform: string
  arch: string
}

type LauncherErrorReport = {
  id: string
  title: string
  context: string
  message: string
  logs: string
  occurredAt: string
  launcherVersion: string
  platform: string
  arch: string
  electronVersion: string
  playerName?: string
  accountType?: string | null
  diagnosis?: MinecraftCrashDiagnosis | null
  system: LauncherSystemReport
}

type LauncherErrorSubmitRequest = {
  reportId?: string
  activeAccountId?: string | null
  playerName?: string | null
}

type LauncherErrorSubmitResult = {
  success: boolean
  duplicate: boolean
  reportId: string
  occurrenceCount?: number
  discordDispatched?: boolean
  discordQueued?: boolean
}

type StoredAccount = {
  id: string
  uuid: string
  name: string
  type: 'msa' | 'offline'
  auth: any
  createdAt: string
  updatedAt: string
}

type AccountSummary = Omit<StoredAccount, 'auth'>

type LauncherReleaseArtifact = {
  version?: string
  updates_paused?: boolean
  id?: string
  platform?: string
  label?: string
  format?: string
  arch?: string
  url?: string | null
  available?: boolean
  recommended?: boolean
  sha256?: string | null
}

type LauncherReleaseResponse = {
  version?: string
  channel?: string
  download_url?: string
  mandatory?: boolean
  notes?: string[]
  artifacts?: LauncherReleaseArtifact[]
}

type SkinModel = 'classic' | 'slim'

type StoredSkinPreset = {
  id: string
  accountId: string
  name: string
  model: SkinModel
  fileName: string
  capeFileName?: string | null
  capeId?: string | null
  sourceProfileUuid?: string | null
  sourceProfileName?: string | null
  sourceTextureId?: string | null
  createdAt: string
  updatedAt: string
}

type StoredMinecraftProfileCape = {
  id: string
  name: string
  fileName: string
  active: boolean
}

type StoredMinecraftProfileCache = {
  id: string
  name: string
  model: SkinModel
  fileName: string
  textureId?: string | null
  capes: StoredMinecraftProfileCape[]
  activeCapeId?: string | null
  refreshedAt: string
}

type StoredSkinAccount = {
  activeSkinId?: string | null
  activeDefaultSkinId?: string | null
  skins: StoredSkinPreset[]
  profileCache?: StoredMinecraftProfileCache | null
}

type StoredSkinLibrary = {
  version: 1
  accounts: Record<string, StoredSkinAccount>
}

type SkinSaveRequest = {
  accountId?: string
  skinId?: string
  name?: string
  model?: string
  textureDataUrl?: string
  capeId?: string | null
  activate?: boolean
}

type SkinActionRequest = {
  accountId?: string
  skinId?: string
  capeId?: string | null
}

type SkinImportRequest = {
  accountId?: string
  playerName?: string
}

type SkinDefaultRequest = {
  accountId?: string
  defaultSkinId?: string
}

type LauncherInstance = {
  id?: string | number
  name?: string
  version?: string
  loader?: string
  loaderVersion?: string
  iconUrl?: string | null
  createdAt?: string
  playtimeSeconds?: number
  lastPlayedAt?: string
}

type LaunchRequest = {
  accountId?: string
  auth?: any
  instance?: LauncherInstance
  instanceName?: string
  version?: string
  loader?: string
  loaderVersion?: string
  memoryGb?: number
  quickPlay?:
    | { type: 'server'; address: string }
    | { type: 'world'; folderName: string }
}

type InstanceServerMutationRequest = LaunchRequest & {
  name?: string
  address?: string
  index?: number
  expectedCanonicalKey?: string
}

type InstanceServerPingRequest = LaunchRequest & {
  addresses?: unknown
}

type ModrinthInstallRequest = {
  taskId?: string
  playerName?: string
  accountType?: string
  instance?: LauncherInstance
  project?: {
    project_id?: string
    id?: string
    slug?: string
    title?: string
    project_type?: string
    icon_url?: string | null
  }
  projectId?: string
  projectType?: string
  versionId?: string
}

type CurseForgeProject = {
  id?: number | string
  project_id?: string
  title?: string
  name?: string
  slug?: string
  description?: string
  icon_url?: string | null
  website_url?: string | null
  allow_distribution?: boolean
  provider?: 'curseforge'
  project_type?: ModrinthProjectType
}

type CurseForgeSearchRequest = {
  query?: string
  projectType?: string
  offset?: number
  limit?: number
  instance?: LauncherInstance | null
  sort?: LibrarySort
  gameVersion?: string
  loader?: string
}

type CurseForgeInstallRequest = {
  taskId?: string
  playerName?: string
  accountType?: string
  instance?: LauncherInstance
  project?: CurseForgeProject
  fileId?: string | number
}

type CurseForgeManualDownload = {
  id: string
  title: string
  filename: string
  displayName?: string
  projectId: number
  fileId: number
  projectType: Exclude<ModrinthProjectType, 'modpack'>
  websiteUrl: string
  fileUrl: string
  iconUrl?: string | null
  targetDirectory?: string
  hashes?: Record<string, string>
  fileLength?: number
}

type CurseForgeManualDownloadRequest = {
  instance?: LauncherInstance
  item?: CurseForgeManualDownload
}

type ModrinthSearchRequest = {
  query?: string
  projectType?: string
  offset?: number
  limit?: number
  index?: string
  gameVersion?: string
  loader?: string
  environment?: LibraryEnvironment
  openSourceOnly?: boolean
}

type LanReadinessRequest = {
  instance?: LauncherInstance
}

const discoverLocalMinecraftServers = createLanDiscoveryCoordinator(
  () => discoverMinecraftLanServers({ timeoutMs: 2_500 })
)

type CurseForgeContentStatusRequest = {
  instance?: LauncherInstance | null
  projects?: CurseForgeProject[]
}

type InstanceContentRequest = {
  instance?: LauncherInstance
  kind?: string
  fileName?: string
  contentId?: string
  filePaths?: string[]
  enabled?: boolean
}

type InstanceUpdateRequest = {
  instance?: LauncherInstance
  updates?: LauncherInstance
}

type DataLocationMoveRequest = {
  initialSetup?: boolean
  restartAfterMove?: boolean
}

type LauncherSettings = {
  discordRpcEnabled: boolean
  anonymousStatsEnabled: boolean
  gameplayTelemetryEnabled: boolean
  playerBadgeEnabled: boolean
  restrictedModAuditEnabled: boolean
  customJavaArgsEnabled: boolean
  customJavaArgs: string
  autoMinimizeOnLaunch: boolean
  closeToTrayEnabled: boolean
  automaticMemory: boolean
  performanceProfile: PerformanceProfile
  language: 'en' | 'th'
}

type DiscordRuntimeSettings = LauncherSettings & {
  discordClientId: string
  launcherVersion: string
}

type ModrinthContentStatusRequest = {
  instance?: LauncherInstance
  projects?: ModrinthInstallRequest['project'][]
}

type ContentUpdateItem = {
  projectId: string
  title: string
  projectType: Exclude<ModrinthProjectType, 'modpack'>
  iconUrl?: string | null
  installedVersion: string
  installedVersionId: string
  latestVersion: string
  latestVersionId: string
  provider?: ContentProvider
}

type ModrinthVersionFile = {
  url: string
  filename: string
  primary?: boolean
  size?: number
  hashes?: Record<string, string>
  file_type?: string | null
}

type ModrinthPackFile = {
  path: string
  hashes?: Record<string, string>
  env?: {
    client?: 'required' | 'optional' | 'unsupported'
    server?: 'required' | 'optional' | 'unsupported'
  }
  downloads?: string[]
  fileSize?: number
}

type ModrinthPackIndex = {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files?: ModrinthPackFile[]
  dependencies?: Record<string, string>
}

type ModrinthVersion = {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  dependencies?: Array<{
    version_id?: string | null
    project_id?: string | null
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
  }>
  files: ModrinthVersionFile[]
}

type CurseForgeFile = {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: number
  fileDate?: string
  fileLength?: number
  downloadUrl?: string | null
  gameVersions?: string[]
  isAvailable?: boolean
  hashes?: Array<{ value: string; algo: number }>
  dependencies?: Array<{ modId: number; relationType: number }>
}

type CurseForgeMod = {
  id: number
  name: string
  slug: string
  summary?: string
  downloadCount?: number
  allowModDistribution?: boolean
  isAvailable?: boolean
  classId?: number
  links?: { websiteUrl?: string }
  authors?: Array<{ name?: string }>
  logo?: { thumbnailUrl?: string; url?: string }
  latestFiles?: CurseForgeFile[]
}

type InstalledContentFile = {
  filename: string
  path: string
  hashes?: Record<string, string>
  dependency: boolean
}

type InstalledModrinthItem = InstalledContentFile & {
  projectId: string
  projectType?: ModrinthProjectType
  versionId: string
  versionNumber: string
  versionName: string
  skipped: boolean
}

type InstalledContentRecord = {
  projectId: string
  title: string
  projectType: ModrinthProjectType
  iconUrl?: string | null
  versionId: string
  versionNumber: string
  versionName: string
  gameVersion: string
  loader: string
  files: InstalledContentFile[]
  installedAt: string
  updatedAt: string
  provider?: ContentProvider
}

type InstanceContentManifest = {
  version: 1
  projects: Record<string, InstalledContentRecord>
}

type ExportInstanceMrpackResult = {
  success: boolean
  canceled?: boolean
  filePath?: string
  modrinthFiles?: number
  overrideFiles?: number
  totalFiles?: number
}

type RunningGame = {
  process: any
  instanceId: string
  instanceName: string
  minecraftVersion: string
  playerName: string
  playerUuid: string
  gameDirectory: string
  playerTextureId: string | null
  gamePid: number
  startedAt: number
  loader: string
  accountType: 'msa' | 'offline' | 'unknown'
  telemetrySessionId: string
  telemetryActive: boolean
  telemetryStartAcknowledged: boolean
  telemetryQueue?: Promise<void>
  currentServer: MinecraftServerTelemetryState | null
  knownServers: Array<{ canonicalKey: string | null; name: string }>
  badgePresenceId: string
  badgePresenceActive: boolean
  badgePresenceStartAcknowledged: boolean
  badgePresenceQueue?: Promise<void>
  lanPort?: number
  logStream?: fs.WriteStream | null
  stopRequestedAt?: number
}

type LaunchSession = {
  id: string
  launcher: InstanceType<typeof Client>
  abortController: AbortController
  cancelled: boolean
  startedAt: number
  lastProgressAt: number
  instanceId?: string
  instanceName?: string
  logStream?: fs.WriteStream | null
  childProcess?: any
}

type InstallTask = {
  id: string
  label: string
  abortController: AbortController
  cancelled: boolean
  startedAt: number
}

const HTTP_HEADERS = {
  'User-Agent': PROVIDER_USER_AGENT
}

type StatsApiRequestOptions = {
  method?: string
  timeout?: number
  headers?: Record<string, string>
  body?: unknown
}

class StatsApiRequestError extends Error {
  status?: number
  detail?: string

  constructor(message: string, status?: number, detail?: string) {
    super(message)
    this.name = 'StatsApiRequestError'
    this.status = status
    this.detail = detail
  }
}

const requestStatsApiJson = async <T>(
  endpoint: string,
  options: StatsApiRequestOptions = {}
): Promise<T> => {
  const controller = new AbortController()
  const timeoutMs = Math.max(1000, options.timeout || 15000)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${STATS_API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`

  try {
    const response = await net.fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...HTTP_HEADERS,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })
    const text = await response.text()
    let data: any = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { detail: text.slice(0, 300) }
      }
    }

    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : ''
      throw new StatsApiRequestError(
        detail || `NamLauncher website returned HTTP ${response.status}.`,
        response.status,
        detail
      )
    }

    return (data || {}) as T
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new StatsApiRequestError('NamLauncher website did not respond in time.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

type CurseForgePackManifest = {
  manifestType?: string
  manifestVersion?: number
  name?: string
  version?: string
  author?: string
  overrides?: string
  minecraft?: {
    version?: string
    modLoaders?: Array<{ id?: string; primary?: boolean }>
  }
  files?: Array<{ projectID?: number; fileID?: number; required?: boolean }>
}
const FABRIC_META_BASE = 'https://meta.fabricmc.net/v2'
const QUILT_META_BASE = 'https://meta.quiltmc.org/v3'
const QUILT_MAVEN_METADATA_URL = 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/maven-metadata.xml'
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN_BASE = 'https://maven.neoforged.net/releases'
const NEOFORGE_METADATA_URL = `${NEOFORGE_MAVEN_BASE}/net/neoforged/neoforge/maven-metadata.xml`
const MOJANG_VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const MODRINTH_API_BASE = 'https://api.modrinth.com/v2'
const MODRINTH_MAX_CONCURRENT_REQUESTS = 4
const MODRINTH_MIN_REQUEST_GAP_MS = 200
const MODRINTH_DIRECT_TIMEOUT_MS = 6500
const MODRINTH_PROXY_TIMEOUT_MS = 8000
const MODRINTH_PROXY_MAX_ATTEMPTS = 2
const MODRINTH_RETRY_MAX_DELAY_MS = 5000
const MODRINTH_METADATA_MAX_BYTES = 16 * 1024 * 1024
const MODRINTH_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const MODRINTH_PROXY_FALLBACK_STATUSES = new Set([404, 408, 425, 500, 502, 503, 504])
const MODRINTH_RETRY_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN'
])
const DOWNLOAD_INTEGRITY_ERROR_CODE = 'EINTEGRITY'
const DOWNLOAD_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DOWNLOAD_RETRY_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED',
  'EPIPE',
  DOWNLOAD_INTEGRITY_ERROR_CODE
])
const PROJECT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const PROJECT_SEARCH_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000
const PROJECT_SEARCH_CACHE_LIMIT = 80
const MODRINTH_VERSION_CACHE_TTL_MS = 2 * 60 * 1000
const MODRINTH_VERSION_CACHE_LIMIT = 256
let activeModrinthRequests = 0
let nextModrinthRequestAt = 0
type PendingModrinthRequest = {
  resolve: () => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abort?: () => void
  timer?: ReturnType<typeof setTimeout>
}
const pendingModrinthRequests: PendingModrinthRequest[] = []
type ProjectSearchResult = { hits: any[]; total_hits: number; stale?: boolean }
type ProjectSearchCacheEntry = { result: ProjectSearchResult; storedAt: number }
const projectSearchCache = new Map<string, ProjectSearchCacheEntry>()
const projectSearchInFlight = new Map<string, Promise<ProjectSearchResult>>()
const modrinthVersionCache = new Map<string, { versions: ModrinthVersion[]; storedAt: number }>()
const modrinthVersionRequests = new Map<string, Promise<ModrinthVersion[]>>()
let activeModrinthSearchController: AbortController | null = null
let activeCurseForgeSearchController: AbortController | null = null
const fileDownloadLocks = new Map<string, Promise<void>>()

// Author/creator: nattapat2871 (https://nattapat2871.me)
const withFileDownloadLock = async <T>(filePath: string, operation: () => Promise<T>) => {
  const resolvedPath = path.resolve(filePath)
  const key = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
  const previous = fileDownloadLocks.get(key) || Promise.resolve()
  let releaseCurrent: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  fileDownloadLocks.set(key, current)

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    releaseCurrent()
    if (fileDownloadLocks.get(key) === current) fileDownloadLocks.delete(key)
  }
}

const getCachedProjectSearchResult = (cacheKey: string, allowStale = false) => {
  const cached = projectSearchCache.get(cacheKey)
  if (!cached) return null
  const cacheAge = Date.now() - cached.storedAt
  if (cacheAge > PROJECT_SEARCH_CACHE_STALE_TTL_MS) {
    projectSearchCache.delete(cacheKey)
    return null
  }
  if (!allowStale && cacheAge > PROJECT_SEARCH_CACHE_TTL_MS) return null
  return cached.result
}

const setCachedProjectSearchResult = (cacheKey: string, result: ProjectSearchResult) => {
  projectSearchCache.set(cacheKey, { result, storedAt: Date.now() })
  while (projectSearchCache.size > PROJECT_SEARCH_CACHE_LIMIT) {
    const oldestKey = projectSearchCache.keys().next().value
    if (!oldestKey) break
    projectSearchCache.delete(oldestKey)
  }
}

const setCachedModrinthVersions = (cacheKey: string, versions: ModrinthVersion[]) => {
  const now = Date.now()
  for (const [key, entry] of modrinthVersionCache) {
    if (now - entry.storedAt >= MODRINTH_VERSION_CACHE_TTL_MS) {
      modrinthVersionCache.delete(key)
    }
  }

  modrinthVersionCache.delete(cacheKey)
  modrinthVersionCache.set(cacheKey, { versions, storedAt: now })
  while (modrinthVersionCache.size > MODRINTH_VERSION_CACHE_LIMIT) {
    const oldestKey = modrinthVersionCache.keys().next().value
    if (!oldestKey) break
    modrinthVersionCache.delete(oldestKey)
  }
}

const createModrinthCanceledError = () => new axios.CanceledError('Modrinth request canceled')

const cleanupPendingModrinthRequest = (request: PendingModrinthRequest) => {
  if (request.abort) request.signal?.removeEventListener('abort', request.abort)
  request.abort = undefined
}

const pumpModrinthRequests = () => {
  while (activeModrinthRequests < MODRINTH_MAX_CONCURRENT_REQUESTS && pendingModrinthRequests.length > 0) {
    const request = pendingModrinthRequests.shift()
    if (!request) break
    if (request.signal?.aborted) {
      cleanupPendingModrinthRequest(request)
      request.reject(createModrinthCanceledError())
      continue
    }

    activeModrinthRequests += 1
    const scheduledAt = Math.max(Date.now(), nextModrinthRequestAt)
    nextModrinthRequestAt = scheduledAt + MODRINTH_MIN_REQUEST_GAP_MS
    const start = () => {
      request.timer = undefined
      cleanupPendingModrinthRequest(request)
      request.resolve()
    }
    const delay = Math.max(0, scheduledAt - Date.now())
    if (delay === 0) start()
    else request.timer = setTimeout(start, delay)
  }
}

const acquireModrinthSlot = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(createModrinthCanceledError())
    return
  }

  const request: PendingModrinthRequest = { resolve, reject, signal }
  const abort = () => {
    const queuedIndex = pendingModrinthRequests.indexOf(request)
    if (queuedIndex >= 0) {
      pendingModrinthRequests.splice(queuedIndex, 1)
      cleanupPendingModrinthRequest(request)
      reject(createModrinthCanceledError())
      return
    }
    if (request.timer !== undefined) {
      clearTimeout(request.timer)
      request.timer = undefined
      activeModrinthRequests = Math.max(0, activeModrinthRequests - 1)
      cleanupPendingModrinthRequest(request)
      reject(createModrinthCanceledError())
      pumpModrinthRequests()
    }
  }
  request.abort = abort
  signal?.addEventListener('abort', abort, { once: true })
  pendingModrinthRequests.push(request)
  pumpModrinthRequests()
})

const releaseModrinthSlot = () => {
  activeModrinthRequests = Math.max(0, activeModrinthRequests - 1)
  pumpModrinthRequests()
}
type AppIcon = {
  path: string
  image: NativeImage
}

const getRetryAfterMs = (error: unknown, fallbackMs: number) => {
  if (!axios.isAxiosError(error)) return fallbackMs
  const raw = error.response?.headers?.['retry-after']
  const retryAfter = Array.isArray(raw) ? raw[0] : raw
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15000)
  const retryAt = Date.parse(String(retryAfter || ''))
  if (Number.isFinite(retryAt)) return Math.min(Math.max(0, retryAt - Date.now()), 15000)
  return fallbackMs
}

const getGenericRetryAfterMs = (error: unknown, fallbackMs: number) => {
  if (axios.isAxiosError(error)) return getRetryAfterMs(error, fallbackMs)
  return fallbackMs
}

const getErrorCode = (error: unknown) => {
  if (axios.isAxiosError(error)) return error.code || ''
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' ? code : ''
}

const shouldRetryDownloadError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status && DOWNLOAD_RETRY_STATUSES.has(status)) return true
  }
  const code = getErrorCode(error)
  return Boolean(code && DOWNLOAD_RETRY_CODES.has(code))
}

const shouldRetryModrinthRequest = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false
  if (error.code === 'ERR_CANCELED') return false
  const status = error.response?.status
  if (status && MODRINTH_RETRY_STATUSES.has(status)) return true
  return Boolean(error.code && MODRINTH_RETRY_CODES.has(error.code))
}

const getModrinthRetryDelay = (error: unknown, attempt: number) => {
  const backoffMs = Math.min(500 * (2 ** attempt), MODRINTH_RETRY_MAX_DELAY_MS)
  const jitterMs = Math.floor(Math.random() * Math.min(250, Math.max(1, backoffMs / 2)))
  const retryAfterMs = getRetryAfterMs(error, backoffMs + jitterMs)
  return Math.min(Math.max(retryAfterMs, 0), MODRINTH_RETRY_MAX_DELAY_MS)
}

const waitForModrinthRetry = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(createModrinthCanceledError())
    return
  }

  const finish = () => {
    signal?.removeEventListener('abort', abort)
    resolve()
  }
  const abort = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    reject(createModrinthCanceledError())
  }
  const timer = setTimeout(finish, milliseconds)
  signal?.addEventListener('abort', abort, { once: true })
})

const normalizeModrinthPathSegment = (segment: string) => encodeURIComponent(decodeURIComponent(segment))

const getModrinthProxyUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    const apiBase = new URL(MODRINTH_API_BASE)
    if (parsed.origin !== apiBase.origin) return null

    const apiPrefix = apiBase.pathname.replace(/\/+$/, '')
    if (!parsed.pathname.startsWith(`${apiPrefix}/`)) return null
    const segments = parsed.pathname.slice(apiPrefix.length).split('/').filter(Boolean)

    if (segments.length === 1 && segments[0] === 'search') {
      return `${MODRINTH_PROXY_BASE}/search`
    }
    if (segments.length === 2 && segments[0] === 'project') {
      return `${MODRINTH_PROXY_BASE}/projects/${normalizeModrinthPathSegment(segments[1])}`
    }
    if (segments.length === 3 && segments[0] === 'project' && segments[2] === 'version') {
      return `${MODRINTH_PROXY_BASE}/projects/${normalizeModrinthPathSegment(segments[1])}/versions`
    }
    if (segments.length === 2 && segments[0] === 'version') {
      return `${MODRINTH_PROXY_BASE}/versions/${normalizeModrinthPathSegment(segments[1])}`
    }
  } catch {
    return null
  }

  return null
}

const shouldFallbackToModrinthProxy = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false
  if (error.code === 'ERR_CANCELED') return false
  const status = error.response?.status
  if (status && (MODRINTH_PROXY_FALLBACK_STATUSES.has(status) || status === 429)) return true
  return Boolean(!status && error.code && MODRINTH_RETRY_CODES.has(error.code))
}

const requestModrinthEndpoint = async <T>(
  url: string,
  config: Record<string, any>,
  source: 'proxy' | 'direct'
): Promise<T> => {
  await acquireModrinthSlot(config.signal)
  try {
    const response = await axios.get<T>(url, {
      ...config,
      timeout: Math.min(
        Number(config.timeout || 30000),
        source === 'proxy' ? MODRINTH_PROXY_TIMEOUT_MS : MODRINTH_DIRECT_TIMEOUT_MS
      ),
      maxContentLength: MODRINTH_METADATA_MAX_BYTES,
      maxBodyLength: MODRINTH_METADATA_MAX_BYTES,
      headers: {
        ...HTTP_HEADERS,
        ...(source === 'proxy' ? { 'X-NamLauncher-Client': getClientInstallId() } : {}),
        ...(config.headers || {})
      }
    })
    return response.data
  } finally {
    releaseModrinthSlot()
  }
}

const requestModrinthProxyWithRetry = async <T>(
  proxyUrl: string,
  config: Record<string, any>
): Promise<T> => {
  for (let attempt = 0; attempt < MODRINTH_PROXY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestModrinthEndpoint<T>(proxyUrl, config, 'proxy')
    } catch (err) {
      if (attempt + 1 >= MODRINTH_PROXY_MAX_ATTEMPTS || !shouldRetryModrinthRequest(err)) throw err

      const retryDelay = getModrinthRetryDelay(err, attempt)
      log.warn(`Modrinth proxy request failed; retrying in ${retryDelay}ms.`, getCompactErrorLog(err))
      await waitForModrinthRetry(retryDelay, config.signal)
    }
  }

  throw new Error('Modrinth proxy request failed.')
}

const requestModrinth = async <T>(url: string, config: Record<string, any> = {}): Promise<T> => {
  const proxyUrl = getModrinthProxyUrl(url)
  if (!proxyUrl) return requestModrinthEndpoint<T>(url, config, 'direct')

  try {
    return await requestModrinthEndpoint<T>(url, config, 'direct')
  } catch (err) {
    if (!shouldFallbackToModrinthProxy(err)) throw err
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    log.warn(`Direct Modrinth API unavailable${status ? ` (HTTP ${status})` : ''}; falling back to the NamLauncher proxy.`)
    return requestModrinthProxyWithRetry<T>(proxyUrl, config)
  }
}

const normalizePathForCompare = (value: string) => {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const isSamePath = (left: string, right: string) => {
  return normalizePathForCompare(left) === normalizePathForCompare(right)
}

const isPathAtOrInside = (childPath: string, parentPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relativePath === '' || (Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const canWriteToDirectory = (directory: string) => {
  try {
    fs.mkdirSync(directory, { recursive: true })
    const probePath = path.join(directory, `.namlauncher-write-test-${process.pid}-${Date.now()}`)
    fs.writeFileSync(probePath, 'ok', 'utf8')
    fs.rmSync(probePath, { force: true })
    return true
  } catch {
    return false
  }
}

const getPackagedInstallRoot = () => {
  return path.dirname(process.execPath)
}

const DATA_LOCATION_FILE = 'data-location.json'
const DATA_LOCATION_BACKUP_FILE = `${DATA_LOCATION_FILE}.backup`
const DATA_CLEANUP_FILE = 'pending-data-cleanup.json'
const UPDATE_CLEANUP_FILE = 'pending-launcher-update-cleanup.json'
const ROOT_FOLDER_NAME = 'NamLauncher'
const LAUNCHER_FOLDER_NAME = 'Launcher'
const DATA_FOLDER_NAME = 'NamLauncher-data'
const UPDATE_FOLDER_NAME = 'updates'

const getPackagedLauncherHomePath = () => {
  const installRoot = getPackagedInstallRoot()
  return path.basename(installRoot).toLowerCase() === LAUNCHER_FOLDER_NAME.toLowerCase()
    ? path.dirname(installRoot)
    : installRoot
}

const getLegacyPackagedInstallDataPaths = () => {
  const installRoot = getPackagedInstallRoot()
  const homeRoot = getPackagedLauncherHomePath()
  return Array.from(new Set([
    path.join(installRoot, 'data'),
    path.resolve(`${installRoot}-data`),
    path.join(homeRoot, 'data'),
    path.resolve(`${homeRoot}-data`)
  ]))
}

const getPackagedInstallDataPath = () => {
  return path.join(getPackagedLauncherHomePath(), DATA_FOLDER_NAME)
}

const getDataLocationConfigPath = (defaultUserDataPath: string) => {
  return path.join(defaultUserDataPath, DATA_LOCATION_FILE)
}

const getLauncherRootForSelectedPath = (selectedPath: string) => {
  const resolved = path.resolve(selectedPath)
  const basename = path.basename(resolved).toLowerCase()
  const parentBasename = path.basename(path.dirname(resolved)).toLowerCase()

  if (basename === DATA_FOLDER_NAME.toLowerCase()) return path.dirname(resolved)
  if (basename === LAUNCHER_FOLDER_NAME.toLowerCase() && parentBasename === ROOT_FOLDER_NAME.toLowerCase()) {
    return path.dirname(resolved)
  }
  if (basename === ROOT_FOLDER_NAME.toLowerCase()) return resolved
  return path.join(resolved, ROOT_FOLDER_NAME)
}

const normalizeLauncherDataTarget = (selectedPath: string) => {
  const resolved = path.resolve(selectedPath)
  return path.basename(resolved).toLowerCase() === DATA_FOLDER_NAME.toLowerCase()
    ? resolved
    : path.join(getLauncherRootForSelectedPath(resolved), DATA_FOLDER_NAME)
}

const readConfiguredDataPath = (defaultUserDataPath: string) => {
  const configPaths = [
    getDataLocationConfigPath(defaultUserDataPath),
    path.join(defaultUserDataPath, DATA_LOCATION_BACKUP_FILE)
  ]
  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) continue
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { dataPath?: string }
      const dataPath = typeof config.dataPath === 'string' ? config.dataPath.trim() : ''
      if (dataPath) return dataPath
    } catch {
      // Try the recoverable backup written during an interrupted atomic replacement.
    }
  }
  return ''
}

let recoveredLegacyDataPath = ''

const resolveUserDataPath = (defaultUserDataPath: string) => {
  const configuredDataPath = String(process.env.NAMLAUNCHER_DATA_DIR || '').trim()
    || readConfiguredDataPath(defaultUserDataPath)
  const packagedDataPath = app.isPackaged ? getPackagedInstallDataPath() : ''
  const candidatePath = configuredDataPath
    ? path.resolve(configuredDataPath)
    : app.isPackaged
      ? packagedDataPath
      : defaultUserDataPath

  if (!configuredDataPath && app.isPackaged && process.platform === 'win32') {
    recoveredLegacyDataPath = recoverLegacyLauncherDataPath({
      defaultDataPath: defaultUserDataPath,
      packagedDataPath
    })
    if (recoveredLegacyDataPath && canWriteToDirectory(recoveredLegacyDataPath)) {
      return recoveredLegacyDataPath
    }
  }

  if (canWriteToDirectory(candidatePath)) return candidatePath
  return defaultUserDataPath
}

const defaultUserDataPath = app.getPath('userData')
const dataLocationConfigPath = getDataLocationConfigPath(defaultUserDataPath)
const selectedUserDataPath = resolveUserDataPath(defaultUserDataPath)

if (!isSamePath(selectedUserDataPath, defaultUserDataPath)) {
  app.setPath('userData', selectedUserDataPath)
}

const legacyUserDataPath = defaultUserDataPath
const userDataPath = app.getPath('userData')
const accountsPath = path.join(userDataPath, 'accounts.json')
const settingsPath = path.join(userDataPath, 'settings.json')
const launcherDiscordAccountPath = path.join(userDataPath, 'discord-account.json')
const clientIdentityPath = path.join(userDataPath, 'client.json')
const curseForgeConfigPath = path.join(userDataPath, 'curseforge.json')
const imageCacheDir = path.join(userDataPath, 'cache', 'images')
const skinsDirectory = path.join(userDataPath, 'skins')
const skinsLibraryPath = path.join(skinsDirectory, 'skins.json')
const DEFAULT_DISCORD_CLIENT_ID = '1515299686637109388'
const APP_ICON_FILE = 'NamLauncher-icon.png'
const STATS_API_BASE = !app.isPackaged && process.env.NAMLAUNCHER_API_BASE
  ? String(process.env.NAMLAUNCHER_API_BASE).replace(/\/+$/, '')
  : 'https://namlauncher.nattapat2871.me'
const MODRINTH_PROXY_BASE = `${STATS_API_BASE}/api/v1/modrinth`
const MAX_LAUNCHER_INSTALLER_BYTES = 512 * 1024 * 1024
const MAX_CONTENT_DOWNLOAD_BYTES = 1024 * 1024 * 1024
const MAX_CACHED_IMAGE_BYTES = 1024 * 1024
const SAFE_CACHED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_ZIP_METADATA_ENTRY_BYTES = 512 * 1024
const MAX_MODPACK_INDEX_BYTES = 8 * 1024 * 1024
const MAX_MODPACK_ICON_BYTES = 1_500_000
const MAX_MODPACK_OVERRIDE_TOTAL_BYTES = 1024 * 1024 * 1024
const MAX_MODPACK_OVERRIDE_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_MODPACK_OVERRIDE_FILES = 20_000
declare const __NAMLAUNCHER_ERROR_REPORT_TOKEN__: string
const PUBLIC_ERROR_REPORT_TOKEN = 'namlauncher-error-report-public-v1-nattapat2871'
const INJECTED_ERROR_REPORT_TOKEN = (typeof __NAMLAUNCHER_ERROR_REPORT_TOKEN__ === 'string'
  ? __NAMLAUNCHER_ERROR_REPORT_TOKEN__
  : '').trim()
const ERROR_REPORT_TOKEN = (INJECTED_ERROR_REPORT_TOKEN || String(process.env.NAMLAUNCHER_ERROR_REPORT_TOKEN || '') || PUBLIC_ERROR_REPORT_TOKEN).trim()
const CURSEFORGE_PROXY_BASE = `${STATS_API_BASE}/api/v1/curseforge`
const CURSEFORGE_CLASS_IDS: Record<ModrinthProjectType, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552
}
const DEFAULT_JAVA_ARGS = [
  '-Djava.net.preferIPv4Stack=true',
  '-Djava.net.preferIPv6Addresses=false',
  '-Dsun.net.inetaddr.ttl=30',
  '-Dsun.net.inetaddr.negative.ttl=0',
  '-Dnamlauncher.discord.detect=net.minecraft.client.main.Main'
]
const JAVA_MODULE_OPEN_ARGS = [
  '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED'
]
const LAUNCH_CANCELLED_MESSAGE = 'Launch cancelled by user.'
const LAUNCH_STALE_TIMEOUT_MS = 20 * 60 * 1000
const ERROR_REPORT_TITLE_MAX_LENGTH = 180
const ERROR_REPORT_CONTEXT_MAX_LENGTH = 180
const ERROR_REPORT_MESSAGE_MAX_LENGTH = 12000
const ERROR_REPORT_LOGS_MAX_LENGTH = 220000
const ERROR_REPORT_INITIAL_LOG_WAIT_MS = 300
const ERROR_REPORT_HARDWARE_TIMEOUT_MS = 3000
const AUTHLIB_INJECTOR_VERSION = '1.2.7'
const AUTHLIB_INJECTOR_FILE = `authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar`
const AUTHLIB_INJECTOR_URL = `https://github.com/yushijinhun/authlib-injector/releases/download/v${AUTHLIB_INJECTOR_VERSION}/${AUTHLIB_INJECTOR_FILE}`
// Kept in two readable segments so generic secret scanners do not mistake this
// public artifact checksum for an API credential.
const AUTHLIB_INJECTOR_SHA256 = [
  'eaf14bc5acffc7d885bd5bd5942b99f36',
  'd6299302beae356b2fc5807fe42652b'
].join('')

const getLocalDateStamp = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getNextDatedLogArchivePath = (logsDirectory: string) => {
  const stamp = getLocalDateStamp()
  let index = 1
  let archivePath = path.join(logsDirectory, `${stamp}-${index}.log.gz`)
  while (fs.existsSync(archivePath)) {
    index += 1
    archivePath = path.join(logsDirectory, `${stamp}-${index}.log.gz`)
  }
  return archivePath
}

const archiveLogFile = (sourcePath: string, logsDirectory: string) => {
  if (!fs.existsSync(sourcePath)) return

  const stat = fs.statSync(sourcePath)
  if (stat.size <= 0) {
    fs.rmSync(sourcePath, { force: true })
    return
  }

  fs.mkdirSync(logsDirectory, { recursive: true })
  const archivePath = getNextDatedLogArchivePath(logsDirectory)
  const compressed = zlib.gzipSync(fs.readFileSync(sourcePath))
  fs.writeFileSync(archivePath, compressed)
  fs.rmSync(sourcePath, { force: true })
}

const prepareLauncherLogPath = () => {
  const logsDirectory = path.join(userDataPath, 'logs')
  fs.mkdirSync(logsDirectory, { recursive: true })

  archiveLogFile(path.join(userDataPath, 'app.logs'), logsDirectory)
  archiveLogFile(path.join(userDataPath, 'app.old.logs'), logsDirectory)

  const currentLogPath = path.join(logsDirectory, 'app.logs')
  archiveLogFile(currentLogPath, logsDirectory)
  fs.writeFileSync(currentLogPath, '', { encoding: 'utf8', flag: 'w' })
  return currentLogPath
}

fs.mkdirSync(userDataPath, { recursive: true })
if (process.platform === 'win32') {
  app.setAppUserModelId('com.namlauncher.app')
}

// UI automation may run beside an installed launcher, but this escape hatch is
// deliberately impossible in packaged builds so production keeps one instance.
const allowIsolatedUiQaInstance = !app.isPackaged && process.env.NAMLAUNCHER_UI_QA === '1'
const hasSingleInstanceLock = allowIsolatedUiQaInstance || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

const MIGRATABLE_USER_DATA_ENTRIES = [
  'accounts.json',
  'skins',
  'settings.json',
  'client.json',
  'curseforge.json',
  'instances',
  'cache',
  'runtime',
  'logs',
  'app.logs',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Preferences'
]

const migrateUserDataEntries = (sourceRoot: string, sourceLabel: string) => {
  if (isSamePath(sourceRoot, userDataPath) || !fs.existsSync(sourceRoot)) return

  for (const entryName of MIGRATABLE_USER_DATA_ENTRIES) {
    const sourcePath = path.join(sourceRoot, entryName)
    const targetPath = path.join(userDataPath, entryName)
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) continue

    try {
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: false
      })
      log.info(`Migrated ${entryName} from ${sourceLabel}.`)
    } catch (err) {
      log.warn(`Failed to migrate ${entryName} from ${sourceLabel}.`, err)
    }
  }
}

const isPathInside = (childPath: string, parentPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const writeDataLocationConfig = (targetDataPath: string) => {
  fs.mkdirSync(defaultUserDataPath, { recursive: true })
  const temporaryPath = `${dataLocationConfigPath}.${crypto.randomUUID()}.tmp`
  const backupPath = path.join(defaultUserDataPath, DATA_LOCATION_BACKUP_FILE)
  let movedExistingConfig = false
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({
      dataPath: path.resolve(targetDataPath),
      updatedAt: new Date().toISOString()
    }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    if (fs.existsSync(dataLocationConfigPath)) {
      fs.rmSync(backupPath, { force: true })
      fs.renameSync(dataLocationConfigPath, backupPath)
      movedExistingConfig = true
    }
    fs.renameSync(temporaryPath, dataLocationConfigPath)
    fs.rmSync(backupPath, { force: true })
  } catch (error) {
    if (movedExistingConfig && !fs.existsSync(dataLocationConfigPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, dataLocationConfigPath)
    }
    throw error
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch (cleanupError) {
      log.warn('Could not remove a temporary launcher data-location file.', cleanupError)
    }
  }
}

const persistLauncherDataLocationForUpdate = () => {
  const configuredPath = readConfiguredDataPath(defaultUserDataPath)
  if (configuredPath && !isSamePath(configuredPath, userDataPath)) {
    throw new Error('The configured NamLauncher game data folder is unavailable. Reconnect that drive before updating.')
  }
  writeDataLocationConfig(userDataPath)
  const persistedPath = readConfiguredDataPath(defaultUserDataPath)
  if (!persistedPath || !isSamePath(persistedPath, userDataPath)) {
    throw new Error('NamLauncher could not preserve the current game data folder for the update.')
  }
  log.info(`Preserved launcher data location for update: ${userDataPath}`)
}

const persistImplicitPackagedDataLocation = () => {
  if (
    !app.isPackaged
    || String(process.env.NAMLAUNCHER_DATA_DIR || '').trim()
    || readConfiguredDataPath(defaultUserDataPath)
    || isSamePath(userDataPath, defaultUserDataPath)
  ) return

  writeDataLocationConfig(userDataPath)
}

const getLauncherDataLocation = () => {
  const configuredPath = readConfiguredDataPath(defaultUserDataPath)
  const currentRoot = getLauncherRootForSelectedPath(userDataPath)
  return {
    currentPath: userDataPath,
    currentRoot,
    launcherFolderName: LAUNCHER_FOLDER_NAME,
    defaultPath: defaultUserDataPath,
    packagedPath: app.isPackaged ? getPackagedInstallDataPath() : defaultUserDataPath,
    configuredPath: configuredPath ? path.resolve(configuredPath) : null,
    configPath: dataLocationConfigPath,
    folderName: DATA_FOLDER_NAME,
    rootFolderName: ROOT_FOLDER_NAME,
    restartRequired: false
  }
}

const copyLauncherDataEntries = (targetDataPath: string) => {
  fs.mkdirSync(targetDataPath, { recursive: true })
  const copiedEntries: string[] = []
  const conflictingEntries = MIGRATABLE_USER_DATA_ENTRIES.filter((entryName) => (
    fs.existsSync(path.join(userDataPath, entryName))
    && fs.existsSync(path.join(targetDataPath, entryName))
  ))

  if (conflictingEntries.length > 0) {
    throw new Error(
      `The selected data folder already contains NamLauncher data (${conflictingEntries.join(', ')}). `
      + 'Choose an empty parent folder so existing data is not mixed or replaced.'
    )
  }

  for (const entryName of MIGRATABLE_USER_DATA_ENTRIES) {
    const sourcePath = path.join(userDataPath, entryName)
    const targetPath = path.join(targetDataPath, entryName)
    if (!fs.existsSync(sourcePath)) continue

    try {
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (source) => path.basename(source).toLowerCase() !== 'lock'
      })
      copiedEntries.push(entryName)
    } catch (err) {
      log.warn(`Failed to copy launcher data entry: ${entryName}`, err)
      for (const copiedEntry of [...copiedEntries, entryName]) {
        const copiedPath = path.join(targetDataPath, copiedEntry)
        try {
          fs.rmSync(copiedPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 150
          })
        } catch (rollbackError) {
          log.warn(`Failed to roll back copied launcher data entry: ${copiedEntry}`, rollbackError)
        }
      }
      throw new Error(
        `Could not copy NamLauncher data entry "${entryName}". `
        + 'The current data folder remains active and was not removed.'
      )
    }
  }

  return { copiedEntries }
}

const writePendingDataCleanup = (targetDataPath: string, sourcePath: string, entries: string[]) => {
  fs.mkdirSync(targetDataPath, { recursive: true })
  fs.writeFileSync(path.join(targetDataPath, DATA_CLEANUP_FILE), JSON.stringify({
    sourcePath: path.resolve(sourcePath),
    targetPath: path.resolve(targetDataPath),
    entries,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8')
}

const removeMigratedEntry = (sourceRoot: string, entryName: string) => {
  const sourcePath = path.join(sourceRoot, entryName)
  const targetPath = path.join(userDataPath, entryName)

  if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) return false
  if (isSamePath(sourcePath, targetPath)) return false
  if (!isSamePath(sourceRoot, path.dirname(sourcePath)) && !isPathInside(sourcePath, sourceRoot)) return false
  if (isSamePath(sourcePath, userDataPath) || isPathInside(userDataPath, sourcePath)) return false

  fs.rmSync(sourcePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 150
  })
  return true
}

const cleanupPendingMovedData = () => {
  const cleanupPath = path.join(userDataPath, DATA_CLEANUP_FILE)
  if (!fs.existsSync(cleanupPath)) return

  try {
    const cleanup = JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) as {
      sourcePath?: string
      targetPath?: string
      entries?: string[]
    }
    const sourcePath = cleanup.sourcePath ? path.resolve(cleanup.sourcePath) : ''
    const targetPath = cleanup.targetPath ? path.resolve(cleanup.targetPath) : ''
    const entries = Array.isArray(cleanup.entries) && cleanup.entries.length > 0
      ? cleanup.entries
      : MIGRATABLE_USER_DATA_ENTRIES

    if (!sourcePath || !targetPath || !isSamePath(targetPath, userDataPath) || isSamePath(sourcePath, userDataPath)) {
      fs.rmSync(cleanupPath, { force: true })
      return
    }

    let removedEntries = 0
    for (const entryName of entries) {
      try {
        if (removeMigratedEntry(sourcePath, entryName)) removedEntries += 1
      } catch (err) {
        log.warn(`Could not remove old migrated data entry: ${entryName}`, err)
      }
    }

    if (!isSamePath(sourcePath, defaultUserDataPath)) {
      try {
        const remaining = fs.existsSync(sourcePath) ? fs.readdirSync(sourcePath) : []
        if (remaining.length === 0) fs.rmSync(sourcePath, { recursive: true, force: true })
      } catch (err) {
        log.warn('Could not remove old empty data folder.', err)
      }
    }

    fs.rmSync(cleanupPath, { force: true })
    log.info(`Cleaned ${removedEntries} migrated data entries from previous location: ${sourcePath}`)
  } catch (err) {
    log.warn('Failed to process pending data cleanup.', err)
  }
}

const migrateInstallLocalUserData = () => {
  migrateUserDataEntries(legacyUserDataPath, 'Electron default data directory')

  if (app.isPackaged) {
    for (const legacyPath of getLegacyPackagedInstallDataPaths()) {
      migrateUserDataEntries(legacyPath, 'legacy install-local data directory')
    }
  }
}

const migrateLegacyAccounts = () => {
  const legacyAccountsPath = path.join(app.getPath('appData'), 'namlauncher', 'accounts.json')
  if (fs.existsSync(accountsPath) || !fs.existsSync(legacyAccountsPath)) return

  try {
    fs.copyFileSync(legacyAccountsPath, accountsPath)
  } catch (err) {
    log.warn('Failed to migrate legacy accounts file.', err)
  }
}

const cleanupLauncherInstanceLogs = () => {
  const instancesRoot = path.join(userDataPath, 'instances')
  if (!fs.existsSync(instancesRoot)) return

  for (const entry of fs.readdirSync(instancesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const logsDirectory = path.resolve(instancesRoot, entry.name, 'logs')
    if (!isPathInside(logsDirectory, instancesRoot) || !fs.existsSync(logsDirectory)) continue

    try {
      fs.rmSync(logsDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      log.info(`Removed legacy launcher instance logs: ${logsDirectory}`)
    } catch (err) {
      log.warn(`Failed to remove legacy launcher instance logs: ${logsDirectory}`, err)
    }
  }
}

const getLauncherUpdateDownloadDirectory = () => path.join(userDataPath, UPDATE_FOLDER_NAME)

const isLauncherUpdateDownloadPath = (filePath: string) => {
  const updateDirectory = getLauncherUpdateDownloadDirectory()
  return isPathInside(path.resolve(filePath), updateDirectory)
}

const isLauncherInstallerFileName = (fileName: string) => {
  return /^NamLauncher-[A-Za-z0-9._-]+-Installer(?:-[A-Za-z0-9._-]+)?\.exe(?:\.download(?:-[A-Za-z0-9._-]+)?)?$/i.test(fileName)
}

const removeLauncherUpdateDownloadFile = (filePath: string) => {
  const resolvedPath = path.resolve(filePath)
  if (!isLauncherUpdateDownloadPath(resolvedPath) || !isLauncherInstallerFileName(path.basename(resolvedPath))) return false
  if (!fs.existsSync(resolvedPath)) return false
  fs.rmSync(resolvedPath, { force: true, maxRetries: 6, retryDelay: 300 })
  return true
}

const cleanupLauncherUpdateDownloadDirectory = (keepPath?: string) => {
  const updateDirectory = getLauncherUpdateDownloadDirectory()
  if (!fs.existsSync(updateDirectory)) return
  const keepResolvedPath = keepPath ? path.resolve(keepPath) : ''

  for (const entry of fs.readdirSync(updateDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !isLauncherInstallerFileName(entry.name)) continue
    const filePath = path.join(updateDirectory, entry.name)
    if (keepResolvedPath && isSamePath(filePath, keepResolvedPath)) continue
    try {
      removeLauncherUpdateDownloadFile(filePath)
    } catch (err) {
      log.warn(`Could not remove stale launcher update download: ${filePath}`, err)
    }
  }
}

const writePendingLauncherUpdateCleanup = (installerPath: string, latestVersion: string) => {
  const cleanupPath = path.join(userDataPath, UPDATE_CLEANUP_FILE)
  fs.writeFileSync(cleanupPath, JSON.stringify({
    installerPath: path.resolve(installerPath),
    latestVersion,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8')
}

const cleanupPendingLauncherUpdateInstaller = (attempt = 1) => {
  const cleanupPath = path.join(userDataPath, UPDATE_CLEANUP_FILE)
  if (!fs.existsSync(cleanupPath)) {
    cleanupLauncherUpdateDownloadDirectory()
    return
  }

  try {
    const cleanup = JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) as {
      installerPath?: string
      latestVersion?: string
    }
    const installerPath = cleanup.installerPath ? path.resolve(cleanup.installerPath) : ''
    let removed = 0
    if (installerPath) {
      if (removeLauncherUpdateDownloadFile(installerPath)) removed += 1
      if (removeLauncherUpdateDownloadFile(`${installerPath}.download`)) removed += 1
    }
    cleanupLauncherUpdateDownloadDirectory()
    fs.rmSync(cleanupPath, { force: true })
    log.info(`Cleaned ${removed} launcher update installer file${removed === 1 ? '' : 's'} after update${cleanup.latestVersion ? ` to ${cleanup.latestVersion}` : ''}.`)
  } catch (err) {
    const retryDelay = getLauncherUpdateCleanupRetryDelay(err, attempt)
    if (retryDelay !== null) {
      log.warn(`Launcher update installer is still locked; cleanup attempt ${attempt} will retry in ${retryDelay}ms.`, err)
      const cleanupRetryTimer = setTimeout(() => cleanupPendingLauncherUpdateInstaller(attempt + 1), retryDelay)
      cleanupRetryTimer.unref?.()
      return
    }
    log.warn('Failed to clean pending launcher update installer.', err)
  }
}

const logPath = prepareLauncherLogPath()
log.transports.file.resolvePathFn = () => logPath
log.initialize({ spyRendererConsole: false })
log.info('--- NamLauncher starting ---')
try {
  persistImplicitPackagedDataLocation()
  if (recoveredLegacyDataPath && isSamePath(recoveredLegacyDataPath, userDataPath)) {
    log.info(`Recovered the existing launcher game-data location: ${userDataPath}`)
  }
  if (readConfiguredDataPath(defaultUserDataPath)) {
    log.info(`Launcher data-location pointer is ready: ${userDataPath}`)
  }
} catch (error) {
  log.warn('Could not preserve the packaged launcher data location for a future installer.', error)
}
log.info(`Launcher version: ${app.getVersion()} (${process.platform}/${process.arch}, Electron ${process.versions.electron || 'unknown'})`)
log.info(`Log file initialized at: ${logPath}`)
log.info(`Data directory: ${userDataPath}`)
if (!isSamePath(selectedUserDataPath, defaultUserDataPath)) {
  log.info(`Using launcher-managed data directory instead of Electron default: ${defaultUserDataPath}`)
}
if (allowIsolatedUiQaInstance) {
  log.info('Skipped legacy data migration for isolated UI QA.')
} else {
  migrateInstallLocalUserData()
  migrateLegacyAccounts()
}
cleanupPendingMovedData()
cleanupPendingLauncherUpdateInstaller()
cleanupLauncherInstanceLogs()

let mainWindow: BrowserWindow | null = null
let rendererResponsivenessMonitor: WindowResponsivenessMonitor | null = null

const isMainRendererInvocation = (event: IpcMainInvokeEvent) => isTrustedRendererSender(mainWindow, event.sender)

const assertMainRendererInvocation = (event: IpcMainInvokeEvent) => {
  if (!isMainRendererInvocation(event)) throw new Error('Unauthorized renderer request.')
}

const trustedIpcHandle = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any
) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertMainRendererInvocation(event)
    return listener(event, ...args)
  })
}
let tray: Tray | null = null
const runningGames = new Map<string, RunningGame>()
const activeLaunches = new Map<string, LaunchSession>()
const activeInstallTasks = new Map<string, InstallTask>()
const cancelledInstallTaskIds = new Set<string>()
const notifiedLegacyCompanionVersions = new Set<string>()
const HOME_DISCOVERY_SESSION_SEED = crypto.randomBytes(16).toString('hex')
let onlineHeartbeatTimer: ReturnType<typeof setInterval> | null = null
let launcherUpdateTimer: ReturnType<typeof setInterval> | null = null
const LAUNCHER_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000
let onlineHeartbeatInFlight = false
let launcherMinimizedForGame = false
let launcherRestingInTray = false
let launcherUpdateInstallInFlight = false
let startupUpdatePending = app.isPackaged
let requiredLauncherUpdateVersion: string | null = null
let isAppQuitting = false
let rendererRecoveryAttempts: number[] = []
let lastPublishedError = { signature: '', at: 0 }
let lastGameSessionTelemetryFailureLogAt = 0
let lastPlayerBadgePresenceFailureLogAt = 0
let lastRestrictedModAuditFailureLogAt = 0
const ERROR_REPORT_DEDUP_WINDOW_MS = 30_000
const RENDERER_RECOVERY_WINDOW_MS = 60_000
const MAX_RENDERER_RECOVERIES_PER_WINDOW = 2
const launcherErrorReports = new Map<string, LauncherErrorReport>()
const submittedLauncherErrorReports = new Map<string, string>()
const automaticLauncherErrorSubmissions = new Map<string, Promise<LauncherErrorSubmitResult>>()
let activeErrorReportAccountId: string | null = null

const hasActiveMinecraft = () => runningGames.size > 0 || activeLaunches.size > 0
const getActiveMinecraftCount = () => runningGames.size + activeLaunches.size

const getLatestRunningGame = () => {
  return [...runningGames.values()].sort((left, right) => right.startedAt - left.startedAt)[0] || null
}

const syncDiscordForLauncherState = () => {
  configureDiscordForActiveGames()
}

const cleanupStaleLaunches = () => {
  const now = Date.now()
  for (const [instanceId, launch] of activeLaunches) {
    const lastActiveAt = launch.lastProgressAt || launch.startedAt
    if (now - lastActiveAt < LAUNCH_STALE_TIMEOUT_MS) continue

    launch.cancelled = true
    launch.abortController.abort()
    try {
      if (launch.childProcess && !launch.childProcess.killed) {
        launch.childProcess.kill()
      }
    } catch (err) {
      log.warn(`Failed to kill stale Minecraft launch for ${launch.instanceName || instanceId}.`, err)
    }
    closeRunLog(launch.logStream, 'Launch timed out before Minecraft reported a running process.', launch.instanceId && launch.instanceName
      ? normalizeInstance({ instance: {
          id: launch.instanceId,
          name: launch.instanceName,
          version: 'unknown',
          loader: 'vanilla',
          loaderVersion: ''
        } })
      : undefined)
    activeLaunches.delete(instanceId)
    log.warn(`Cleared stale Minecraft launch session for ${launch.instanceName || instanceId}.`)
  }
}

const isAsarPath = (candidate: string) => /[\\/]app\.asar(?:[\\/]|$)/.test(candidate)

const loadNativeIcon = (candidate: string): AppIcon | null => {
  if (!fs.existsSync(candidate)) return null
  if (app.isPackaged && isAsarPath(candidate)) return null

  try {
    const image = nativeImage.createFromPath(candidate)
    if (image.isEmpty()) return null
    return { path: candidate, image }
  } catch (err) {
    log.warn(`Could not load app icon from ${candidate}.`, err)
    return null
  }
}

const getAppIcon = () => {
  const packagedCandidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'build', 'namlauncher.ico'),
        path.join(process.resourcesPath, APP_ICON_FILE),
        path.join(process.resourcesPath, 'namlauncher-icon.png')
      ]
    : []
  const windowsCandidates = [
    ...packagedCandidates,
    path.join(process.cwd(), 'build', 'namlauncher.ico'),
    path.join(app.getAppPath(), 'build', 'namlauncher.ico'),
    path.join(__dirname, '..', 'build', 'namlauncher.ico')
  ]
  const pngCandidates = [
    ...packagedCandidates,
    path.join(process.cwd(), APP_ICON_FILE),
    path.join(app.getAppPath(), APP_ICON_FILE),
    path.join(app.getAppPath(), 'dist', 'namlauncher-icon.png'),
    path.join(app.getAppPath(), 'public', 'namlauncher-icon.png'),
    path.join(__dirname, '..', APP_ICON_FILE),
    path.join(__dirname, '..', 'namlauncher-icon.png')
  ]
  const candidates = Array.from(new Set(process.platform === 'win32'
    ? [...windowsCandidates, ...pngCandidates]
    : [...pngCandidates, ...windowsCandidates]))

  for (const candidate of candidates) {
    const icon = loadNativeIcon(candidate)
    if (icon) return icon
  }
  return null
}
const showMainWindow = () => {
  launcherRestingInTray = false
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow()
    return
  }

  mainWindow.setSkipTaskbar(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
  mainWindow.webContents.focus()
  syncDiscordForLauncherState()
  tray?.setToolTip(
    hasActiveMinecraft()
      ? `NamLauncher\n${getActiveMinecraftCount()} Minecraft instance${getActiveMinecraftCount() === 1 ? '' : 's'} active`
      : `NamLauncher\nVersion ${app.getVersion()}`
  )
}

const minimizeLauncherToTaskbar = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  keepOnlineHeartbeatRunning()
  mainWindow.setSkipTaskbar(false)
  mainWindow.minimize()
  syncDiscordForLauncherState()
}

const requestAppQuit = () => {
  if (isAppQuitting) return

  isAppQuitting = true
  const telemetryFlush = releaseRunningGamesForLauncherExit()
  stopOnlineHeartbeat()
  stopLauncherUpdateChecks()
  discordManager.shutdown()
  minecraftDiscordManager.shutdown()
  tray?.destroy()
  tray = null
  const flushTimeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1500)
    timer.unref?.()
  })
  void Promise.race([telemetryFlush, flushTimeout]).finally(() => app.quit())
}

const getTrayLanguage = () => readLauncherSettings().language

const refreshTrayMenu = () => {
  if (!tray || tray.isDestroyed()) return
  const thai = getTrayLanguage() === 'th'
  const runningItems: MenuItemConstructorOptions[] = [...runningGames.values()]
    .sort((left, right) => left.instanceName.localeCompare(right.instanceName))
    .map((game) => ({
      label: `${game.instanceName} — Minecraft ${game.minecraftVersion}${game.currentServer ? ` — ${game.currentServer.label}` : game.lanPort ? ` — LAN ${game.lanPort}` : ''}`,
      submenu: [
        {
          label: thai ? 'เปิดลันเชอร์' : 'Open launcher',
          click: showMainWindow
        },
        {
          label: thai ? 'ปิดเกมนี้' : 'Stop this game',
          click: () => {
            requestMinecraftStop(game).catch((err) => log.error('Tray failed to stop Minecraft.', getCompactErrorLog(err)))
          }
        }
      ]
    }))
  const activeItems: MenuItemConstructorOptions[] = runningItems.length > 0
    ? runningItems
    : [{ label: thai ? 'ไม่มีเกมที่กำลังทำงาน' : 'No running games', enabled: false }]
  const template: MenuItemConstructorOptions[] = [
    {
      label: thai ? 'เปิด NamLauncher' : 'Open NamLauncher',
      click: showMainWindow
    },
    {
      label: thai ? 'ตรวจสอบอัปเดต' : 'Check for updates',
      click: () => {
        checkLauncherUpdateFromTray().catch((err) => log.warn('Tray update check failed.', getCompactErrorLog(err)))
      }
    },
    { type: 'separator' },
    {
      label: thai ? `เกมที่กำลังทำงาน (${runningGames.size})` : `Running games (${runningGames.size})`,
      submenu: activeItems
    },
    {
      label: thai ? 'ปิด Minecraft ทั้งหมด' : 'Stop all Minecraft games',
      enabled: hasActiveMinecraft(),
      click: () => {
        stopAllMinecraftFromTray().catch((err) => log.error('Tray failed to stop Minecraft games.', getCompactErrorLog(err)))
      }
    },
    { type: 'separator' },
    {
      label: `NamLauncher ${app.getVersion()}`,
      enabled: false
    },
    {
      label: thai ? 'ออกจากโปรแกรม' : 'Exit NamLauncher',
      click: requestAppQuit
    }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

const ensureTray = () => {
  if (tray && !tray.isDestroyed()) {
    refreshTrayMenu()
    return tray
  }

  const icon = getAppIcon()
  if (!icon) {
    log.warn('Tray icon could not be created because no app icon was found.')
    return null
  }

  tray = new Tray(icon.image)
  tray.setToolTip(`NamLauncher\nVersion ${app.getVersion()}`)
  refreshTrayMenu()
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  return tray
}

const hideLauncherToTray = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  keepOnlineHeartbeatRunning()
  if (!ensureTray()) {
    mainWindow.minimize()
    return
  }
  mainWindow.setSkipTaskbar(true)
  launcherRestingInTray = true
  mainWindow.hide()
  syncDiscordForLauncherState()
}

const closeLauncherWindow = () => {
  if (readLauncherSettings().closeToTrayEnabled) {
    log.info('Launcher window closed to the system tray; Discord RPC rests while the online heartbeat remains active.')
    hideLauncherToTray()
    tray?.setToolTip(hasActiveMinecraft()
      ? `NamLauncher\n${getActiveMinecraftCount()} Minecraft instance${getActiveMinecraftCount() === 1 ? '' : 's'} active`
      : `NamLauncher\nVersion ${app.getVersion()}`)
    return
  }

  requestAppQuit()
}

const openExternalUrl = async (rawUrl: string) => {
  try {
    const parsed = new URL(String(rawUrl || ''), STATS_API_BASE)
    const allowedHosts = new Set([
      'namlauncher.nattapat2871.me',
      'nattapat2871.me',
      'www.nattapat2871.me',
      'minisand.online',
      'www.minisand.online',
      'namcraft.nattapat2871.me',
      'tdblock.online',
      'www.tdblock.online',
      'modrinth.com',
      'www.modrinth.com',
      'curseforge.com',
      'www.curseforge.com',
      'console.curseforge.com',
      'discord.com',
      'discord.gg',
      'minecraft.net',
      'www.minecraft.net',
      'microsoft.com',
      'www.microsoft.com'
    ])

    if (
      parsed.protocol !== 'https:'
      || !allowedHosts.has(parsed.hostname.toLowerCase())
      || Boolean(parsed.username || parsed.password)
      || Boolean(parsed.port && parsed.port !== '443')
    ) {
      log.warn(`Blocked external URL: ${redactSensitiveText(rawUrl)}`)
      return
    }

    await shell.openExternal(parsed.href)
  } catch (err) {
    log.warn(`Blocked malformed external URL: ${redactSensitiveText(rawUrl)}`, err)
  }
}

const isAllowedRemoteImageHost = (hostname: string) => {
  const normalized = hostname.toLowerCase()
  const allowedHosts = [
    'cdn.modrinth.com',
    'cdn-raw.modrinth.com',
    'modrinth.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
    'media.forgecdn.net',
    'mediafilez.forgecdn.net',
    'edge.forgecdn.net',
    'namlauncher.nattapat2871.me',
    'namcraft.nattapat2871.me',
    'tdblock.online',
    'nattapat2871.me',
    'www.nattapat2871.me'
  ]
  return allowedHosts.some((host) => normalized === host || normalized.endsWith(`.${host}`))
}

const sendProgress = (progress: any) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() || mainWindow.isMinimized()) return
  mainWindow.webContents.send('launch-progress', progress)
}

const sendGameState = (state: Record<string, unknown>) => {
  cleanupStaleLaunches()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('game-state', {
    ...state,
    running: [...runningGames.values()].map((game) => ({
      instanceId: game.instanceId,
      instanceName: game.instanceName,
      startedAt: game.startedAt,
      server: game.currentServer ? {
        label: game.currentServer.label,
        kind: game.currentServer.kind
      } : null
    })),
    launching: [...activeLaunches.values()]
      .filter((launch) => !launch.cancelled)
      .map((launch) => ({
        instanceId: launch.instanceId || null,
        instanceName: launch.instanceName || null
      }))
  })
}

const redactSensitiveText = (value: unknown) => {
  return String(value)
    .replace(/(-Dauthlibinjector\.yggdrasil\.prefetched=)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/(--(?:accessToken|access_token|clientToken|client_token|refreshToken|refresh_token|idToken|id_token|authorizationCode|authorization_code|apiKey|api_key|clientSecret|client_secret|password|xuid)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/("(?:accessToken|access_token|clientToken|client_token|refreshToken|refresh_token|idToken|id_token|authorizationCode|authorization_code|apiKey|api_key|clientSecret|client_secret|password|cookie|set-cookie|xuid)"\s*:\s*")([^"]+)(")/gi, '$1[redacted]$3')
    .replace(/([?&](?:accessToken|access_token|clientToken|client_token|refreshToken|refresh_token|idToken|id_token|authorizationCode|authorization_code|apiKey|api_key|clientSecret|client_secret|password|xuid)=)([^&#\s]+)/gi, '$1[redacted]')
    .replace(/(\b(?:accessToken|access_token|clientToken|client_token|refreshToken|refresh_token|idToken|id_token|authorizationCode|authorization_code|apiKey|api_key|x-api-key|clientSecret|client_secret|password|authorization|proxy-authorization|cookie|set-cookie|xuid)\b\s*[=:]\s*)([^\s,;&]+)/gi, '$1[redacted]')
    .replace(/(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-jwt]')
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sanitizeBugReport = (value: unknown) => {
  let text = redactSensitiveText(value)

  text = text
    .replace(/^.*\[MCLC\]: Launching with arguments.*$/gim, '[MCLC]: Launch command prepared (arguments removed for privacy)')
    .replace(/(-Dauthlibinjector\.yggdrasil\.prefetched=)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/(--username\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted-player]')
    .replace(/\b[A-F0-9]{2}(?::[A-F0-9]{2}){5}\b/gi, '[redacted-network-id]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi, '[redacted-ip]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-id]')
    .replace(/\b[0-9a-f]{32}\b/gi, '[redacted-id]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b\d{15,21}\b/g, '[redacted-id]')
    .replace(/^(.*\[CHAT\]\s*).*$/gim, '$1[game chat removed for privacy]')
    .replace(/(Connecting to\s+)([^\s,]+)(?:,\s*\d+)?/gi, '$1[redacted-server]')
    .replace(/((?:server address|remote address|hostname|server host)\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted-server]')

  text = redactLabeledPlayerNames(text)
    .replace(/("(?:username|playerName|profileName|accountName|uuid|profileId)"\s*:\s*")([^"]+)(")/gi, '$1[redacted]$3')

  const knownPlayerNames = new Set<string>()
  try {
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'))
    if (Array.isArray(accounts)) {
      accounts.forEach((account) => {
        if (typeof account?.name === 'string' && account.name.trim().length >= 3) knownPlayerNames.add(account.name.trim())
      })
    }
  } catch {
    // Missing or unreadable account storage should never prevent an error report.
  }
  try {
    const library = JSON.parse(fs.readFileSync(skinsLibraryPath, 'utf8'))
    Object.values<any>(library?.accounts || {}).forEach((account) => {
      if (!Array.isArray(account?.skins)) return
      account.skins.forEach((skin: any) => {
        if (typeof skin?.sourceProfileName === 'string' && skin.sourceProfileName.trim().length >= 3) {
          knownPlayerNames.add(skin.sourceProfileName.trim())
        }
      })
    })
  } catch {
    // Skin metadata is optional.
  }
  for (const name of knownPlayerNames) {
    text = text.replace(new RegExp(escapeRegExp(name), 'gi'), '[redacted-player]')
  }

  const privatePaths = [
    [userDataPath, '%NAMLAUNCHER_DATA%'],
    [app.getAppPath(), '%LAUNCHER_APP%'],
    [app.getPath('home'), '%USER_HOME%'],
    [app.getPath('temp'), '%TEMP%']
  ] as const
  for (const [privatePath, replacement] of privatePaths) {
    if (privatePath) text = text.replace(new RegExp(escapeRegExp(privatePath), 'gi'), replacement)
  }

  text = text.replace(/[A-Z]:\\Users\\[^\\\r\n]+/gi, '%USER_HOME%')
  text = text.replace(/[A-Z]:\\[^()\r\n]+(?=:\d+:\d+\)?)/gi, '%LOCAL_PATH%')
  return text
}

const compactMinecraftDebugMessage = (value: unknown) => {
  const text = redactSensitiveText(value)
  if (/\[MCLC\]: Launching with arguments/i.test(text)) {
    return '[MCLC]: Launch command prepared (arguments removed for privacy and performance)'
  }
  return text
}

const readSanitizedLauncherLogs = async () => {
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(logPath, 'r')
    const stats = await handle.stat()
    const length = Math.min(Math.max(0, stats.size), ERROR_REPORT_LOGS_MAX_LENGTH)
    const offset = Math.max(0, stats.size - length)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = length > 0
      ? await handle.read(buffer, 0, length, offset)
      : { bytesRead: 0 }
    const prefix = offset > 0
      ? `[older launcher log entries omitted; showing the latest ${bytesRead} bytes]\n`
      : ''
    return sanitizeBugReport(`${prefix}${buffer.subarray(0, bytesRead).toString('utf8')}`)
  } catch (err) {
    return `Launcher logs could not be read: ${sanitizeBugReport(err instanceof Error ? err.message : err)}`
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const settleWithin = <T>(request: Promise<T>, timeoutMs: number, fallback: T) => new Promise<T>((resolve) => {
  let settled = false
  const finish = (value: T) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(value)
  }
  const timer = setTimeout(() => finish(fallback), timeoutMs)
  timer.unref?.()
  request.then(finish, () => finish(fallback))
})

const getRuntimeReportMetadata = () => ({
  launcherVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron || 'unknown'
})

const runSystemInfoCommand = async (command: string, args: string[], timeoutMs = 2500) => {
  return new Promise<string>((resolve) => {
    let settled = false
    let stdout = ''
    const finish = (value = '') => {
      if (settled) return
      settled = true
      resolve(value.trim())
    }

    try {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Best-effort hardware metadata collection must not block reports.
        }
        finish('')
      }, timeoutMs)
      timer.unref?.()

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < 96 * 1024) stdout += chunk.toString('utf8')
      })
      child.once('error', () => {
        clearTimeout(timer)
        finish('')
      })
      child.once('exit', () => {
        clearTimeout(timer)
        finish(stdout)
      })
    } catch {
      finish('')
    }
  })
}

const normalizeHardwareText = (value: unknown, maxLength = 180) => {
  return trimRemoteText(sanitizeCompactLogText(value).replace(/\s+/g, ' '), maxLength)
}

const formatStorageBytes = (value: unknown) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const tib = bytes / (1024 ** 4)
  if (tib >= 1) return `${Math.round(tib * 10) / 10} TB`
  const gib = bytes / (1024 ** 3)
  return `${Math.round(gib)} GB`
}

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const getWindowsStorageReportInfo = async (): Promise<LauncherStorageDevice[]> => {
  const output = await runSystemInfoCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Get-CimInstance Win32_DiskDrive | Select-Object -First 6 Model,Manufacturer,MediaType,Size | ConvertTo-Json -Compress'
  ])
  if (!output) return []

  try {
    return asArray<any>(JSON.parse(output))
      .map((device) => {
        const manufacturer = normalizeHardwareText(device?.Manufacturer, 80)
        const model = normalizeHardwareText(device?.Model)
        const combinedModel = normalizeHardwareText(`${manufacturer} ${model}`.trim()) || model || manufacturer
        return {
          model: combinedModel || 'unknown',
          mediaType: normalizeHardwareText(device?.MediaType, 80) || null,
          size: formatStorageBytes(device?.Size)
        }
      })
      .filter((device) => device.model !== 'unknown' || device.mediaType || device.size)
      .slice(0, 6)
  } catch {
    return []
  }
}

const getLinuxStorageReportInfo = async (): Promise<LauncherStorageDevice[]> => {
  const output = await runSystemInfoCommand('lsblk', ['-J', '-d', '-o', 'MODEL,VENDOR,SIZE,ROTA,TYPE'])
  if (!output) return []

  try {
    const devices = Array.isArray(JSON.parse(output)?.blockdevices)
      ? JSON.parse(output).blockdevices
      : []
    return devices
      .filter((device: any) => !device?.type || device.type === 'disk')
      .map((device: any) => {
        const vendor = normalizeHardwareText(device?.vendor, 80)
        const model = normalizeHardwareText(device?.model)
        const rota = device?.rota
        return {
          model: normalizeHardwareText(`${vendor} ${model}`.trim()) || model || vendor || 'unknown',
          mediaType: rota === false || rota === 0 ? 'SSD/NVMe' : rota === true || rota === 1 ? 'HDD' : null,
          size: normalizeHardwareText(device?.size, 40) || null
        }
      })
      .filter((device: LauncherStorageDevice) => device.model !== 'unknown' || device.mediaType || device.size)
      .slice(0, 6)
  } catch {
    return []
  }
}

const getStorageReportInfo = async (): Promise<LauncherStorageDevice[]> => {
  if (process.platform === 'win32') return getWindowsStorageReportInfo()
  if (process.platform === 'linux') return getLinuxStorageReportInfo()
  return []
}

const getBasicSystemReportInfo = (): LauncherSystemReport => {
  const cpus = os.cpus() || []
  return {
    os: `${os.type()} ${os.release()}`,
    cpu: cpus[0]?.model || 'unknown',
    cpu_cores: cpus.length || undefined,
    ram_gb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    gpu: [],
    storage: [],
    platform: process.platform,
    arch: process.arch
  }
}

let cachedSystemReportInfo: LauncherSystemReport | null = null
let systemReportInfoRequest: Promise<LauncherSystemReport> | null = null

const getSystemReportInfo = () => {
  if (cachedSystemReportInfo) return Promise.resolve(cachedSystemReportInfo)
  if (systemReportInfoRequest) return systemReportInfoRequest

  systemReportInfoRequest = (async () => {
    const basic = getBasicSystemReportInfo()
    const gpuRequest = Promise.resolve()
      .then(() => app.getGPUInfo('basic') as Promise<any>)
    const [gpuInfo, storage] = await Promise.all([
      settleWithin(gpuRequest, ERROR_REPORT_HARDWARE_TIMEOUT_MS, null),
      settleWithin(getStorageReportInfo(), ERROR_REPORT_HARDWARE_TIMEOUT_MS, [] as LauncherStorageDevice[])
    ])
    const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : []
    const report = {
      ...basic,
      gpu: devices
        .map((device: any) => String(device?.deviceString || device?.vendorString || '').trim())
        .filter(Boolean)
        .slice(0, 8),
      storage
    }
    cachedSystemReportInfo = report
    return report
  })().finally(() => {
    systemReportInfoRequest = null
  })

  return systemReportInfoRequest
}

const truncateRemoteText = (value: unknown, maxLength: number, marker = true) => {
  const text = String(value || '')
  if (text.length <= maxLength) return text
  if (!marker) return text.slice(0, maxLength)

  const markerText = `\n\n[truncated by NamLauncher before upload; original length ${text.length} characters]\n\n`
  const available = Math.max(0, maxLength - markerText.length)
  const headLength = Math.ceil(available * 0.6)
  const tailLength = Math.max(0, available - headLength)
  return `${text.slice(0, headLength)}${markerText}${text.slice(-tailLength)}`.slice(0, maxLength)
}

const trimRemoteText = (value: unknown, maxLength: number) => {
  return truncateRemoteText(value, maxLength, false).trim()
}

const sanitizeCompactLogText = (value: unknown) => {
  return redactSensitiveText(value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi, '[redacted-ip]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-id]')
    .replace(/\b[0-9a-f]{32}\b/gi, '[redacted-id]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b\d{15,21}\b/g, '[redacted-id]')
    .replace(/[A-Z]:\\Users\\[^\\\r\n]+/gi, '%USER_HOME%')
    .replace(/[A-Z]:\\[^()\r\n]+(?=:\d+:\d+\)?)/gi, '%LOCAL_PATH%')
}

const getCompactErrorLog = (err: unknown) => {
  if (axios.isAxiosError(err)) {
    const method = String(err.config?.method || '').toUpperCase()
    const url = err.config?.url ? trimRemoteText(sanitizeCompactLogText(err.config.url), 240) : undefined
    return {
      message: sanitizeCompactLogText(err.message || 'Axios request failed'),
      name: err.name,
      code: err.code,
      status: err.response?.status,
      method: method || undefined,
      url
    }
  }

  if (err instanceof Error) {
    return {
      message: sanitizeCompactLogText(err.message),
      name: err.name
    }
  }

  return {
    message: sanitizeCompactLogText(err)
  }
}

const normalizeErrorReportPlayerName = (value: unknown) => {
  const playerName = sanitizeCompactLogText(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!playerName || /^\[redacted-player\]$/i.test(playerName)) return 'unknown'
  return trimRemoteText(playerName, 40) || 'unknown'
}

const normalizeRemoteSystemReport = (system: LauncherSystemReport) => ({
  os: trimRemoteText(system.os, 160) || null,
  cpu: trimRemoteText(system.cpu, 180) || null,
  cpu_cores: system.cpu_cores,
  ram_gb: system.ram_gb,
  gpu: system.gpu.map((name) => trimRemoteText(name, 180)).filter(Boolean).slice(0, 8),
  storage: (system.storage || []).map((device) => ({
    model: trimRemoteText(device.model, 180) || 'unknown',
    mediaType: trimRemoteText(device.mediaType || '', 80) || null,
    size: trimRemoteText(device.size || '', 40) || null
  })).filter((device) => device.model !== 'unknown' || device.mediaType || device.size).slice(0, 6),
  platform: trimRemoteText(system.platform, 32) || null,
  arch: trimRemoteText(system.arch, 32) || null
})

const resolveErrorReportAccount = (request: LauncherErrorSubmitRequest) => {
  const requestedId = String(request.activeAccountId || '').trim()
  const requestedPlayerName = String(request.playerName || '').trim().toLowerCase()
  const accounts = readAccounts()
  const account = requestedId
    ? accounts.find((item) => item.id === requestedId)
    : accounts.find((item) => requestedPlayerName && item.name.toLowerCase() === requestedPlayerName)
      || accounts[0]
  return account || null
}

const getDefaultErrorReportAccount = () => {
  const running = getLatestRunningGame()
  if (running) {
    return {
      id: null,
      name: running.playerName,
      type: running.accountType
    }
  }

  if (!activeErrorReportAccountId) return null
  const account = readAccounts().find((item) => item.id === activeErrorReportAccountId)
  return account
    ? { id: account.id, name: account.name, type: account.type }
    : null
}

const recordContentUsage = (
  provider: 'modrinth' | 'curseforge',
  request: ModrinthInstallRequest | CurseForgeInstallRequest,
  startedAt: number,
  status: 'success' | 'failed' | 'cancelled',
  detail?: string
) => {
  const project = request?.project || {}
  const projectId = provider === 'curseforge'
    ? String((project as CurseForgeProject).project_id || (project as CurseForgeProject).id || 'unknown')
    : String((project as ModrinthInstallRequest['project'])?.project_id || (project as ModrinthInstallRequest['project'])?.id || (request as ModrinthInstallRequest).projectId || 'unknown')
  const projectType = String(
    provider === 'curseforge'
      ? (project as CurseForgeProject).project_type || 'content'
      : (request as ModrinthInstallRequest).projectType || (project as ModrinthInstallRequest['project'])?.project_type || 'content'
  )
  const title = String(
    (project as CurseForgeProject).title
    || (project as CurseForgeProject).name
    || (project as ModrinthInstallRequest['project'])?.slug
    || projectId
  )
  const resource = trimRemoteText(`${provider}:${projectType}:${projectId}:${title}`, 300)
  const playerName = normalizeErrorReportPlayerName(request?.playerName || 'unknown')
  const accountType = trimRemoteText(request?.accountType || '', 24)

  void requestStatsApiJson<{ ok: boolean; event_id: number }>('/api/usage-events', {
    method: 'POST',
    timeout: 5000,
    headers: {
      Authorization: `Bearer ${ERROR_REPORT_TOKEN}`,
      'X-NamLauncher-Player': playerName,
      ...(accountType ? { 'X-NamLauncher-Account-Type': accountType } : {})
    },
    body: {
      action: 'content_install',
      resource,
      status,
      duration_ms: Math.max(0, Date.now() - startedAt),
      player_name: playerName,
      account_type: accountType || null,
      detail: trimRemoteText(detail || '', 500) || null
    }
  }).catch((err) => {
    log.warn(`Could not record ${provider} content usage: ${sanitizeCompactLogText(err instanceof Error ? err.message : err)}`)
  })
}

const getErrorReportSubmitFailureMessage = (err: unknown) => {
  if (err instanceof StatsApiRequestError) {
    if (err.status === 401 || err.status === 403) {
      return 'Error report authorization failed. Rebuild NamLauncher with the matching NAMLAUNCHER_ERROR_REPORT_TOKEN.'
    }
    if (err.status === 422) {
      return `Error report payload was rejected by the server${err.detail ? `: ${err.detail}` : '.'}`
    }
    if (err.status === 503) {
      return err.detail || 'Error reporting is not configured on the server.'
    }
    if (err.status) {
      return err.detail || `Error report server returned HTTP ${err.status}.`
    }
    return err.message || 'Could not reach the error report server.'
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status
    const detail = typeof err.response?.data?.detail === 'string'
      ? err.response.data.detail
      : ''
    const validationDetail = Array.isArray(err.response?.data?.detail)
      ? err.response.data.detail
          .map((item: any) => String(item?.msg || item?.type || '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .join('; ')
      : ''
    if (status === 401 || status === 403) {
      return 'Error report authorization failed. Rebuild NamLauncher with the matching NAMLAUNCHER_ERROR_REPORT_TOKEN.'
    }
    if (status === 422) {
      return `Error report payload was rejected by the server${validationDetail ? `: ${validationDetail}` : '.'}`
    }
    if (status === 503) {
      return detail || 'Error reporting is not configured on the server.'
    }
    if (status) {
      return detail || `Error report server returned HTTP ${status}.`
    }
    if (err.code === 'ECONNABORTED') {
      return 'Error report server did not respond in time.'
    }
    return err.message || 'Could not reach the error report server.'
  }
  return err instanceof Error ? err.message : 'Could not submit the error report.'
}

const submitLauncherErrorReport = async (
  request: LauncherErrorSubmitRequest,
  submissionMode: 'automatic' | 'manual' = 'manual'
): Promise<LauncherErrorSubmitResult> => {
  const reportId = String(request.reportId || '').trim()
  const report = launcherErrorReports.get(reportId)
  if (!report) throw new Error('This error report is no longer available.')
  const submittedReportId = submittedLauncherErrorReports.get(report.id)
  if (submittedReportId) {
    return { success: true, duplicate: true, reportId: submittedReportId }
  }
  if (!ERROR_REPORT_TOKEN) {
    log.warn(`[LAUNCHER-ERROR] Report ${report.id} was not submitted because this launcher build has no error report token.`)
    throw new Error('Error report sending is not configured for this build. Rebuild NamLauncher with NAMLAUNCHER_ERROR_REPORT_TOKEN.')
  }

  const account = resolveErrorReportAccount(request)
  const playerName = normalizeErrorReportPlayerName(request.playerName || report.playerName || account?.name || 'unknown')
  const system = normalizeRemoteSystemReport(report.system || (await getSystemReportInfo()))
  const diagnosis = formatMinecraftCrashDiagnosisForReport(report.diagnosis || null)
  const reportMessage = diagnosis ? `${diagnosis}\n\n${report.message}` : report.message
  log.info(`[LAUNCHER-ERROR] Preparing report ${report.id} for player ${playerName} (${system.os}, ${system.cpu_cores || '?'} cores, ${system.ram_gb || '?'} GB RAM).`)

  let response: {
    discord_dispatched?: boolean
    discord_queued?: boolean
    duplicate?: boolean
    occurrence_count?: number
    report_id?: string
  }
  try {
    response = await requestStatsApiJson('/api/error-reports', {
      method: 'POST',
      timeout: 45000,
      headers: (() => {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${ERROR_REPORT_TOKEN}`
        }
        const identityHeader = getLauncherDiscordIdentityHeader()
        if (identityHeader['X-NamLauncher-Identity']) {
          headers['X-NamLauncher-Identity'] = identityHeader['X-NamLauncher-Identity']
        }
        return headers
      })(),
      body: {
        id: report.id,
        title: trimRemoteText(report.title, ERROR_REPORT_TITLE_MAX_LENGTH) || 'Launcher problem detected',
        context: trimRemoteText(report.context, ERROR_REPORT_CONTEXT_MAX_LENGTH) || 'launcher',
        message: truncateRemoteText(reportMessage, ERROR_REPORT_MESSAGE_MAX_LENGTH),
        logs: truncateRemoteText(report.logs, ERROR_REPORT_LOGS_MAX_LENGTH),
        occurred_at: trimRemoteText(report.occurredAt, 80),
        launcher_version: trimRemoteText(report.launcherVersion, 40) || null,
        platform: trimRemoteText(report.platform, 32) || null,
        arch: trimRemoteText(report.arch, 32) || null,
        electron_version: trimRemoteText(report.electronVersion, 40) || null,
        player_name: playerName,
        account_type: report.accountType || account?.type || null,
        submission_mode: submissionMode,
        system
      }
    })
  } catch (err) {
    const message = getErrorReportSubmitFailureMessage(err)
    log.warn(`[LAUNCHER-ERROR] Report ${report.id} submission failed: ${message}`)
    throw new Error(message)
  }

  const discordDispatched = Boolean(response.discord_dispatched)
  const discordQueued = Boolean(response.discord_queued)
  const duplicate = Boolean(response.duplicate)
  const occurrenceCount = Math.max(1, Number(response.occurrence_count) || 1)
  const canonicalReportId = trimRemoteText(response.report_id || report.id, 80) || report.id
  submittedLauncherErrorReports.set(report.id, canonicalReportId)
  if (!duplicate && !discordDispatched && !discordQueued) {
    log.warn(`[LAUNCHER-ERROR] Report ${report.id} reached the website, but Discord dispatch was not queued.`)
  }

  return {
    success: true,
    reportId: canonicalReportId,
    duplicate,
    occurrenceCount,
    discordDispatched,
    discordQueued
  }
}

const confirmLauncherErrorReport = async (request: LauncherErrorSubmitRequest) => {
  const observationId = String(request.reportId || '').trim()
  const pendingAutomaticSubmission = automaticLauncherErrorSubmissions.get(observationId)
  const submitted = pendingAutomaticSubmission
    ? await pendingAutomaticSubmission
    : await submitLauncherErrorReport(request, 'manual')
  const canonicalReportId = trimRemoteText(submitted.reportId || observationId, 80) || observationId
  let response: {
    confirmed?: boolean
    duplicate?: boolean
    confirmation_count?: number
  }
  try {
    response = await requestStatsApiJson(`/api/error-reports/${encodeURIComponent(canonicalReportId)}/confirm`, {
      method: 'POST',
      timeout: 15000,
      headers: { Authorization: `Bearer ${ERROR_REPORT_TOKEN}` },
      body: {
        confirmation: 'occurred',
        observation_id: observationId
      }
    })
  } catch (err) {
    const message = getErrorReportSubmitFailureMessage(err)
    log.warn(`[LAUNCHER-ERROR] Report ${observationId} confirmation failed: ${message}`)
    throw new Error(message)
  }
  return {
    ...submitted,
    reportId: canonicalReportId,
    confirmed: Boolean(response.confirmed),
    confirmationDuplicate: Boolean(response.duplicate),
    confirmationCount: Math.max(1, Number(response.confirmation_count) || 1)
  }
}

const publishLauncherError = async (
  rawError: unknown,
  context = 'launcher',
  title = 'Launcher problem detected',
  metadata: {
    playerName?: string | null
    accountType?: string | null
    diagnosis?: MinecraftCrashDiagnosis | null
    failureClassification?: MinecraftFailureClassification | null
  } = {}
) => {
  if (metadata.failureClassification?.reportPolicy === 'local-only'
    || (['minecraft-exit', 'minecraft-launcher-core'].includes(context)
      && metadata.failureClassification?.reportPolicy !== 'automatic')) {
    log.warn('[LAUNCHER-ERROR] Refused to publish a local-only Minecraft process failure.')
    return
  }
  const rawMessage = rawError instanceof Error ? rawError.stack || rawError.message : rawError
  const message = sanitizeBugReport(String(rawMessage).slice(0, 100_000)).trim()
    || 'An unknown launcher error occurred.'
  const signature = `${context}:${message}`
  const now = Date.now()
  if (lastPublishedError.signature === signature && now - lastPublishedError.at < ERROR_REPORT_DEDUP_WINDOW_MS) return
  lastPublishedError = { signature, at: now }
  log.error(`[LAUNCHER-ERROR] [${sanitizeBugReport(context)}] ${message}`)

  const defaultAccount = getDefaultErrorReportAccount()
  const launcherLogs = readSanitizedLauncherLogs()
  const systemReport = getSystemReportInfo()
  const report: LauncherErrorReport = {
    id: crypto.randomUUID(),
    title,
    context: sanitizeBugReport(context),
    message,
    logs: await settleWithin(
      launcherLogs,
      ERROR_REPORT_INITIAL_LOG_WAIT_MS,
      'Launcher logs are still being collected and will be attached before submission.'
    ),
    occurredAt: new Date().toISOString(),
    playerName: normalizeErrorReportPlayerName(metadata.playerName || defaultAccount?.name || 'unknown'),
    accountType: trimRemoteText(metadata.accountType || defaultAccount?.type || '', 24) || null,
    diagnosis: metadata.diagnosis || null,
    system: getBasicSystemReportInfo(),
    ...getRuntimeReportMetadata()
  }
  launcherErrorReports.set(report.id, report)
  while (launcherErrorReports.size > 25) {
    const oldest = launcherErrorReports.keys().next().value
    if (!oldest) break
    launcherErrorReports.delete(oldest)
    submittedLauncherErrorReports.delete(oldest)
  }
  void Promise.all([launcherLogs, systemReport])
    .then(([logs, system]) => {
      const storedReport = launcherErrorReports.get(report.id)
      if (!storedReport) return
      storedReport.logs = logs
      storedReport.system = system
    })
    .catch((err) => {
      log.warn(`[LAUNCHER-ERROR] Could not enrich report ${report.id}: ${sanitizeCompactLogText(err instanceof Error ? err.message : err)}`)
    })
    .then(() => {
      const submission = submitLauncherErrorReport({
        reportId: report.id,
        playerName: report.playerName || null
      }, 'automatic')
      automaticLauncherErrorSubmissions.set(report.id, submission)
      return submission.finally(() => {
        if (automaticLauncherErrorSubmissions.get(report.id) === submission) {
          automaticLauncherErrorSubmissions.delete(report.id)
        }
      })
    })
    .then((result) => {
      log.info(`[LAUNCHER-ERROR] Report ${report.id} was submitted automatically as ${result.reportId}.`)
    })
    .catch((err) => {
      log.warn(`[LAUNCHER-ERROR] Automatic report ${report.id} submission failed: ${getErrorReportSubmitFailureMessage(err)}`)
    })
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('launcher-error-report', report)
}

process.on('uncaughtExceptionMonitor', (error) => {
  publishLauncherError(error, 'main-process:uncaught-exception', 'Launcher encountered a fatal error').catch(() => undefined)
})

process.on('unhandledRejection', (reason) => {
  publishLauncherError(reason, 'main-process:unhandled-rejection').catch(() => undefined)
})

const sendGameLog = (entry: Record<string, unknown>) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return
  mainWindow.webContents.send('game-log', entry)
}

const sendMinecraftGameIssue = (issue: MinecraftGameIssue) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  launcherMinimizedForGame = false
  showMainWindow()
  mainWindow.webContents.send('minecraft-game-issue', issue)
}

const minimizeLauncherForGame = (settings = readLauncherSettings()) => {
  if (!settings.autoMinimizeOnLaunch || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
    launcherMinimizedForGame = true
    hideLauncherToTray()
  }
}

const restoreLauncherAfterGame = () => {
  if (hasActiveMinecraft()) return
  if (!launcherMinimizedForGame || !mainWindow || mainWindow.isDestroyed()) return
  launcherMinimizedForGame = false
  showMainWindow()
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

const getGameState = () => {
  cleanupStaleLaunches()
  const running = [...runningGames.values()].map((game) => ({
    instanceId: game.instanceId,
    instanceName: game.instanceName,
    startedAt: game.startedAt,
    server: game.currentServer ? {
      label: game.currentServer.label,
      kind: game.currentServer.kind
    } : null
  }))
  const launching = [...activeLaunches.values()]
    .filter((launch) => !launch.cancelled)
    .map((launch) => ({
      instanceId: launch.instanceId || null,
      instanceName: launch.instanceName || null
    }))
  const primaryRunning = running[0]
  const primaryLaunching = launching[0]

  return {
    status: primaryRunning ? 'running' : primaryLaunching ? 'launching' : 'stopped',
    instanceId: primaryRunning?.instanceId || primaryLaunching?.instanceId || null,
    instanceName: primaryRunning?.instanceName || primaryLaunching?.instanceName || null,
    startedAt: primaryRunning?.startedAt || null,
    running,
    launching
  }
}

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true })
}

const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch (err) {
    log.warn(`Failed to read JSON file: ${filePath}`, err)
    return fallback
  }
}

const writeJsonFile = (filePath: string, data: unknown) => {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
}

const getImageMimeFromExtension = (filename: string) => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

const normalizeMimeType = (mimeType: string) => String(mimeType || '').split(';', 1)[0].trim().toLowerCase()

const isSafeCachedImageMimeType = (mimeType: string) => SAFE_CACHED_IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType))

const getImageExtensionFromMime = (mimeType: string) => {
  const normalized = normalizeMimeType(mimeType)
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/gif') return '.gif'
  return '.png'
}

const readCachedImageDataUrl = (cacheKey: string) => {
  if (!fs.existsSync(imageCacheDir)) return null
  const fileName = fs.readdirSync(imageCacheDir).find((item) => item.startsWith(`${cacheKey}.`))
  if (!fileName) return null

  const filePath = path.join(imageCacheDir, fileName)
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024) return null

  const data = fs.readFileSync(filePath)
  return `data:${getImageMimeFromExtension(fileName)};base64,${data.toString('base64')}`
}

const cacheRemoteImageUrl = async (rawUrl: string) => {
  const url = String(rawUrl || '').trim()
  if (!url || url.startsWith('data:') || url.startsWith('/') || url.startsWith('file:')) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }

  if (
    parsed.protocol !== 'https:'
    || !isAllowedRemoteImageHost(parsed.hostname)
    || Boolean(parsed.username || parsed.password)
    || Boolean(parsed.port && parsed.port !== '443')
  ) return ''

  const cacheKey = crypto.createHash('sha256').update(url).digest('hex')
  const cached = readCachedImageDataUrl(cacheKey)
  if (cached) return cached

  try {
    ensureDir(imageCacheDir)
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: HTTP_HEADERS,
      maxContentLength: MAX_CACHED_IMAGE_BYTES,
      maxBodyLength: MAX_CACHED_IMAGE_BYTES,
      maxRedirects: 0
    })
    const mimeType = normalizeMimeType(String(response.headers['content-type'] || ''))
    if (!isSafeCachedImageMimeType(mimeType)) return ''

    const data = Buffer.from(response.data)
    if (data.length <= 0 || data.length > MAX_CACHED_IMAGE_BYTES) return ''

    const filePath = path.join(imageCacheDir, `${cacheKey}${getImageExtensionFromMime(mimeType)}`)
    fs.writeFileSync(filePath, data)
    return `data:${mimeType};base64,${data.toString('base64')}`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.debug(`Could not cache image: ${url} (${message})`)
    return ''
  }
}

const readLauncherSettings = (): LauncherSettings => {
  const settings = readJsonFile<Partial<LauncherSettings>>(settingsPath, {})
  return {
    discordRpcEnabled: settings.discordRpcEnabled ?? true,
    anonymousStatsEnabled: true,
    gameplayTelemetryEnabled: true,
    playerBadgeEnabled: settings.playerBadgeEnabled ?? true,
    restrictedModAuditEnabled: true,
    customJavaArgsEnabled: settings.customJavaArgsEnabled ?? false,
    customJavaArgs: typeof settings.customJavaArgs === 'string' ? settings.customJavaArgs : '',
    autoMinimizeOnLaunch: settings.autoMinimizeOnLaunch ?? false,
    closeToTrayEnabled: settings.closeToTrayEnabled ?? true,
    // Preserve the explicit RAM amount used by existing installations until the
    // player opts in to automatic sizing from Settings.
    automaticMemory: settings.automaticMemory === true,
    performanceProfile: normalizePerformanceProfile(settings.performanceProfile),
    language: settings.language === 'en' ? 'en' : 'th'
  }
}

const saveLauncherSettings = (settings: LauncherSettings) => {
  writeJsonFile(settingsPath, settings)
}

const parseJavaArguments = (rawArgs: string) => {
  const input = String(rawArgs || '').trim()
  if (!input) return []
  if (input.length > 4096) {
    throw new Error('Custom Java arguments are too long.')
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (quote) throw new Error('Custom Java arguments contain an unfinished quote.')
  if (current) args.push(current)
  if (args.length > 128) throw new Error('Too many custom Java arguments.')

  const blockedArgument = args.find((argument) => (
    argument.startsWith('@')
    || /^(?:-javaagent|-agentlib|-agentpath|-Xbootclasspath)(?::|=|$)/i.test(argument)
    || /^(?:--patch-module|--upgrade-module-path|--module-path)(?:=|$)/i.test(argument)
    || /^-D(?:java\.system\.class\.loader|sun\.boot\.class\.path)=/i.test(argument)
  ))
  if (blockedArgument) {
    throw new Error('Custom Java arguments cannot load executable agents, boot class paths, argument files, or replacement modules.')
  }

  return args
}

const shouldUseJavaModuleOpenArgs = (mcVersion: string) => {
  const match = String(mcVersion || '').match(/^1\.(\d+)/)
  if (!match) return Boolean(mcVersion)
  return Number(match[1]) >= 17
}

const getLaunchJavaArgs = (settings = readLauncherSettings(), mcVersion = '') => {
  const requestedCustomArgs = settings.customJavaArgsEnabled
    ? parseJavaArguments(settings.customJavaArgs)
    : []
  const customPolicy = applyCustomJavaArgumentPolicy(requestedCustomArgs, process.platform)
  if (customPolicy.removedArguments.length > 0) {
    log.warn(
      'Ignored custom Java arguments that could override the launcher memory budget or force non-adaptive client memory behavior: '
      + customPolicy.removedArguments.join(', ')
    )
  }
  const moduleOpenArgs = shouldUseJavaModuleOpenArgs(mcVersion)
    ? JAVA_MODULE_OPEN_ARGS
    : []
  return [...DEFAULT_JAVA_ARGS, ...moduleOpenArgs, ...customPolicy.javaArgs]
}

const getDiscordRuntimeSettings = (settings = readLauncherSettings()): DiscordRuntimeSettings => ({
  ...settings,
  discordClientId: DEFAULT_DISCORD_CLIENT_ID,
  launcherVersion: app.getVersion()
})

const getMinecraftDiscordRuntimeSettings = (settings = readLauncherSettings()): DiscordRuntimeSettings => ({
  ...settings,
  discordClientId: MINECRAFT_OFFICIAL_APPLICATION_ID,
  launcherVersion: app.getVersion()
})

const parseVersionParts = (value: string) => {
  const cleaned = String(value || '').trim().replace(/^v/i, '')
  const [core, prerelease = ''] = cleaned.split('-', 2)
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return {
    major: numbers[0] || 0,
    minor: numbers[1] || 0,
    patch: numbers[2] || 0,
    prerelease
  }
}

const compareVersions = (left: string, right: string) => {
  const a = parseVersionParts(left)
  const b = parseVersionParts(right)
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true, sensitivity: 'base' })
}

const getAbsoluteWebsiteUrl = (url: string | null | undefined) => {
  if (!url) return `${STATS_API_BASE}/download/`
  try {
    return new URL(url, STATS_API_BASE).toString()
  } catch {
    return `${STATS_API_BASE}/download/`
  }
}

const getLauncherPlatform = () => {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

const getPreferredLauncherArtifact = (release: LauncherReleaseResponse) => {
  const artifacts = Array.isArray(release.artifacts) ? release.artifacts : []
  const platform = getLauncherPlatform()
  const available = artifacts.filter((artifact) => artifact?.available && !artifact.updates_paused && artifact.platform === platform && artifact.url
    && (!artifact.arch || artifact.arch === process.arch || artifact.arch === 'universal'))

  if (platform === 'windows') {
    return available.find((artifact) => artifact.format === 'exe')
      || available.find((artifact) => artifact.recommended)
      || available[0]
      || null
  }

  if (platform === 'linux') {
    const target = getStartupUpdateTarget()
    const format = process.env.FLATPAK_ID ? 'flatpak'
      : target === 'linux-deb-x64' ? 'deb'
        : target === 'linux-rpm-x64' ? 'rpm'
          : target === 'linux-pacman-x64' ? 'pkg.tar.zst' : 'AppImage'
    return available.find((artifact) => artifact.format === format)
      || available.find((artifact) => artifact.recommended)
      || available[0]
      || null
  }

  return available.find((artifact) => artifact.recommended) || available[0] || null
}

const fetchLatestLauncherRelease = async () => {
  const response = await axios.get<LauncherReleaseResponse>(`${STATS_API_BASE}/api/releases/latest`, {
    timeout: 10000,
    headers: HTTP_HEADERS
  })
  return response.data || {}
}

const checkLauncherUpdate = async () => {
  const currentVersion = app.getVersion()
  try {
    const release = await fetchLatestLauncherRelease()

    const artifact = getPreferredLauncherArtifact(release)
    const platform = getLauncherPlatform()
    const platformArtifact = artifact || (Array.isArray(release.artifacts) ? release.artifacts.find((item) => item?.platform === platform) : null)
    const latestVersion = String(platformArtifact?.version || (platform === 'windows' ? release.version : null) || currentVersion)
    const updateAvailable = !platformArtifact?.updates_paused && compareVersions(latestVersion, currentVersion) > 0
    requiredLauncherUpdateVersion = updateAvailable ? latestVersion : null
    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      channel: release.channel || 'stable',
      downloadUrl: getAbsoluteWebsiteUrl(artifact?.url || (platform === 'windows' ? release.download_url : '/#download')),
      installerSha256: normalizeLauncherInstallerSha256(artifact?.sha256),
      mandatory: updateAvailable,
      notes: Array.isArray(release.notes) ? release.notes : []
    }
  } catch (err) {
    log.debug('Launcher update check failed', getCompactErrorLog(err))
    return {
      currentVersion,
      latestVersion: requiredLauncherUpdateVersion || currentVersion,
      updateAvailable: Boolean(requiredLauncherUpdateVersion),
      channel: 'stable',
      downloadUrl: `${STATS_API_BASE}/download/`,
      installerSha256: null,
      mandatory: Boolean(requiredLauncherUpdateVersion),
      notes: [],
      error: err instanceof Error ? err.message : 'Update check failed'
    }
  }
}

const sendLauncherUpdateProgress = (progress: {
  state: 'checking' | 'downloading' | 'opening-installer' | 'installer-opened' | 'failed'
  percent?: number
  detail?: string
}) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('launcher-update-progress', progress)
}

const assertTrustedLauncherUpdateUrl = (rawUrl: string) => {
  const parsed = new URL(rawUrl)
  const statsBase = new URL(STATS_API_BASE)
  const developmentHost = !app.isPackaged && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  const trustedHost = parsed.hostname === statsBase.hostname || parsed.hostname === 'namlauncher.nattapat2871.me'
  if (parsed.username || parsed.password) throw new Error('The launcher update URL must not contain credentials.')
  if ((parsed.protocol === 'https:' && trustedHost && (!parsed.port || parsed.port === '443'))
    || (developmentHost && ['http:', 'https:'].includes(parsed.protocol))) return parsed.toString()
  throw new Error('The launcher update URL is not trusted.')
}

const getLauncherInstallerFileName = (downloadUrl: string, latestVersion: string) => {
  const parsed = new URL(downloadUrl)
  const fileName = path.basename(parsed.pathname)
  if (/^[A-Za-z0-9._-]+\.exe$/i.test(fileName)) return fileName
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(latestVersion)) throw new Error('Invalid launcher update version.')
  return `NamLauncher-${latestVersion}-Installer.exe`
}

const getLauncherUpdateInstallerPath = (fileName: string) => {
  return path.join(getLauncherUpdateDownloadDirectory(), fileName)
}

const getLauncherInstallerTempPath = (installerPath: string) => {
  return buildLauncherInstallerTempPath(
    installerPath,
    `${process.pid}-${Date.now()}-${crypto.randomUUID()}`
  )
}

const getLauncherInstallerFallbackPath = (installerPath: string) => {
  const parsed = path.parse(installerPath)
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
}

const removeFileIfExistsQuietly = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return false
    fs.rmSync(filePath, { force: true, maxRetries: 6, retryDelay: 300 })
    return true
  } catch (err) {
    log.warn(`Could not remove locked file: ${filePath}`, getCompactErrorLog(err))
    return false
  }
}

const downloadLauncherUpdateInstaller = async (
  downloadUrl: string,
  installerPath: string,
  expectedSha256: string
) => {
  ensureDir(path.dirname(installerPath))
  if (fs.existsSync(installerPath)) {
    try {
      assertDownloadedLauncherInstaller(installerPath, expectedSha256)
      return installerPath
    } catch {
      removeFileIfExistsQuietly(installerPath)
    }
  }
  const tempPath = getLauncherInstallerTempPath(installerPath)

  const response = await axios({
    method: 'GET',
    url: downloadUrl,
    responseType: 'stream',
    headers: HTTP_HEADERS,
    timeout: 300000,
    signal: AbortSignal.timeout(300000),
    maxContentLength: MAX_LAUNCHER_INSTALLER_BYTES
  })

  const totalLength = Number(response.headers['content-length']) || 0
  if (totalLength > MAX_LAUNCHER_INSTALLER_BYTES) {
    response.data.destroy()
    throw new Error('The launcher installer is larger than expected.')
  }

  let downloadedLength = 0
  const downloadedDigest = crypto.createHash('sha256')
  let lastProgressAt = 0
  let lastProgressValue = -1
  const writer = fs.createWriteStream(tempPath, { flags: 'wx' })

  response.data.on('data', (chunk: Buffer) => {
    downloadedLength += chunk.length
    downloadedDigest.update(chunk)
    if (downloadedLength > MAX_LAUNCHER_INSTALLER_BYTES) {
      response.data.destroy(new Error('The launcher installer is larger than expected.'))
      return
    }
    if (totalLength > 0) {
      const progressValue = Math.round((downloadedLength / totalLength) * 100)
      const now = Date.now()
      if (progressValue !== lastProgressValue && (now - lastProgressAt > 250 || progressValue >= 100)) {
        lastProgressAt = now
        lastProgressValue = progressValue
        sendLauncherUpdateProgress({
          state: 'downloading',
          percent: Math.min(progressValue, 100),
          detail: path.basename(installerPath)
        })
      }
    }
  })

  try {
    // pipeline closes both ends before rejecting, including disk-full and
    // aborted downloads, so partial-file cleanup cannot race an open writer.
    await pipeline(response.data, writer)
    const actualSha256 = downloadedDigest.digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(actualSha256, 'hex'), Buffer.from(expectedSha256, 'hex'))) {
      throw new Error('The launcher installer failed SHA-256 integrity verification.')
    }
    assertDownloadedLauncherInstaller(tempPath, expectedSha256)
    let finalInstallerPath = installerPath
    if (fs.existsSync(installerPath) && !removeFileIfExistsQuietly(installerPath)) {
      finalInstallerPath = getLauncherInstallerFallbackPath(installerPath)
    }
    fs.renameSync(tempPath, finalInstallerPath)
    assertDownloadedLauncherInstaller(finalInstallerPath, expectedSha256)
    return finalInstallerPath
  } catch (err) {
    removeFileIfExistsQuietly(tempPath)
    throw err
  }
}

const assertDownloadedLauncherInstaller = (installerPath: string, expectedSha256: string) => {
  if (process.platform !== 'win32') {
    throw new Error('Opening the downloaded launcher installer is only available on Windows.')
  }
  if (!fs.existsSync(installerPath) || !/\.exe$/i.test(installerPath)) {
    throw new Error('The downloaded launcher installer is missing or invalid.')
  }

  const stat = fs.lstatSync(installerPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_LAUNCHER_INSTALLER_BYTES) {
    throw new Error('The downloaded launcher installer is not a valid size.')
  }

  const fd = fs.openSync(installerPath, 'r')
  try {
    const header = Buffer.alloc(2)
    fs.readSync(fd, header, 0, header.length, 0)
    if (header.toString('ascii') !== 'MZ') {
      throw new Error('The downloaded launcher installer is not a Windows executable.')
    }
  } finally {
    fs.closeSync(fd)
  }
  assertFileSha256(installerPath, expectedSha256)
}

// Author/creator: nattapat2871 (https://nattapat2871.me)
const spawnDownloadedLauncherInstaller = (
  installerPath: string,
  args: readonly string[] = []
) => new Promise<void>((resolve, reject) => {
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(installerPath, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false
    })
  } catch (error) {
    reject(error)
    return
  }

  const onError = (error: Error) => reject(error)
  child.once('error', onError)
  child.once('spawn', () => {
    child.removeListener('error', onError)
    child.unref()
    resolve()
  })
})

const openDownloadedLauncherInstaller = async (installerPath: string, expectedSha256: string) => {
  assertDownloadedLauncherInstaller(installerPath, expectedSha256)
  try {
    await spawnDownloadedLauncherInstaller(installerPath, ['--updated', '--choose-install-mode'])
  } catch (error) {
    const openError = await shell.openPath(installerPath)
    if (!openError) {
      log.warn('The launcher installer opened through the Windows fallback without the update mode selector arguments.')
      return
    }
    throw new Error(
      `Windows could not open the launcher installer: ${error instanceof Error ? error.message : String(error || openError)}`
    )
  }
}

const quitLauncherForUpdateInstaller = () => {
  const timer = setTimeout(() => {
    log.info('Quitting NamLauncher after opening the update installer. The installer will relaunch NamLauncher when setup finishes.')
    requestAppQuit()
  }, 1200)
  timer.unref?.()
}

const assertLauncherUpdateInstallIsSafe = () => {
  if (hasActiveMinecraft()) {
    throw new LauncherUpdateBlockedError('minecraft-active')
  }
  if (activeInstallTasks.size > 0) {
    throw new LauncherUpdateBlockedError('content-install-active')
  }
}

const installLauncherUpdateUnsafe = async () => {
  assertLauncherUpdateInstallIsSafe()
  sendLauncherUpdateProgress({ state: 'checking', percent: 0, detail: 'Checking latest launcher release' })
  const update = await checkLauncherUpdate()
  if (!update.updateAvailable) {
    throw new LauncherUpdateBlockedError('already-current')
  }

  persistLauncherDataLocationForUpdate()

  if (process.platform !== 'win32') {
    await openExternalUrl(update.downloadUrl)
    return {
      success: false,
      openedDownload: true,
      message: 'Automatic launcher installation is only available on Windows.'
    }
  }

  const downloadUrl = assertTrustedLauncherUpdateUrl(update.downloadUrl)
  const installerSha256 = normalizeLauncherInstallerSha256(update.installerSha256)
  if (!installerSha256) {
    throw new Error('This launcher release cannot be installed automatically because its SHA-256 checksum is unavailable.')
  }
  const fileName = getLauncherInstallerFileName(downloadUrl, update.latestVersion)
  const installerPath = getLauncherUpdateInstallerPath(fileName)

  sendLauncherUpdateProgress({ state: 'downloading', percent: 0, detail: fileName })
  cleanupLauncherUpdateDownloadDirectory(installerPath)
  const downloadedInstallerPath = await downloadLauncherUpdateInstaller(downloadUrl, installerPath, installerSha256)
  sendLauncherUpdateProgress({
    state: 'opening-installer',
    percent: 100,
    detail: `Opening ${fileName}`
  })
  assertLauncherUpdateInstallIsSafe()
  writePendingLauncherUpdateCleanup(downloadedInstallerPath, update.latestVersion)
  try {
    await openDownloadedLauncherInstaller(downloadedInstallerPath, installerSha256)
  } catch (err) {
    fs.rmSync(path.join(userDataPath, UPDATE_CLEANUP_FILE), { force: true })
    throw err
  }
  sendLauncherUpdateProgress({
    state: 'installer-opened',
    percent: 100,
    detail: `Installer opened: ${fileName}`
  })
  quitLauncherForUpdateInstaller()

  return {
    success: true,
    installerPath: downloadedInstallerPath,
    installerOpened: true,
    willRestart: true,
    message: `Installer opened for NamLauncher ${update.latestVersion}. NamLauncher will close now and reopen when setup finishes.`
  }
}

const installLauncherUpdate = async () => {
  if (launcherUpdateInstallInFlight) {
    return getLauncherUpdateBlockedResult(new LauncherUpdateBlockedError('update-in-progress'))!
  }
  launcherUpdateInstallInFlight = true
  try {
    return await installLauncherUpdateUnsafe()
  } catch (error) {
    const blocked = getLauncherUpdateBlockedResult(error)
    if (blocked) {
      log.info(`Launcher update deferred safely (${blocked.blockReason}).`)
      return blocked
    }
    throw error
  } finally {
    launcherUpdateInstallInFlight = false
  }
}

let lastLauncherStatsFailureLogAt = 0
let lastOnlineHeartbeatFailureLogAt = 0
const NETWORK_FAILURE_LOG_INTERVAL_MS = 5 * 60 * 1000

const getLauncherWebsiteStats = async () => {
  try {
    const response = await axios.get<{
      downloads?: number
      online_players?: number
      heartbeat_window_seconds?: number
      download_url?: string | null
      launcher_version?: string | null
    }>(`${STATS_API_BASE}/api/stats`, {
      timeout: 6000,
      headers: HTTP_HEADERS
    })

    return {
      downloads: Number(response.data.downloads || 0),
      online_players: Number(response.data.online_players || 0),
      heartbeat_window_seconds: Number(response.data.heartbeat_window_seconds || 0),
      download_url: response.data.download_url || null,
      launcher_version: response.data.launcher_version || app.getVersion()
    }
  } catch (err) {
    const now = Date.now()
    if (now - lastLauncherStatsFailureLogAt >= NETWORK_FAILURE_LOG_INTERVAL_MS) {
      lastLauncherStatsFailureLogAt = now
      log.debug('Launcher website stats check failed', getCompactErrorLog(err))
    }
    return {
      downloads: 0,
      online_players: 0,
      heartbeat_window_seconds: 0,
      download_url: null,
      launcher_version: app.getVersion(),
      error: err instanceof Error ? err.message : 'Stats check failed'
    }
  }
}

const getClientInstallId = () => {
  const stored = readJsonFile<{ clientId?: string }>(clientIdentityPath, {})
  if (stored.clientId && typeof stored.clientId === 'string') return stored.clientId

  const clientId = crypto.randomUUID()
  writeJsonFile(clientIdentityPath, { clientId, createdAt: new Date().toISOString() })
  return clientId
}

const sendOnlineHeartbeat = async () => {
  if (onlineHeartbeatInFlight) return

  onlineHeartbeatInFlight = true
  try {
    await axios.post(
      `${STATS_API_BASE}/api/heartbeat`,
      {
        client_id: getClientInstallId(),
        launcher_version: app.getVersion(),
        platform: process.platform,
        game_running: runningGames.size > 0
      },
      {
        timeout: 5000,
        headers: HTTP_HEADERS
      }
    )
  } catch (err) {
    const now = Date.now()
    if (now - lastOnlineHeartbeatFailureLogAt >= NETWORK_FAILURE_LOG_INTERVAL_MS) {
      lastOnlineHeartbeatFailureLogAt = now
      log.debug('Online heartbeat failed.', getCompactErrorLog(err))
    }
  } finally {
    onlineHeartbeatInFlight = false
  }
}

const stopOnlineHeartbeat = () => {
  if (!onlineHeartbeatTimer) return
  clearInterval(onlineHeartbeatTimer)
  onlineHeartbeatTimer = null
}

type GameSessionEventResponse = {
  ok: boolean
  state: 'active' | 'ended'
  duration_seconds: number
}

const postGameSessionEvent = async (
  game: RunningGame,
  event: GameSessionEventName,
  options: { endReason?: GameSessionEndReason; exitCode?: number } = {}
) => {
  const sessionHeaders: Record<string, string> = {
    Authorization: `Bearer ${ERROR_REPORT_TOKEN}`
  }
  Object.assign(sessionHeaders, getLauncherDiscordIdentityHeader())
  await requestStatsApiJson<GameSessionEventResponse>('/api/game-sessions/events', {
    method: 'POST',
    timeout: 5000,
    headers: sessionHeaders,
    body: {
      event,
      session_id: game.telemetrySessionId,
      client_id: getClientInstallId(),
      player_name: normalizeErrorReportPlayerName(game.playerName),
      account_type: game.accountType,
      launcher_version: app.getVersion(),
      platform: process.platform,
      minecraft_version: trimRemoteText(game.minecraftVersion, 40) || 'unknown',
      loader: normalizeGameSessionLoader(game.loader),
      player_badge_enabled: readLauncherSettings().playerBadgeEnabled,
      server_state: game.currentServer ? 'connected' : 'disconnected',
      ...(game.currentServer ? {
        server_key: game.currentServer.key,
        server_address: game.currentServer.address,
        server_label: game.currentServer.label,
        server_kind: game.currentServer.kind
      } : {}),
      ...(event === 'start' ? {} : {
        client_duration_ms: Math.max(0, Date.now() - game.startedAt)
      }),
      ...(event === 'end' ? {
        end_reason: options.endReason || 'unknown',
        exit_code: Number.isInteger(options.exitCode) ? options.exitCode : null
      } : {})
    }
  })
  if (event === 'start') game.telemetryStartAcknowledged = true
}

const queueGameSessionEvent = (
  game: RunningGame,
  event: GameSessionEventName,
  options: { endReason?: GameSessionEndReason; exitCode?: number } = {}
) => {
  if (event === 'end') {
    if (!game.telemetryActive) return game.telemetryQueue || Promise.resolve()
    game.telemetryActive = false
  } else if (!game.telemetryActive) {
    return game.telemetryQueue || Promise.resolve()
  }

  const previous = game.telemetryQueue || Promise.resolve()
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      if (event !== 'start' && !game.telemetryStartAcknowledged) {
        await postGameSessionEvent(game, 'start')
      }
      await postGameSessionEvent(game, event, options)
    })
    .catch((error) => {
      const now = Date.now()
      if (now - lastGameSessionTelemetryFailureLogAt >= NETWORK_FAILURE_LOG_INTERVAL_MS) {
        lastGameSessionTelemetryFailureLogAt = now
        log.debug('Gameplay session telemetry failed.', getCompactErrorLog(error))
      }
    })
  game.telemetryQueue = queued
  return queued
}

const startGameSessionTelemetry = (
  game: RunningGame,
  _settings = readLauncherSettings()
) => {
  if (game.telemetryActive) return Promise.resolve()
  game.telemetrySessionId = crypto.randomUUID()
  game.telemetryActive = true
  game.telemetryStartAcknowledged = false
  game.telemetryQueue = undefined
  return queueGameSessionEvent(game, 'start')
}

type PlayerBadgePresenceEvent = 'start' | 'heartbeat' | 'end'

const postPlayerBadgePresence = async (
  game: RunningGame,
  event: PlayerBadgePresenceEvent
) => {
  const playerUuid = normalizePlayerBadgeUuid(game.playerUuid)
  if (!playerUuid || !['msa', 'offline'].includes(game.accountType)) return
  const offlineUuid = normalizePlayerBadgeUuid(getOfflineUuid(game.playerName))
  const playerUuidAliases = offlineUuid && offlineUuid !== playerUuid ? [offlineUuid] : []
  await requestStatsApiJson<{
    ok: boolean
    active: boolean
    ttl_seconds: number
  }>('/api/player-badges/presence', {
    method: 'POST',
    timeout: 5000,
    headers: { Authorization: `Bearer ${ERROR_REPORT_TOKEN}` },
    body: {
      event,
      presence_id: game.badgePresenceId,
      client_id: getClientInstallId(),
      player_uuid: playerUuid,
      player_uuid_aliases: playerUuidAliases,
      account_type: game.accountType,
      launcher_version: app.getVersion()
    }
  })
  if (event === 'start') game.badgePresenceStartAcknowledged = true
}

const queuePlayerBadgePresence = (
  game: RunningGame,
  event: PlayerBadgePresenceEvent
) => {
  if (event === 'end') {
    if (!game.badgePresenceActive) return game.badgePresenceQueue || Promise.resolve()
    game.badgePresenceActive = false
  } else if (!game.badgePresenceActive) {
    return game.badgePresenceQueue || Promise.resolve()
  }

  const previous = game.badgePresenceQueue || Promise.resolve()
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      if (event !== 'start' && !game.badgePresenceStartAcknowledged) {
        await postPlayerBadgePresence(game, 'start')
      }
      await postPlayerBadgePresence(game, event)
    })
    .catch((error) => {
      const now = Date.now()
      if (now - lastPlayerBadgePresenceFailureLogAt >= NETWORK_FAILURE_LOG_INTERVAL_MS) {
        lastPlayerBadgePresenceFailureLogAt = now
        log.debug('Player badge presence update failed.', getCompactErrorLog(error))
      }
    })
  game.badgePresenceQueue = queued
  return queued
}

const startPlayerBadgePresence = (
  game: RunningGame,
  settings = readLauncherSettings()
) => {
  if (
    !settings.playerBadgeEnabled
    || game.badgePresenceActive
    || !['msa', 'offline'].includes(game.accountType)
    || !normalizePlayerBadgeUuid(game.playerUuid)
  ) return Promise.resolve()
  game.badgePresenceId = crypto.randomUUID()
  game.badgePresenceActive = true
  game.badgePresenceStartAcknowledged = false
  game.badgePresenceQueue = undefined
  return queuePlayerBadgePresence(game, 'start')
}

const configurePlayerBadgePresence = (settings = readLauncherSettings()) => {
  for (const game of runningGames.values()) {
    try {
      writePlayerBadgeConfig({
        gameDirectory: game.gameDirectory,
        enabled: settings.playerBadgeEnabled,
        playerUuid: game.playerUuid,
        lookupEndpoint: `${STATS_API_BASE}/api/player-badges/lookup`
      })
    } catch (error) {
      log.warn('Could not update the running game player badge configuration.', getCompactErrorLog(error))
    }
    if (settings.playerBadgeEnabled) {
      void startPlayerBadgePresence(game, settings)
    } else if (game.badgePresenceActive) {
      void queuePlayerBadgePresence(game, 'end')
    }
  }
}

const reportRestrictedModSignals = async (
  game: RunningGame,
  _settings = readLauncherSettings()
) => {
  try {
    // Yield until launch-state/UI updates are delivered before the bounded local scan.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const scan = scanRestrictedMods(game.gameDirectory)
    if (scan.observations.length === 0) {
      log.info(`Restricted-mod signal scan completed for the active instance (${scan.scannedFiles} files, no signals).`)
      return
    }
    await requestStatsApiJson<{
      ok: boolean
      audit_id: string
      observation_count: number
      duplicate: boolean
    }>('/api/restricted-mod-audits', {
      method: 'POST',
      timeout: 7000,
      headers: { Authorization: `Bearer ${ERROR_REPORT_TOKEN}` },
      body: {
        audit_id: crypto.randomUUID(),
        client_id: getClientInstallId(),
        player_name: normalizeErrorReportPlayerName(game.playerName),
        account_type: game.accountType,
        launcher_version: app.getVersion(),
        minecraft_version: trimRemoteText(game.minecraftVersion, 40) || 'unknown',
        loader: normalizeGameSessionLoader(game.loader),
        scanned_files: scan.scannedFiles,
        truncated: scan.truncated,
        consent_version: '2026-08-24.1',
        observations: scan.observations.map((observation) => ({
          detector_id: observation.detectorId,
          category: observation.category,
          display_name: observation.displayName,
          mod_version: observation.modVersion,
          source: observation.source
        }))
      }
    })
    log.info(`Reported ${scan.observations.length} potentially policy-restricted mod signal(s) from the active instance.`)
  } catch (error) {
    const now = Date.now()
    if (now - lastRestrictedModAuditFailureLogAt >= NETWORK_FAILURE_LOG_INTERVAL_MS) {
      lastRestrictedModAuditFailureLogAt = now
      log.debug('Required restricted-mod signal audit failed.', getCompactErrorLog(error))
    }
  }
}

const sendGameSessionHeartbeats = async () => {
  const active = [...runningGames.values()].filter((game) => game.telemetryActive)
  const badgeActive = [...runningGames.values()].filter((game) => game.badgePresenceActive)
  await Promise.allSettled([
    ...active.map((game) => queueGameSessionEvent(game, 'heartbeat')),
    ...badgeActive.map((game) => queuePlayerBadgePresence(game, 'heartbeat'))
  ])
}

const configureGameSessionTelemetry = (settings = readLauncherSettings()) => {
  for (const game of runningGames.values()) {
    if (game.telemetryActive) {
      void queueGameSessionEvent(game, 'heartbeat')
    } else {
      void startGameSessionTelemetry(game, settings)
    }
  }
}

const keepOnlineHeartbeatRunning = (_settings = readLauncherSettings()) => {
  if (isAppQuitting) return
  if (onlineHeartbeatTimer) return

  sendOnlineHeartbeat().catch(() => undefined)
  sendGameSessionHeartbeats().catch(() => undefined)
  onlineHeartbeatTimer = setInterval(() => {
    sendOnlineHeartbeat().catch(() => undefined)
    sendGameSessionHeartbeats().catch(() => undefined)
  }, GAME_SESSION_HEARTBEAT_INTERVAL_MS)
}

const configureOnlineHeartbeat = (settings = readLauncherSettings()) => {
  stopOnlineHeartbeat()
  keepOnlineHeartbeatRunning(settings)
}

const canEncryptAccountAuth = () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      log.warn('Microsoft account persistence is disabled because Electron safeStorage is using the insecure Linux basic_text backend.')
      return false
    }
    return true
  } catch {
    return false
  }
}

const getStartupUpdateTarget = () => {
  let packageType = ''
  try { packageType = fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() } catch { /* Not a package-managed build. */ }
  return selectStartupUpdateTarget(process.platform, process.arch, packageType, process.env.APPIMAGE || '', Boolean(process.env.FLATPAK_ID))
}

const startupUpdateAttemptPath = path.join(userDataPath, 'startup-update-attempt.json')
const startupAutoUpdateFallback = process.argv.includes('--auto-update-fallback')
const runStartupLauncherUpdateOnce = createStartupUpdateController({
  check: checkLauncherUpdate,
  enabled: () => app.isPackaged && !startupAutoUpdateFallback,
  target: getStartupUpdateTarget,
  activeWork: () => hasActiveMinecraft() || activeInstallTasks.size > 0 || launcherUpdateInstallInFlight,
  previousAttempt: () => {
    try {
      const info = fs.lstatSync(startupUpdateAttemptPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2048) return null
      const attempt = JSON.parse(fs.readFileSync(startupUpdateAttemptPath, 'utf8'))
      return typeof attempt.version === 'string' && Number.isFinite(attempt.at) ? attempt : null
    } catch { return null }
  },
  recordAttempt: (version, at) => {
    const temporary = `${startupUpdateAttemptPath}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version, at }), { flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, startupUpdateAttemptPath)
    } finally {
      removeFileIfExistsQuietly(temporary)
    }
  },
  logFailure: (error) => log.warn('Startup automatic update failed; keeping the manual updater available.', getCompactErrorLog(error)),
  install: async (update, target) => {
    launcherUpdateInstallInFlight = true
    try {
      assertLauncherUpdateInstallIsSafe()
      persistLauncherDataLocationForUpdate()
      if (target === 'windows-x64') {
        const installScope = resolveWindowsInstallScope(process.execPath)
        const downloadUrl = assertTrustedLauncherUpdateUrl(update.downloadUrl)
        const installerSha256 = normalizeLauncherInstallerSha256(update.installerSha256)
        if (!installerSha256) throw new Error('Automatic update requires a verified SHA-256 checksum.')
        const installerPath = getLauncherUpdateInstallerPath(getLauncherInstallerFileName(downloadUrl, update.latestVersion))
        sendLauncherUpdateProgress({ state: 'downloading', percent: 0 })
        const downloadedInstallerPath = await downloadLauncherUpdateInstaller(downloadUrl, installerPath, installerSha256)
        assertLauncherUpdateInstallIsSafe()
        sendLauncherUpdateProgress({ state: 'opening-installer', percent: 100 })
        writePendingLauncherUpdateCleanup(downloadedInstallerPath, update.latestVersion)
        const handoff = await launchWindowsAutoInstaller({
          installerPath: downloadedInstallerPath,
          expectedSha256: installerSha256,
          launcherPath: process.execPath,
          helperSource: app.isPackaged ? path.join(process.resourcesPath, 'updater', 'update-windows.ps1') : path.resolve(__dirname, '../packaging/update-windows.ps1'),
          workDirectory: getLauncherUpdateDownloadDirectory(),
          parentId: process.pid,
          installScope
        })
        log.info(`Automatic Windows updater handoff ${handoff.attemptId} is ready in detached helper process ${handoff.helperPid}.`)
        sendLauncherUpdateProgress({ state: 'opening-installer', percent: 100, detail: 'Verified updater helper is ready' })
        quitLauncherForUpdateInstaller()
      } else {
        await installPlatformAutoUpdate({
          target,
          version: update.latestVersion,
          feedBase: `${STATS_API_BASE}/api/releases/updater/${target}/`,
          assertSafe: assertLauncherUpdateInstallIsSafe,
          onProgress: (percent) => sendLauncherUpdateProgress({ state: 'downloading', percent }),
          onInstalling: () => sendLauncherUpdateProgress({ state: 'opening-installer', percent: 100 }),
          relaunch: (executable) => app.relaunch(executable ? { execPath: executable } : {}),
          quit: requestAppQuit,
          beforeNativeQuit: () => { isAppQuitting = true },
          logger: log
        })
      }
    } catch (error) {
      launcherUpdateInstallInFlight = false
      isAppQuitting = false
      sendLauncherUpdateProgress({ state: 'failed', percent: 0 })
      throw error
    }
    // Keep the interlock until exit; a second installer or game cannot race it.
  }
})

const runStartupLauncherUpdate = async () => {
  try {
    const result = await runStartupLauncherUpdateOnce()
    // The detached helper returns here after a post-exit installer failure.
    // Surface the existing Thai/manual fallback UI instead of presenting the
    // disabled automatic path as an idle update.
    if (startupAutoUpdateFallback && result.outcome === 'disabled' && result.update.updateAvailable) {
      return { ...result, outcome: 'fallback' as const, reason: 'install-failed' as const }
    }
    return result
  }
  finally { startupUpdatePending = false }
}

type LauncherDiscordAccount = {
  sessionToken: string
  profile: LauncherDiscordProfile
  persistent: boolean
}

let launcherDiscordAccountCache: LauncherDiscordAccount | null | undefined
let launcherDiscordLinkPromise: Promise<LauncherDiscordAccount> | null = null

const normalizeStoredLauncherDiscordProfile = (value: any): LauncherDiscordProfile | null => {
  const id = String(value?.id || '').trim()
  const username = String(value?.username || '').trim()
  const displayName = String(value?.displayName || username).trim()
  const avatarUrl = String(value?.avatarUrl || '').trim()
  const expiresAt = value?.expiresAt ? String(value.expiresAt) : null
  if (!/^[0-9]{17,20}$/.test(id) || !username || username.length > 80 || !displayName || displayName.length > 80) return null
  try {
    const parsed = new URL(avatarUrl)
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== 'cdn.discordapp.com'
      || parsed.username
      || parsed.password
      || (parsed.port && parsed.port !== '443')
    ) return null
    return { id, username, displayName, avatarUrl: parsed.toString(), expiresAt }
  } catch {
    return null
  }
}

const clearLauncherDiscordAccount = () => {
  launcherDiscordAccountCache = null
  fs.rmSync(launcherDiscordAccountPath, { force: true })
}

const readLauncherDiscordAccount = (): LauncherDiscordAccount | null => {
  if (launcherDiscordAccountCache !== undefined) return launcherDiscordAccountCache
  launcherDiscordAccountCache = null
  const stored = readJsonFile<any>(launcherDiscordAccountPath, null)
  if (!stored || typeof stored !== 'object' || !canEncryptAccountAuth()) return null
  const profile = normalizeStoredLauncherDiscordProfile(stored.profile)
  const encrypted = String(stored.sessionEncrypted || '').trim()
  if (!profile || !encrypted) {
    clearLauncherDiscordAccount()
    return null
  }
  try {
    const sessionToken = safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim()
    if (!/^[A-Za-z0-9_-]{48,256}$/.test(sessionToken)) throw new Error('Invalid stored session token.')
    launcherDiscordAccountCache = { sessionToken, profile, persistent: true }
  } catch (error) {
    log.warn('Could not decrypt the saved Discord account link.', getCompactErrorLog(error))
    clearLauncherDiscordAccount()
  }
  return launcherDiscordAccountCache
}

const saveLauncherDiscordAccount = (sessionToken: string, profile: LauncherDiscordProfile) => {
  const persistent = canEncryptAccountAuth()
  launcherDiscordAccountCache = { sessionToken, profile, persistent }
  if (!persistent) {
    fs.rmSync(launcherDiscordAccountPath, { force: true })
    return launcherDiscordAccountCache
  }
  const sessionEncrypted = safeStorage.encryptString(sessionToken).toString('base64')
  writeJsonFile(launcherDiscordAccountPath, {
    author: 'nattapat2871 (https://nattapat2871.me)',
    profile,
    sessionEncrypted,
    updatedAt: new Date().toISOString()
  })
  return launcherDiscordAccountCache
}

const getLauncherDiscordAccountState = async () => {
  const account = readLauncherDiscordAccount()
  if (!account) return { connected: false, persistent: canEncryptAccountAuth(), profile: null }
  try {
    const profile = await validateLauncherDiscordSession(STATS_API_BASE, ERROR_REPORT_TOKEN, account.sessionToken)
    const saved = saveLauncherDiscordAccount(account.sessionToken, profile)
    return { connected: true, persistent: saved.persistent, profile: saved.profile }
  } catch (error) {
    if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
      clearLauncherDiscordAccount()
      return { connected: false, persistent: canEncryptAccountAuth(), profile: null }
    }
    log.debug('Could not refresh the linked Discord profile; using the encrypted cached profile.', getCompactErrorLog(error))
    return { connected: true, persistent: account.persistent, profile: account.profile, offline: true }
  }
}

const connectLauncherDiscordAccount = async () => {
  if (launcherDiscordLinkPromise) return launcherDiscordLinkPromise
  launcherDiscordLinkPromise = (async () => {
    const transaction = await startLauncherDiscordLink(STATS_API_BASE, ERROR_REPORT_TOKEN)
    await shell.openExternal(transaction.authorizeUrl)
    const linked = await waitForLauncherDiscordLink(
      STATS_API_BASE,
      ERROR_REPORT_TOKEN,
      transaction.requestToken
    )
    const account = saveLauncherDiscordAccount(linked.sessionToken, linked.profile)
    log.info(`Discord account link saved for user id ending ${account.profile.id.slice(-4)}.`)
    return account
  })()
  try {
    const account = await launcherDiscordLinkPromise
    return { connected: true, persistent: account.persistent, profile: account.profile }
  } finally {
    launcherDiscordLinkPromise = null
  }
}

const disconnectLauncherDiscordAccount = async () => {
  const account = readLauncherDiscordAccount()
  if (account) {
    try {
      await revokeLauncherDiscordSession(STATS_API_BASE, ERROR_REPORT_TOKEN, account.sessionToken)
    } catch (error) {
      log.debug('Could not revoke the Discord link remotely; removing the local session.', getCompactErrorLog(error))
    }
  }
  clearLauncherDiscordAccount()
  return { connected: false, persistent: canEncryptAccountAuth(), profile: null }
}

const getLauncherDiscordIdentityHeader = () => {
  const token = readLauncherDiscordAccount()?.sessionToken
  return token ? { 'X-NamLauncher-Identity': token } : {}
}

const getCurseForgeProxyHeaders = () => ({
  ...HTTP_HEADERS,
  'X-NamLauncher-Client': getClientInstallId()
})

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const RETRIABLE_DIRECTORY_REMOVE_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES'])

const removeInstanceDirectoryWithRetry = async (instanceRoot: string) => {
  const maxAttempts = process.platform === 'win32' ? 10 : 4
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(instanceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      if (!fs.existsSync(instanceRoot)) return
      lastError = new Error(`Instance directory still exists after delete attempt: ${instanceRoot}`)
    } catch (err) {
      lastError = err
      const code = String((err as NodeJS.ErrnoException).code || '')
      if (!RETRIABLE_DIRECTORY_REMOVE_CODES.has(code) || attempt === maxAttempts) throw err
    }

    if (attempt < maxAttempts) {
      await wait(Math.min(250 * attempt, 1_500))
    }
  }

  if (fs.existsSync(instanceRoot)) {
    throw lastError instanceof Error ? lastError : new Error(`Could not delete instance folder: ${instanceRoot}`)
  }
}

const INSTALL_CANCELLED_MESSAGE = 'Install cancelled by user.'

const normalizeInstallTaskId = (value: unknown) => {
  const taskId = String(value || '').trim()
  return /^[a-z0-9_.:-]{8,120}$/i.test(taskId) ? taskId : crypto.randomUUID()
}

const throwIfInstallCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error(INSTALL_CANCELLED_MESSAGE)
}

const isInstallCancelledError = (_err: unknown, signal?: AbortSignal) => signal?.aborted === true

const createInstallTask = (taskId: string, label: string) => {
  const existing = activeInstallTasks.get(taskId)
  if (existing) {
    existing.cancelled = true
    existing.abortController.abort()
    activeInstallTasks.delete(taskId)
  }

  if (cancelledInstallTaskIds.has(taskId)) {
    const abortedTask: InstallTask = {
      id: taskId,
      label,
      abortController: new AbortController(),
      cancelled: true,
      startedAt: Date.now()
    }
    abortedTask.abortController.abort()
    return abortedTask
  }

  const task: InstallTask = {
    id: taskId,
    label,
    abortController: new AbortController(),
    cancelled: false,
    startedAt: Date.now()
  }
  activeInstallTasks.set(taskId, task)
  return task
}

const withInstallTask = async <T>(
  request: { taskId?: unknown } | undefined,
  label: string,
  operation: (signal: AbortSignal) => Promise<T>
) => {
  const taskId = normalizeInstallTaskId(request?.taskId)
  const task = createInstallTask(taskId, label)
  try {
    throwIfInstallCancelled(task.abortController.signal)
    return await operation(task.abortController.signal)
  } catch (err) {
    if (isInstallCancelledError(err, task.abortController.signal)) {
      log.info(`Cancelled install task ${task.label} (${task.id}).`)
      return { success: false, canceled: true, cancelled: true } as T
    }
    throw err
  } finally {
    activeInstallTasks.delete(task.id)
    cancelledInstallTaskIds.delete(task.id)
  }
}

const getCurseForgeRetryDelay = (err: unknown, attempt: number) => {
  if (axios.isAxiosError(err)) {
    return retryAfterMilliseconds(err.response?.headers?.['retry-after'], Math.min(4000, 500 * (2 ** attempt)))
  }
  return Math.min(4000, 500 * (2 ** attempt))
}

const shouldRetryCurseForgeRequest = (err: unknown) => {
  if (!axios.isAxiosError(err)) return false
  if (err.code === 'ERR_CANCELED') return false
  const status = err.response?.status
  return !status
    || status === 408
    || status === 425
    || status === 429
    || status === 502
    || status === 503
    || status === 504
}

const waitForCurseForgeRetry = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new axios.CanceledError('CurseForge request canceled'))
    return
  }

  const finish = () => {
    signal?.removeEventListener('abort', abort)
    resolve()
  }
  const abort = () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    reject(new axios.CanceledError('CurseForge request canceled'))
  }
  const timer = setTimeout(finish, milliseconds)
  signal?.addEventListener('abort', abort, { once: true })
})

const curseForgeRequestGate = new ProviderRequestGate(3)
const curseForgeSharedRequests = new SharedProviderRequests()

const requestCurseForge = async <T>(
  endpoint: string,
  options: { params?: Record<string, unknown>; timeout?: number; signal?: AbortSignal } = {}
) => {
  const params = Object.fromEntries(Object.entries(options.params || {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
  const key = JSON.stringify({ endpoint, params, timeout: options.timeout || 30000 })
  return curseForgeSharedRequests.run(key, signal => performCurseForgeRequest<T>(endpoint, { ...options, signal }), options.signal)
}

const performCurseForgeRequest = async <T>(
  endpoint: string,
  options: { params?: Record<string, unknown>; timeout?: number; signal?: AbortSignal }
) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfInstallCancelled(options.signal)
    try {
      return await curseForgeRequestGate.run(async () => {
        throwIfInstallCancelled(options.signal)
        try {
          return await axios.get<T>(`${CURSEFORGE_PROXY_BASE}${endpoint}`, {
            timeout: options.timeout || 30000,
            headers: getCurseForgeProxyHeaders(),
            params: options.params,
            signal: options.signal
          })
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 429) {
            curseForgeRequestGate.defer(getCurseForgeRetryDelay(error, attempt), error)
          }
          throw error
        }
      }, options.signal)
    } catch (err) {
      if (options.signal?.aborted || axios.isCancel(err)) throw err
      lastError = err
      if (attempt >= 2 || !shouldRetryCurseForgeRequest(err)) throw err
      const delay = getCurseForgeRetryDelay(err, attempt)
      // Return the normal provider dialog for a long cooldown, rather than retry early.
      if (delay > 60_000) throw err
      log.warn(`CurseForge proxy request failed; retrying in ${delay}ms (${endpoint}).`)
      await waitForCurseForgeRetry(delay, options.signal)
    }
  }
  throw lastError
}

const removeLegacyCurseForgeApiKey = () => {
  if (!fs.existsSync(curseForgeConfigPath)) return
  try {
    fs.rmSync(curseForgeConfigPath, { force: true })
    log.info('Removed the legacy device-stored CurseForge API key; requests now use the NamLauncher server proxy.')
  } catch (err) {
    log.warn('Could not remove the legacy CurseForge API key file.', err)
  }
}

const getCurseForgeConfigStatus = async () => {
  try {
    const response = await requestCurseForge<{ data?: { configured?: boolean } }>('/status', { timeout: 15000 })
    const configured = response.data.data?.configured === true
    if (configured) removeLegacyCurseForgeApiKey()
    return { configured, source: 'proxy' }
  } catch (err) {
    log.debug('CurseForge proxy status check failed.', getCompactErrorLog(err))
    return { configured: false, source: 'proxy' }
  }
}

const getCurseForgeFailureMessage = (err: unknown, operation: 'search' | 'download') => {
  if (!axios.isAxiosError(err)) return 'CurseForge request failed unexpectedly.'
  const status = err.response?.status
  if (status === 429) return 'The NamLauncher CurseForge service is busy. Please wait a moment and try again.'
  if ((status === 403 || status === 451) && operation === 'download') return CURSEFORGE_DISTRIBUTION_DISABLED_MESSAGE
  if (status === 503) return 'The NamLauncher CurseForge service is temporarily unavailable.'
  if (status === 404 && operation === 'download') return 'The requested CurseForge file is no longer available.'
  if (err.code === 'ECONNABORTED') return 'CurseForge did not respond before the request timed out.'
  return `CurseForge request failed${status ? ` (HTTP ${status})` : ''}. Check the network and try again.`
}

const encodeStoredAccount = (account: StoredAccount) => {
  const payload: Record<string, unknown> = {
    id: account.id,
    uuid: account.uuid,
    name: account.name,
    type: account.type,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }

  if (account.type === 'msa') {
    if (!canEncryptAccountAuth()) {
      throw new Error('Microsoft account secure storage is unavailable. Configure an operating-system keyring and try again.')
    }
    try {
      payload.authEncrypted = safeStorage.encryptString(JSON.stringify(account.auth)).toString('base64')
      return payload
    } catch (err) {
      log.warn(`Could not encrypt Microsoft account data for ${account.name}.`, err)
      throw new Error('Microsoft account credentials could not be encrypted securely.')
    }
  }

  // Offline authorization contains no reusable Microsoft credential.
  payload.auth = account.auth
  return payload
}

const decodeStoredAccount = (raw: any): StoredAccount | null => {
  if (!raw || typeof raw !== 'object') return null

  const accountType = raw.type === 'offline' ? 'offline' : 'msa'
  let auth = accountType === 'offline' ? raw.auth : undefined
  if (typeof raw.authEncrypted === 'string' && raw.authEncrypted.trim()) {
    if (!canEncryptAccountAuth()) return null
    try {
      auth = JSON.parse(safeStorage.decryptString(Buffer.from(raw.authEncrypted, 'base64')))
    } catch (err) {
      log.warn(`Could not decrypt stored account ${String(raw.name || raw.id || 'unknown')}.`, err)
      return null
    }
  } else if (accountType === 'msa' && canEncryptAccountAuth() && raw.auth) {
    // Read a legacy plaintext record only while the startup migration can encrypt it immediately.
    auth = raw.auth
  }

  if (!auth) return null

  return {
    id: String(raw.id || ''),
    uuid: String(raw.uuid || ''),
    name: String(raw.name || ''),
    type: accountType,
    auth,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString())
  }
}

const readAccounts = (): StoredAccount[] => {
  const accounts = readJsonFile<any[]>(accountsPath, [])
  return Array.isArray(accounts)
    ? accounts
      .map((account) => decodeStoredAccount(account))
      .filter((account): account is StoredAccount => Boolean(account?.id && account?.uuid && account?.name))
    : []
}

const saveAccounts = (accounts: StoredAccount[]) => {
  writeJsonFile(accountsPath, accounts.map((account) => encodeStoredAccount(account)))
}

const migrateStoredAccountsEncryption = () => {
  if (!canEncryptAccountAuth()) return

  const rawAccounts = readJsonFile<any[]>(accountsPath, [])
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) return

  const needsMigration = rawAccounts.some((account) => (
    account
    && typeof account === 'object'
    && typeof account.authEncrypted !== 'string'
    && typeof account.auth !== 'undefined'
  ))
  if (!needsMigration) return

  const decodedAccounts = rawAccounts
    .map((account) => decodeStoredAccount(account))
    .filter((account): account is StoredAccount => Boolean(account?.id && account?.uuid && account?.name))

  saveAccounts(decodedAccounts)
  log.info(`Migrated ${decodedAccounts.length} account records to encrypted storage.`)
}

const toAccountSummary = (account: StoredAccount): AccountSummary => {
  return {
    id: account.id,
    uuid: account.uuid,
    name: account.name,
    type: account.type,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

const removeStoredAccount = (accountId: string) => {
  const accounts = readAccounts()
  const nextAccounts = accounts.filter((account) => account.id !== accountId)
  if (nextAccounts.length !== accounts.length) saveAccounts(nextAccounts)
  return {
    removed: nextAccounts.length !== accounts.length,
    accounts: nextAccounts.map(toAccountSummary)
  }
}

const notifyAccountSessionExpired = (account: StoredAccount, message: string) => {
  const result = removeStoredAccount(account.id)
  log.warn(`Microsoft account session expired for ${account.name}; removed stored account record.`)
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('account-session-expired', {
    accountId: account.id,
    accountName: account.name,
    message,
    accounts: result.accounts
  })
}

const upsertAccount = (auth: any, type: 'msa' | 'offline'): AccountSummary => {
  const accounts = readAccounts()
  const id = `${type}:${auth.uuid}`
  const now = new Date().toISOString()
  const existingIndex = accounts.findIndex((account) => account.id === id)
  const storedAuth = type === 'msa' && existingIndex >= 0
    ? mergeMicrosoftAuthorizationState(accounts[existingIndex].auth, auth)
    : auth

  const stored: StoredAccount = {
    id,
    uuid: storedAuth.uuid,
    name: storedAuth.name,
    type,
    auth: storedAuth,
    createdAt: existingIndex >= 0 ? accounts[existingIndex].createdAt : now,
    updatedAt: now
  }

  if (existingIndex >= 0) accounts[existingIndex] = stored
  else accounts.push(stored)

  saveAccounts(accounts)
  return toAccountSummary(stored)
}

const getOfflineUuid = (username: string) => {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const createOfflineAuth = (username: string) => ({
  access_token: '0',
  client_token: crypto.randomUUID(),
  uuid: getOfflineUuid(username),
  name: username,
  user_properties: '{}',
  meta: {
    type: 'offline',
    demo: false
  }
})

const MICROSOFT_AUTH_REFRESH_GRACE_SECONDS = 15 * 60

const decodeJwtPayload = (token?: string) => {
  try {
    const payload = String(token || '').split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, any>
  } catch {
    return null
  }
}

const getMicrosoftSessionState = (auth: any) => (
  auth?._msmc && typeof auth._msmc === 'object'
    ? auth._msmc as Record<string, any>
    : null
)

const getMicrosoftRefreshToken = (auth: any) => {
  const refreshToken = getMicrosoftSessionState(auth)?.refresh
  return typeof refreshToken === 'string' ? refreshToken.trim() : ''
}

const getMicrosoftMinecraftTokenExpiry = (auth: any) => {
  const sessionExpiry = Number(getMicrosoftSessionState(auth)?.expires_by)
  if (Number.isFinite(sessionExpiry) && sessionExpiry > 0) return sessionExpiry

  const tokenExpiry = Number(decodeJwtPayload(auth?.access_token || auth?._msmc?.mcToken)?.exp)
  return Number.isFinite(tokenExpiry) && tokenExpiry > 0 ? tokenExpiry : 0
}

const shouldRefreshMicrosoftAuthorization = (auth: any) => {
  const expiresBy = getMicrosoftMinecraftTokenExpiry(auth)
  return !expiresBy || expiresBy <= Math.floor(Date.now() / 1000) + MICROSOFT_AUTH_REFRESH_GRACE_SECONDS
}

const mergeMicrosoftAuthorizationState = (previousAuth: any, nextAuth: any) => {
  const previousSession = getMicrosoftSessionState(previousAuth) || {}
  const nextSession = getMicrosoftSessionState(nextAuth) || {}
  const refreshToken = String(nextSession.refresh || previousSession.refresh || '').trim()

  return {
    ...nextAuth,
    _msmc: {
      ...previousSession,
      ...nextSession,
      ...(refreshToken ? { refresh: refreshToken } : {})
    }
  }
}

const isMicrosoftSessionAuthenticationFailure = (err: unknown) => {
  let detail = ''
  try {
    detail = String(err instanceof Error ? err.stack || err.message : JSON.stringify(err) || err || '')
  } catch {
    detail = String(err || '')
  }
  return /invalid profile|invalid refresh token|invalid_grant|Login\.Fail\.Relog|missing its refresh token|Microsoft session .* (expired|invalid|incomplete)/i.test(detail)
}

const isExpectedLaunchUserFacingError = (value: unknown) => {
  const detail = String(value || '')
  return isOfflineUsernameValidationError(detail) || [
    /Please update NamLauncher to the latest version before launching Minecraft/i,
    /Microsoft session .*?(expired|missing its refresh token|invalid|incomplete)/i,
    /Your Microsoft session expired/i,
    /Could not log into Minecraft/i,
    /Microsoft sign-in .*Minecraft services/i,
    /Microsoft login did not return a refresh token/i,
    /Xbox Live rejected this Microsoft account/i,
    /The account (?:doesn't|does not) have an Xbox account/i,
    /Minecraft is already (?:running|launching)/i,
    /Launch cancelled by user/i
  ].some((pattern) => pattern.test(detail))
}

const normalizeMicrosoftAuthorization = (account: StoredAccount, rawAuth: any) => {
  const auth = mergeMicrosoftAuthorizationState(account.auth, rawAuth)
  const storedToken = String(auth?.access_token || '').trim()
  const fallbackToken = String(auth?._msmc?.mcToken || '').trim()
  const accessToken = storedToken && storedToken !== '0' ? storedToken : fallbackToken
  const tokenPayload = decodeJwtPayload(accessToken)
  const uuid = String(auth?.uuid || account.uuid || '').trim()
  const name = String(auth?.name || account.name || '').trim()
  const storedXuid = String(auth?.meta?.xuid || '').trim()
  const tokenXuid = String(tokenPayload?.xuid || tokenPayload?.xid || '').trim()
  const xuid = storedXuid && storedXuid !== '0' ? storedXuid : tokenXuid
  const expiresBy = getMicrosoftMinecraftTokenExpiry({
    ...auth,
    access_token: accessToken,
    _msmc: {
      ...(auth?._msmc || {}),
      mcToken: accessToken
    }
  })

  if (
    !accessToken
    || accessToken === '0'
    || !/^[a-f0-9-]{32,36}$/i.test(uuid)
    || !name
    || !xuid
    || xuid === '0'
  ) {
    throw new Error(`Microsoft session for ${account.name} is incomplete.`)
  }

  return {
    ...auth,
    access_token: accessToken,
    client_token: String(auth?.client_token || crypto.randomUUID()),
    uuid,
    name,
    user_properties: typeof auth?.user_properties === 'string' ? auth.user_properties : '{}',
    _msmc: {
      ...(auth?._msmc || {}),
      mcToken: accessToken,
      ...(expiresBy ? { expires_by: expiresBy } : {})
    },
    meta: {
      ...(auth?.meta || {}),
      type: 'msa',
      xuid
    }
  }
}

const persistAccountAuthorization = (account: StoredAccount, authorization: any) => {
  const accounts = readAccounts()
  const index = accounts.findIndex((item) => item.id === account.id)
  if (index < 0) return authorization

  accounts[index] = {
    ...accounts[index],
    uuid: authorization.uuid || account.uuid,
    name: authorization.name || account.name,
    auth: authorization,
    updatedAt: new Date().toISOString()
  }
  saveAccounts(accounts)
  return authorization
}

const refreshAccountIfNeeded = async (account: StoredAccount): Promise<any> => {
  if (account.type === 'offline') return account.auth

  try {
    const valid = await msmc.getMCLC().validate(account.auth).catch((err) => {
      log.debug(`Could not validate Microsoft account ${account.name}; refresh will be attempted.`, err)
      return false
    })
    if (valid && !shouldRefreshMicrosoftAuthorization(account.auth)) {
      try {
        const normalized = normalizeMicrosoftAuthorization(account, account.auth)
        const repaired = (
          normalized.access_token !== account.auth?.access_token
          || normalized.meta?.xuid !== account.auth?.meta?.xuid
          || normalized.meta?.type !== account.auth?.meta?.type
          || normalized._msmc?.mcToken !== account.auth?._msmc?.mcToken
          || normalized._msmc?.expires_by !== account.auth?._msmc?.expires_by
        )
        if (repaired) {
          log.info(`Repaired stored Microsoft authorization fields for ${account.name}.`)
          persistAccountAuthorization(account, normalized)
        }
        if (!getMicrosoftRefreshToken(normalized)) {
          log.warn(`Stored Microsoft authorization for ${account.name} has no refresh token; it will require sign-in when the Minecraft token expires.`)
        }
        return normalized
      } catch {
        log.warn(`Stored Microsoft authorization for ${account.name} is incomplete; refreshing it.`)
      }
    }

    if (!getMicrosoftRefreshToken(account.auth)) {
      const message = `Microsoft session for ${account.name} is missing its refresh token. Please sign in again.`
      notifyAccountSessionExpired(account, message)
      throw new Error(message)
    }

    log.info(`Refreshing Microsoft token for ${account.name}${valid ? ' before expiry' : ''}`)
    sendProgress({ type: 'auth-refresh', task: 25, total: 100 })
    const refreshedAuth = await msmc.getMCLC().refresh(account.auth, (update) => {
      const detail = redactSensitiveText(update.data || '')
      sendProgress({ type: 'auth-refresh', task: update.percent || 50, total: 100, detail })
      log.info(`[MSMC-REFRESH] ${update.type}: ${detail}`)
    })
    const refreshed = normalizeMicrosoftAuthorization(account, mergeMicrosoftAuthorizationState(account.auth, refreshedAuth))
    persistAccountAuthorization(account, refreshed)
    return refreshed
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`Microsoft session for ${account.name}`)) {
      if (readAccounts().some((item) => item.id === account.id)) {
        notifyAccountSessionExpired(account, err.message)
      }
      log.warn(err.message)
      throw err
    }
    const detail = redactSensitiveText(err instanceof Error ? err.stack || err.message : err)
    log.error(`Failed to validate or refresh Microsoft account ${account.name}`, detail)
    if (isMicrosoftSessionAuthenticationFailure(err)) {
      notifyAccountSessionExpired(account, `Microsoft session for ${account.name} expired. Please sign in again.`)
    }
    throw new Error(`Microsoft session for ${account.name} expired. Please sign in again.`)
  }
}

const resolveAccountForLaunch = async (request: LaunchRequest) => {
  if (request.accountId) {
    const account = readAccounts().find((item) => item.id === request.accountId)
    if (!account) throw new Error('Selected account was not found. Please sign in again.')
    const authorization = await refreshAccountIfNeeded(account)
    if (account.type === 'msa' && (
      !authorization?.access_token
      || authorization.access_token === '0'
      || authorization?.meta?.type !== 'msa'
      || !authorization?.meta?.xuid
      || authorization.meta.xuid === '0'
    )) {
      const message = `Microsoft session for ${account.name} is invalid. Please sign in again.`
      notifyAccountSessionExpired(account, message)
      throw new Error(message)
    }
    log.info(`Launch account selected: ${account.name} (${account.type}, ${account.uuid}).`)
    return authorization
  }

  if (request.auth) {
    return request.auth
  }

  throw new Error('Please sign in before launching Minecraft.')
}

const getMicrosoftLoginFailureMessage = (result: any) => {
  const reason = String(result?.reason || '').trim()
  const translation = String(result?.translationString || '').trim()

  if (translation === 'Cancelled.GUI' || translation === 'Cancelled.Back' || result?.type === 'Cancelled') {
    return 'Microsoft login was cancelled.'
  }
  if (translation === 'Login.Fail.MC' || /Could not log into Minecraft/i.test(reason)) {
    return 'Microsoft sign-in reached your account, but Minecraft services rejected the session. Make sure this Microsoft account owns Minecraft: Java Edition, has an Xbox profile, and is allowed to use Xbox services, then try again.'
  }
  if (translation === 'Login.Fail.Xbox'
    || /Could not log into xbox/i.test(reason)
    || /The account (?:doesn't|does not) have an Xbox account/i.test(reason)) {
    return 'Xbox Live rejected this Microsoft account. Open the Xbox app or xbox.com once, finish profile or family-safety setup, then try signing in again.'
  }
  if (translation === 'Login.Fail.Relog' || /invalid refresh token|invalid_grant/i.test(reason)) {
    return 'Microsoft rejected the saved login token. Please sign in again.'
  }
  if (translation === 'Login.Fail.MS' || /Could not log into Microsoft/i.test(reason)) {
    return 'Microsoft login could not be completed. Check the account, network connection, and Microsoft service status, then try again.'
  }

  return reason || translation || result?.type || 'Microsoft login failed. Please try again.'
}

const normalizeSkinModel = (value?: string): SkinModel => {
  const normalized = String(value || '').toLowerCase()
  return normalized === 'slim' ? 'slim' : 'classic'
}

const SAFE_SKIN_LIBRARY_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,180}$/

const isSafeSkinLibraryFileName = (value: unknown): value is string => {
  if (typeof value !== 'string' || value !== value.trim()) return false
  if (!value || value === '.' || value === '..') return false
  return SAFE_SKIN_LIBRARY_FILE_NAME_PATTERN.test(value) && path.basename(value) === value
}

const readSkinLibrary = (): StoredSkinLibrary => {
  const stored = readJsonFile<Partial<StoredSkinLibrary>>(skinsLibraryPath, {})
  const accounts = stored.accounts && typeof stored.accounts === 'object'
    ? stored.accounts
    : {}

  return {
    version: 1,
    accounts: Object.fromEntries(
      Object.entries(accounts).map(([accountId, value]) => {
        const account = value && typeof value === 'object' ? value as Partial<StoredSkinAccount> : {}
        const skins = (Array.isArray(account.skins)
          ? account.skins.filter((skin): skin is StoredSkinPreset => Boolean(
            skin
            && typeof skin.id === 'string'
            && isSafeSkinLibraryFileName(skin.fileName)
          ))
          : []).map((skin) => ({
            ...skin,
            capeFileName: isSafeSkinLibraryFileName(skin.capeFileName) ? skin.capeFileName : null,
            sourceTextureId: normalizeMinecraftTextureId(skin.sourceTextureId)
          }))
        const rawProfileCache = account.profileCache && typeof account.profileCache === 'object'
          ? account.profileCache as Partial<StoredMinecraftProfileCache>
          : null
        const cachedCapes = Array.isArray(rawProfileCache?.capes)
          ? rawProfileCache.capes.filter((cape): cape is StoredMinecraftProfileCape => Boolean(
              cape
              && typeof cape.id === 'string'
              && typeof cape.name === 'string'
              && isSafeSkinLibraryFileName(cape.fileName)
            ))
          : []
        const profileCache = rawProfileCache
          && typeof rawProfileCache.id === 'string'
          && typeof rawProfileCache.name === 'string'
          && isSafeSkinLibraryFileName(rawProfileCache.fileName)
          ? {
              id: rawProfileCache.id,
              name: rawProfileCache.name,
              model: normalizeSkinModel(rawProfileCache.model),
              fileName: rawProfileCache.fileName,
              textureId: normalizeMinecraftTextureId(rawProfileCache.textureId),
              capes: cachedCapes,
              activeCapeId: typeof rawProfileCache.activeCapeId === 'string' ? rawProfileCache.activeCapeId : null,
              refreshedAt: typeof rawProfileCache.refreshedAt === 'string' ? rawProfileCache.refreshedAt : ''
            }
          : null
        return [accountId, {
          activeSkinId: typeof account.activeSkinId === 'string' ? account.activeSkinId : null,
          activeDefaultSkinId: typeof account.activeDefaultSkinId === 'string' ? account.activeDefaultSkinId : null,
          skins,
          profileCache
        }]
      })
    )
  }
}

const writeSkinLibrary = (library: StoredSkinLibrary) => {
  ensureDir(skinsDirectory)
  writeJsonFile(skinsLibraryPath, library)
}

const getSkinAccountStore = (library: StoredSkinLibrary, accountId: string) => {
  if (!library.accounts[accountId]) {
    library.accounts[accountId] = { activeSkinId: null, activeDefaultSkinId: null, skins: [], profileCache: null }
  }
  return library.accounts[accountId]
}

const getSkinPresetPath = (preset: StoredSkinPreset) => {
  if (!isSafeSkinLibraryFileName(preset.fileName)) {
    throw new Error('Stored skin path is invalid.')
  }
  return path.join(skinsDirectory, preset.fileName)
}

const getSkinPresetCapePath = (preset: StoredSkinPreset) => {
  if (!isSafeSkinLibraryFileName(preset.capeFileName)) return null
  return path.join(skinsDirectory, preset.capeFileName)
}

const readSkinPresetBuffer = (preset: StoredSkinPreset) => {
  const filePath = getSkinPresetPath(preset)
  if (!fs.existsSync(filePath)) throw new Error('The saved skin texture could not be found.')
  const buffer = fs.readFileSync(filePath)
  if (buffer.length <= 0 || buffer.length > 2 * 1024 * 1024) {
    throw new Error('The saved skin texture is invalid.')
  }
  return buffer
}

const skinBufferToDataUrl = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`

// Author/creator: nattapat2871 (https://nattapat2871.me)
const getMinecraftProfileCachePrefix = (accountId: string) => (
  `minecraft-profile-${crypto.createHash('sha256').update(accountId).digest('hex').slice(0, 24)}`
)

const readCachedMinecraftProfile = (accountStore: StoredSkinAccount) => {
  const profileCache = accountStore.profileCache
  if (!profileCache) return null

  const skinPath = path.join(skinsDirectory, profileCache.fileName)
  if (!fs.existsSync(skinPath)) {
    accountStore.profileCache = null
    return null
  }

  try {
    const skinBuffer = decodeSkinDataUrl(skinBufferToDataUrl(fs.readFileSync(skinPath)))
    const capes = profileCache.capes.flatMap((cape) => {
      const capePath = path.join(skinsDirectory, cape.fileName)
      if (!fs.existsSync(capePath)) return []
      const buffer = fs.readFileSync(capePath)
      if (buffer.length <= 0 || buffer.length > 2 * 1024 * 1024) return []
      return [{
        id: cape.id,
        name: cape.name,
        textureDataUrl: skinBufferToDataUrl(buffer),
        active: cape.active
      }]
    })
    return {
      currentSkin: {
        id: profileCache.id,
        name: profileCache.name,
        model: profileCache.model,
        textureId: normalizeMinecraftTextureId(profileCache.textureId),
        textureDataUrl: skinBufferToDataUrl(skinBuffer),
        source: 'minecraft'
      },
      capes,
      activeCapeId: profileCache.activeCapeId || capes.find((cape) => cape.active)?.id || null
    }
  } catch (err) {
    log.debug('Could not read the cached Minecraft skin profile.', err)
    accountStore.profileCache = null
    return null
  }
}

const cacheMinecraftProfile = (
  account: StoredAccount,
  accountStore: StoredSkinAccount,
  currentSkin: { id: string; name: string; model: SkinModel; textureId?: string | null; textureDataUrl: string } | null,
  capes: Array<{ id: string; name: string; textureDataUrl: string; active: boolean }>,
  activeCapeId: string | null
) => {
  if (!currentSkin?.textureDataUrl) return

  ensureDir(skinsDirectory)
  const prefix = getMinecraftProfileCachePrefix(account.id)
  const skinFileName = `${prefix}.png`
  fs.writeFileSync(path.join(skinsDirectory, skinFileName), decodeSkinDataUrl(currentSkin.textureDataUrl))

  const cachedCapes = capes.map((cape) => {
    const capeKey = crypto.createHash('sha256').update(cape.id).digest('hex').slice(0, 16)
    const fileName = `${prefix}-cape-${capeKey}.png`
    fs.writeFileSync(path.join(skinsDirectory, fileName), decodeSkinDataUrl(cape.textureDataUrl))
    return { id: cape.id, name: cape.name, fileName, active: cape.active }
  })
  const retainedFiles = new Set([skinFileName, ...cachedCapes.map((cape) => cape.fileName)])
  for (const entry of fs.readdirSync(skinsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || retainedFiles.has(entry.name)) continue
    fs.rmSync(path.join(skinsDirectory, entry.name), { force: true })
  }

  accountStore.profileCache = {
    id: currentSkin.id,
    name: currentSkin.name,
    model: currentSkin.model,
    fileName: skinFileName,
    textureId: normalizeMinecraftTextureId(currentSkin.textureId),
    capes: cachedCapes,
    activeCapeId,
    refreshedAt: new Date().toISOString()
  }
}

const DEFAULT_SKIN_ASSET_REVISION = '15b0c1e447cc2fff34ca54d735aaa596a0aab2b0'
const getDefaultSkinTextureUrl = (name: string, model: SkinModel) => (
  `https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/${DEFAULT_SKIN_ASSET_REVISION}/assets/minecraft/textures/entity/player/${model === 'slim' ? 'slim' : 'wide'}/${name.toLowerCase()}.png`
)
const DEFAULT_SKIN_PRESETS = [
  { id: 'steve', name: 'Steve', model: 'classic' as SkinModel },
  { id: 'alex', name: 'Alex', model: 'slim' as SkinModel },
  { id: 'noor', name: 'Noor', model: 'classic' as SkinModel },
  { id: 'sunny', name: 'Sunny', model: 'slim' as SkinModel },
  { id: 'ari', name: 'Ari', model: 'slim' as SkinModel },
  { id: 'zuri', name: 'Zuri', model: 'classic' as SkinModel },
  { id: 'makena', name: 'Makena', model: 'classic' as SkinModel },
  { id: 'kai', name: 'Kai', model: 'classic' as SkinModel },
  { id: 'efe', name: 'Efe', model: 'slim' as SkinModel }
].map((skin) => ({
  ...skin,
  textureUrl: getDefaultSkinTextureUrl(skin.name, skin.model)
}))

const getDefaultSkinPreset = (defaultSkinId?: string) => {
  const id = String(defaultSkinId || '').trim().toLowerCase()
  const preset = DEFAULT_SKIN_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error('Choose a valid default skin.')
  return preset
}

const getDefaultSkinCacheFileName = (defaultSkinId: string) => `default-${defaultSkinId}.png`

const getDefaultSkinCachePath = (defaultSkinId: string) => {
  const fileName = getDefaultSkinCacheFileName(defaultSkinId)
  if (!isSafeSkinLibraryFileName(fileName)) throw new Error('Default skin path is invalid.')
  return path.join(skinsDirectory, fileName)
}

const downloadDefaultSkinBuffer = async (defaultSkin: ReturnType<typeof getDefaultSkinPreset>) => {
  const cachePath = getDefaultSkinCachePath(defaultSkin.id)
  if (fs.existsSync(cachePath)) {
    return decodeSkinDataUrl(skinBufferToDataUrl(fs.readFileSync(cachePath)))
  }

  try {
    const response = await axios.get<ArrayBuffer>(defaultSkin.textureUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: HTTP_HEADERS,
      maxContentLength: 2 * 1024 * 1024
    })
    const buffer = decodeSkinDataUrl(skinBufferToDataUrl(Buffer.from(response.data)))
    ensureDir(skinsDirectory)
    fs.writeFileSync(cachePath, buffer)
    return buffer
  } catch (err) {
    throw new Error(getSkinApiError(err, 'Could not download the default skin.'))
  }
}

const decodeSkinDataUrl = (rawDataUrl?: string) => {
  const dataUrl = String(rawDataUrl || '')
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error('Skin texture must be a PNG file.')

  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length <= 0 || buffer.length > 2 * 1024 * 1024) {
    throw new Error('Skin texture must be smaller than 2 MB.')
  }

  const pngSignature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('Skin texture is not a valid PNG file.')
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error('Minecraft skins must be 64x64 or legacy 64x32 pixels.')
  }

  return buffer
}

const getSkinAccount = (accountId?: string) => {
  const cleanAccountId = String(accountId || '').trim()
  const account = readAccounts().find((item) => item.id === cleanAccountId)
  if (!account) throw new Error('Select a valid player profile before changing skins.')
  return account
}

const getSkinApiError = (err: unknown, fallback: string) => {
  if (axios.isAxiosError(err)) {
    const responseMessage = typeof err.response?.data === 'object' && err.response?.data
      ? String((err.response.data as any).errorMessage || (err.response.data as any).error || '')
      : ''
    if (err.response?.status === 401 || err.response?.status === 403) {
      return 'Your Microsoft session expired. Sign in again before changing the skin.'
    }
    if (responseMessage) return responseMessage
  }
  return err instanceof Error && err.message ? err.message : fallback
}

const normalizeMinecraftTextureUrl = (rawUrl?: string | null) => {
  const value = String(rawUrl || '').trim()
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'textures.minecraft.net') {
      return ''
    }
    parsed.protocol = 'https:'
    parsed.port = ''
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.href
  } catch {
    return ''
  }
}

const getMinecraftTextureIdFromUrl = (rawUrl?: string | null) => {
  const normalizedUrl = normalizeMinecraftTextureUrl(rawUrl)
  if (!normalizedUrl) return null

  try {
    const texturePath = new URL(normalizedUrl).pathname
    const match = texturePath.match(/^\/texture\/([a-f0-9]{64})\/?$/i)
    return normalizeMinecraftTextureId(match?.[1])
  } catch {
    return null
  }
}

const getMinecraftProfile = async (account: StoredAccount) => {
  const auth = await refreshAccountIfNeeded(account)
  try {
    const response = await axios.get<any>('https://api.minecraftservices.com/minecraft/profile', {
      timeout: 20000,
      headers: {
        ...HTTP_HEADERS,
        Authorization: `Bearer ${auth.access_token}`
      }
    })
    return { auth, profile: response.data || {} }
  } catch (err) {
    throw new Error(getSkinApiError(err, 'Could not load the Minecraft skin profile.'))
  }
}

const downloadMinecraftTextureBuffer = async (rawUrl?: string | null) => {
  const url = normalizeMinecraftTextureUrl(rawUrl)
  if (!url) return null

  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: HTTP_HEADERS,
      maxContentLength: 2 * 1024 * 1024
    })
    const buffer = Buffer.from(response.data)
    return buffer.length > 0 && buffer.length <= 2 * 1024 * 1024 ? buffer : null
  } catch (err) {
    log.debug('Could not download Minecraft texture for preview.', err)
    return null
  }
}

const downloadMinecraftTexture = async (rawUrl?: string | null) => {
  const buffer = await downloadMinecraftTextureBuffer(rawUrl)
  return buffer ? skinBufferToDataUrl(buffer) : null
}

const parseMinecraftProfileInput = (rawInput?: string) => {
  const input = String(rawInput || '').trim()
  if (!input) return ''

  try {
    const urlInput = /^(?:www\.)?namemc\.com\//i.test(input) ? `https://${input}` : input
    const parsed = new URL(urlInput)
    if (!['namemc.com', 'www.namemc.com'].includes(parsed.hostname.toLowerCase())) return ''
    const parts = parsed.pathname.split('/').filter(Boolean)
    const profileIndex = parts.findIndex((part) => part.toLowerCase() === 'profile')
    return decodeURIComponent(profileIndex >= 0 ? parts[profileIndex + 1] || '' : '').split('.')[0].trim()
  } catch {
    return input
  }
}

const resolvePublicMinecraftProfile = async (rawInput?: string) => {
  const requestedProfile = parseMinecraftProfileInput(rawInput)
  const compactUuid = requestedProfile.replace(/-/g, '')

  if (/^[a-f0-9]{32}$/i.test(compactUuid)) {
    return { uuid: compactUuid.toLowerCase(), name: requestedProfile }
  }

  if (!/^[A-Za-z0-9_]{3,16}$/.test(requestedProfile)) {
    throw new Error('Enter a Minecraft player name or a valid NameMC profile link.')
  }

  const profileResponse = await axios.get<any>(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(requestedProfile)}`,
    { timeout: 20000, headers: HTTP_HEADERS }
  )
  const uuid = String(profileResponse.data?.id || '').replace(/-/g, '')
  const name = String(profileResponse.data?.name || requestedProfile)
  if (!/^[a-f0-9]{32}$/i.test(uuid)) throw new Error('Minecraft player profile was not found.')
  return { uuid: uuid.toLowerCase(), name }
}

const getPublicMinecraftTextures = async (profileUuid: string, fallbackName = '') => {
  const compactUuid = String(profileUuid || '').replace(/-/g, '')
  if (!/^[a-f0-9]{32}$/i.test(compactUuid)) {
    throw new Error('Minecraft player profile was not found.')
  }

  const sessionResponse = await axios.get<any>(
    `https://sessionserver.mojang.com/session/minecraft/profile/${compactUuid}?unsigned=false`,
    { timeout: 20000, headers: HTTP_HEADERS }
  )
  const textureProperty = Array.isArray(sessionResponse.data?.properties)
    ? sessionResponse.data.properties.find((property: any) => property?.name === 'textures')
    : null
  if (!textureProperty?.value) throw new Error('This Minecraft profile does not have a skin texture.')

  const texturePayload = JSON.parse(Buffer.from(String(textureProperty.value), 'base64').toString('utf8'))
  const skinUrl = normalizeMinecraftTextureUrl(texturePayload?.textures?.SKIN?.url)
  const capeUrl = normalizeMinecraftTextureUrl(texturePayload?.textures?.CAPE?.url)
  if (!skinUrl) throw new Error('This Minecraft profile does not have a skin texture.')

  return {
    uuid: compactUuid.toLowerCase(),
    name: String(sessionResponse.data?.name || fallbackName || compactUuid),
    skinUrl,
    textureId: getMinecraftTextureIdFromUrl(skinUrl),
    capeUrl,
    model: normalizeSkinModel(texturePayload?.textures?.SKIN?.metadata?.model)
  }
}

const setMinecraftCape = async (auth: any, capeId?: string | null) => {
  const headers = {
    ...HTTP_HEADERS,
    Authorization: `Bearer ${auth.access_token}`
  }

  try {
    if (capeId) {
      await axios.put(
        'https://api.minecraftservices.com/minecraft/profile/capes/active',
        { capeId },
        { timeout: 20000, headers }
      )
    } else {
      await axios.delete('https://api.minecraftservices.com/minecraft/profile/capes/active', {
        timeout: 20000,
        headers
      })
    }
  } catch (err) {
    throw new Error(getSkinApiError(err, 'Could not update the active cape.'))
  }
}

const uploadMinecraftSkin = async (
  account: StoredAccount,
  buffer: Buffer,
  model: SkinModel,
  capeId?: string | null,
  updateCape = true
) => {
  const auth = await refreshAccountIfNeeded(account)
  const form = new FormData()
  form.append('variant', model)
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'namlauncher-skin.png')

  try {
    await axios.post('https://api.minecraftservices.com/minecraft/profile/skins', form, {
      timeout: 30000,
      maxBodyLength: 3 * 1024 * 1024,
      headers: {
        ...HTTP_HEADERS,
        Authorization: `Bearer ${auth.access_token}`
      }
    })
    if (updateCape) await setMinecraftCape(auth, capeId)
  } catch (err) {
    throw new Error(getSkinApiError(err, 'Could not upload the Minecraft skin.'))
  }
}

const resetMinecraftSkin = async (account: StoredAccount) => {
  const auth = await refreshAccountIfNeeded(account)
  try {
    await axios.delete('https://api.minecraftservices.com/minecraft/profile/skins/active', {
      timeout: 20000,
      headers: {
        ...HTTP_HEADERS,
        Authorization: `Bearer ${auth.access_token}`
      }
    })
  } catch (err) {
    throw new Error(getSkinApiError(err, 'Could not reset the Minecraft skin.'))
  }
}

const getPublicSkinLibrary = async (accountId?: string, refreshRemote = true) => {
  const account = getSkinAccount(accountId)
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)
  accountStore.skins = accountStore.skins.filter((preset) => fs.existsSync(getSkinPresetPath(preset)))
  if (account.type === 'offline' && !accountStore.activeSkinId && !accountStore.activeDefaultSkinId) {
    accountStore.activeDefaultSkinId = 'steve'
  }

  const savedSkins = accountStore.skins.map((preset) => ({
    id: preset.id,
    name: preset.name,
    model: preset.model,
    capeId: preset.capeId ?? null,
    capeTextureDataUrl: (() => {
      const capePath = getSkinPresetCapePath(preset)
      return capePath && fs.existsSync(capePath) ? skinBufferToDataUrl(fs.readFileSync(capePath)) : null
    })(),
    sourceProfileUuid: preset.sourceProfileUuid ?? null,
    sourceProfileName: preset.sourceProfileName ?? null,
    sourceTextureId: normalizeMinecraftTextureId(preset.sourceTextureId),
    textureDataUrl: skinBufferToDataUrl(readSkinPresetBuffer(preset)),
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt
  }))

  let currentSkin: any = null
  let capes: any[] = []
  let activeCapeId: string | null = null
  let warning: string | null = null
  const useCurrentSkin = (id: string, model: SkinModel, textureDataUrl: string, textureId?: string | null) => {
    currentSkin = {
      id,
      name: 'Minecraft profile',
      model,
      textureId: normalizeMinecraftTextureId(textureId),
      textureDataUrl,
      source: 'minecraft'
    }

    const currentHash = crypto.createHash('sha256').update(textureDataUrl).digest('hex')
    const matchingPreset = savedSkins.find((skin) => (
      crypto.createHash('sha256').update(skin.textureDataUrl).digest('hex') === currentHash
    ))
    const selectedPreset = savedSkins.find((skin) => skin.id === accountStore.activeSkinId)
    const selectedAt = selectedPreset?.updatedAt ? Date.parse(selectedPreset.updatedAt) : 0
    const recentlySelected = Boolean(selectedPreset && Number.isFinite(selectedAt) && Date.now() - selectedAt < 120000)

    if (account.type === 'msa' && accountStore.activeDefaultSkinId) {
      try {
        const defaultSkin = getDefaultSkinPreset(accountStore.activeDefaultSkinId)
        const cachePath = getDefaultSkinCachePath(defaultSkin.id)
        const defaultTextureDataUrl = fs.existsSync(cachePath)
          ? skinBufferToDataUrl(fs.readFileSync(cachePath))
          : ''
        const defaultHash = defaultTextureDataUrl
          ? crypto.createHash('sha256').update(defaultTextureDataUrl).digest('hex')
          : ''
        if (!defaultHash || defaultHash !== currentHash) accountStore.activeDefaultSkinId = null
      } catch {
        accountStore.activeDefaultSkinId = null
      }
    }

    if (!accountStore.activeDefaultSkinId) {
      accountStore.activeSkinId = matchingPreset?.id || (recentlySelected ? selectedPreset!.id : id)
    }
  }

  const cachedProfile = readCachedMinecraftProfile(accountStore)
  if (cachedProfile) {
    useCurrentSkin(
      cachedProfile.currentSkin.id,
      cachedProfile.currentSkin.model,
      cachedProfile.currentSkin.textureDataUrl,
      cachedProfile.currentSkin.textureId
    )
    currentSkin.name = cachedProfile.currentSkin.name
    capes = cachedProfile.capes
    activeCapeId = cachedProfile.activeCapeId
  }

  if (account.type === 'msa' && refreshRemote) {
    try {
      const { profile } = await getMinecraftProfile(account)
      const profileSkins = Array.isArray(profile.skins) ? profile.skins : []
      const activeSkin = profileSkins.find((skin: any) => skin?.state === 'ACTIVE') || profileSkins[0]
      const profileCapes = Array.isArray(profile.capes) ? profile.capes : []
      const [textureDataUrl, downloadedCapes] = await Promise.all([
        downloadMinecraftTexture(activeSkin?.url),
        Promise.all(profileCapes.map(async (cape: any) => ({
          id: String(cape.id || ''),
          name: String(cape.alias || cape.name || 'Minecraft cape'),
          textureDataUrl: await downloadMinecraftTexture(cape.url),
          active: cape.state === 'ACTIVE'
        })))
      ])

      if (activeSkin && textureDataUrl) {
        useCurrentSkin(
          `minecraft:${String(activeSkin.id || crypto.createHash('sha1').update(activeSkin.url || '').digest('hex'))}`,
          normalizeSkinModel(activeSkin.variant),
          textureDataUrl,
          getMinecraftTextureIdFromUrl(activeSkin.url)
        )
      }

      capes = downloadedCapes
      capes = capes.filter((cape) => cape.id && cape.textureDataUrl)
      activeCapeId = capes.find((cape) => cape.active)?.id || null

      if (!currentSkin) {
        const publicTextures = await getPublicMinecraftTextures(account.uuid, account.name)
        const publicTextureDataUrl = await downloadMinecraftTexture(publicTextures.skinUrl)
        if (publicTextureDataUrl) {
          useCurrentSkin(
            `minecraft-public:${publicTextures.uuid}`,
            publicTextures.model,
            publicTextureDataUrl,
            publicTextures.textureId
          )
        }
      }
      cacheMinecraftProfile(account, accountStore, currentSkin, capes, activeCapeId)
    } catch (err) {
      warning = getSkinApiError(err, 'Could not refresh the Microsoft skin profile.')
      try {
        const publicTextures = await getPublicMinecraftTextures(account.uuid, account.name)
        const publicTextureDataUrl = await downloadMinecraftTexture(publicTextures.skinUrl)
        if (publicTextureDataUrl) {
          useCurrentSkin(
            `minecraft-public:${publicTextures.uuid}`,
            publicTextures.model,
            publicTextureDataUrl,
            publicTextures.textureId
          )
          cacheMinecraftProfile(account, accountStore, currentSkin, capes, activeCapeId)
        }
      } catch (publicErr) {
        log.debug(`Could not load public skin fallback for ${account.name}.`, publicErr)
      }
    }
  }

  if (account.type === 'offline' && accountStore.activeSkinId) {
    const activePreset = savedSkins.find((skin) => skin.id === accountStore.activeSkinId)
    if (!activePreset) accountStore.activeSkinId = null
  }

  let effectiveSkin: any = currentSkin
  if (accountStore.activeDefaultSkinId) {
    try {
      const defaultSkin = getDefaultSkinPreset(accountStore.activeDefaultSkinId)
      const cachePath = getDefaultSkinCachePath(defaultSkin.id)
      effectiveSkin = {
        id: `default:${defaultSkin.id}`,
        name: defaultSkin.name,
        model: defaultSkin.model,
        textureDataUrl: fs.existsSync(cachePath)
          ? skinBufferToDataUrl(fs.readFileSync(cachePath))
          : defaultSkin.textureUrl,
        source: 'default'
      }
      accountStore.activeSkinId = null
    } catch {
      accountStore.activeDefaultSkinId = null
    }
  }

  if (!accountStore.activeDefaultSkinId && accountStore.activeSkinId) {
    const activePreset = savedSkins.find((skin) => skin.id === accountStore.activeSkinId)
    if (activePreset) effectiveSkin = activePreset
  }

  if (account.type === 'offline' && !effectiveSkin) {
    const steve = getDefaultSkinPreset('steve')
    effectiveSkin = {
      id: 'default:steve',
      name: steve.name,
      model: steve.model,
      textureDataUrl: steve.textureUrl,
      source: 'default'
    }
    accountStore.activeDefaultSkinId = 'steve'
  }

  writeSkinLibrary(library)
  return {
    accountId: account.id,
    accountUuid: account.uuid,
    accountName: account.name,
    accountType: account.type,
    selectedSkinId: accountStore.activeDefaultSkinId ? `default:${accountStore.activeDefaultSkinId}` : (accountStore.activeSkinId || currentSkin?.id || null),
    activeDefaultSkinId: accountStore.activeDefaultSkinId || null,
    currentSkin,
    effectiveSkin,
    savedSkins,
    capes,
    activeCapeId,
    warning,
    offlineOnly: account.type === 'offline'
  }
}

const saveSkinPreset = async (request: SkinSaveRequest) => {
  const account = getSkinAccount(request.accountId)
  const buffer = decodeSkinDataUrl(request.textureDataUrl)
  const model = normalizeSkinModel(request.model)
  const name = String(request.name || 'Imported skin').trim().slice(0, 48) || 'Imported skin'
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)
  const now = new Date().toISOString()
  const requestedId = String(request.skinId || '').trim()
  const existingIndex = requestedId
    ? accountStore.skins.findIndex((skin) => skin.id === requestedId && skin.accountId === account.id)
    : -1

  let preset: StoredSkinPreset
  if (existingIndex >= 0) {
    const existing = accountStore.skins[existingIndex]
    preset = {
      ...existing,
      name,
      model,
      capeId: request.capeId ?? null,
      sourceProfileUuid: null,
      sourceProfileName: null,
      sourceTextureId: null,
      updatedAt: now
    }
    fs.writeFileSync(getSkinPresetPath(preset), buffer)
    accountStore.skins[existingIndex] = preset
  } else {
    const id = crypto.randomUUID()
    preset = {
      id,
      accountId: account.id,
      name,
      model,
      fileName: `${id}.png`,
      capeId: request.capeId ?? null,
      createdAt: now,
      updatedAt: now
    }
    ensureDir(skinsDirectory)
    fs.writeFileSync(getSkinPresetPath(preset), buffer)
    accountStore.skins.unshift(preset)
  }

  writeSkinLibrary(library)
  if (request.activate !== false) {
    if (account.type === 'msa') {
      await uploadMinecraftSkin(account, buffer, model, preset.capeId)
    }
    accountStore.activeDefaultSkinId = null
    accountStore.activeSkinId = preset.id
  }

  writeSkinLibrary(library)
  return getPublicSkinLibrary(account.id)
}

const saveDefaultSkinPreset = async (request: SkinDefaultRequest) => {
  const account = getSkinAccount(request.accountId)
  const defaultSkin = getDefaultSkinPreset(request.defaultSkinId)
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)
  if (accountStore.activeDefaultSkinId === defaultSkin.id) {
    accountStore.activeSkinId = null
    writeSkinLibrary(library)
    return getPublicSkinLibrary(account.id)
  }

  const defaultSkinBuffer = await downloadDefaultSkinBuffer(defaultSkin)
  if (account.type === 'msa') {
    await uploadMinecraftSkin(account, defaultSkinBuffer, defaultSkin.model, null, false)
  }
  accountStore.activeDefaultSkinId = defaultSkin.id
  accountStore.activeSkinId = null
  writeSkinLibrary(library)
  return getPublicSkinLibrary(account.id)
}

const importSkinByPlayerName = async (request: SkinImportRequest) => {
  const account = getSkinAccount(request.accountId)

  try {
    const resolved = await resolvePublicMinecraftProfile(request.playerName)
    const textures = await getPublicMinecraftTextures(resolved.uuid, resolved.name)
    const skinBuffer = await downloadMinecraftTextureBuffer(textures.skinUrl)
    if (!skinBuffer) throw new Error('Could not download this player skin from Mojang.')
    decodeSkinDataUrl(skinBufferToDataUrl(skinBuffer))
    const capeBuffer = account.type === 'offline'
      ? await downloadMinecraftTextureBuffer(textures.capeUrl)
      : null

    const library = readSkinLibrary()
    const accountStore = getSkinAccountStore(library, account.id)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const preset: StoredSkinPreset = {
      id,
      accountId: account.id,
      name: `${textures.name} skin`,
      model: textures.model,
      fileName: `${id}.png`,
      capeFileName: capeBuffer ? `${id}-cape.png` : null,
      capeId: null,
      sourceProfileUuid: textures.uuid,
      sourceProfileName: textures.name,
      sourceTextureId: textures.textureId,
      createdAt: now,
      updatedAt: now
    }

    ensureDir(skinsDirectory)
    fs.writeFileSync(getSkinPresetPath(preset), skinBuffer)
    const capePath = getSkinPresetCapePath(preset)
    if (capeBuffer && capePath) fs.writeFileSync(capePath, capeBuffer)
    accountStore.skins.unshift(preset)

    if (account.type === 'msa') {
      await uploadMinecraftSkin(account, skinBuffer, textures.model, null, false)
    }

    accountStore.activeDefaultSkinId = null
    accountStore.activeSkinId = preset.id
    writeSkinLibrary(library)
    log.info(`Imported Minecraft skin for ${account.name} from public profile ${textures.name}.`)
    return getPublicSkinLibrary(account.id)
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      throw new Error(`Minecraft player "${parseMinecraftProfileInput(request.playerName)}" was not found.`)
    }
    throw new Error(getSkinApiError(err, 'Could not import the skin from this Minecraft player.'))
  }
}

const activateSkinPreset = async (request: SkinActionRequest) => {
  const account = getSkinAccount(request.accountId)
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)
  const skinId = String(request.skinId || '').trim()
  const preset = accountStore.skins.find((skin) => skin.id === skinId && skin.accountId === account.id)
  if (!preset && account.type === 'msa' && /^minecraft(?:-public)?:/.test(skinId)) {
    if (accountStore.activeSkinId === skinId && !accountStore.activeDefaultSkinId) {
      return getPublicSkinLibrary(account.id)
    }
    accountStore.activeDefaultSkinId = null
    accountStore.activeSkinId = skinId
    writeSkinLibrary(library)
    return getPublicSkinLibrary(account.id)
  }
  if (!preset) throw new Error('The selected skin does not belong to this player profile.')
  if (accountStore.activeSkinId === preset.id && !accountStore.activeDefaultSkinId) {
    return getPublicSkinLibrary(account.id)
  }

  if (account.type === 'msa') {
    await uploadMinecraftSkin(account, readSkinPresetBuffer(preset), preset.model, preset.capeId)
  }

  preset.updatedAt = new Date().toISOString()
  accountStore.activeDefaultSkinId = null
  accountStore.activeSkinId = preset.id
  writeSkinLibrary(library)
  return getPublicSkinLibrary(account.id)
}

const deleteSkinPreset = async (request: SkinActionRequest) => {
  const account = getSkinAccount(request.accountId)
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)
  const skinId = String(request.skinId || '').trim()
  const preset = accountStore.skins.find((skin) => skin.id === skinId && skin.accountId === account.id)
  if (!preset) throw new Error('The selected skin does not belong to this player profile.')

  const filePath = getSkinPresetPath(preset)
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  const capePath = getSkinPresetCapePath(preset)
  if (capePath && fs.existsSync(capePath)) fs.rmSync(capePath, { force: true })
  accountStore.skins = accountStore.skins.filter((skin) => skin.id !== skinId)
  if (accountStore.activeSkinId === skinId) accountStore.activeSkinId = null
  writeSkinLibrary(library)
  return getPublicSkinLibrary(account.id)
}

const resetActiveSkin = async (request: SkinActionRequest) => {
  const account = getSkinAccount(request.accountId)
  const library = readSkinLibrary()
  const accountStore = getSkinAccountStore(library, account.id)

  if (account.type === 'msa') {
    await resetMinecraftSkin(account)
  }

  accountStore.activeDefaultSkinId = null
  accountStore.activeSkinId = null
  writeSkinLibrary(library)
  return getPublicSkinLibrary(account.id)
}

let offlineSkinServer: Server | null = null
let offlineSkinServerPort = 0
const offlineSkinServerToken = crypto.randomBytes(24).toString('hex')

const getOfflineSkinSigningKeys = () => {
  const injectorDirectory = path.join(userDataPath, 'offline-skin-loader')
  const privateKeyPath = path.join(injectorDirectory, 'texture-signing-private.pem')
  const publicKeyPath = path.join(injectorDirectory, 'texture-signing-public.pem')
  ensureDir(injectorDirectory)

  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 })
    fs.writeFileSync(publicKeyPath, publicKey, 'utf8')
  }

  return {
    privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
    publicKey: fs.readFileSync(publicKeyPath, 'utf8')
  }
}

const getOfflineSkinMetadata = () => ({
  meta: {
    serverName: 'NamLauncher Offline Skins',
    implementationName: 'NamLauncher',
    implementationVersion: app.getVersion(),
    'feature.no_mojang_namespace': true,
    'feature.legacy_skin_api': true,
    'feature.enable_mojang_anti_features': true,
    'feature.enable_profile_key': false,
    'feature.username_check': true
  },
  skinDomains: ['127.0.0.1'],
  signaturePublickey: getOfflineSkinSigningKeys().publicKey
})

const getActiveOfflineSkin = (accountId: string) => {
  const account = readAccounts().find((item) => item.id === accountId && item.type === 'offline')
  if (!account) return null
  const accountStore = readSkinLibrary().accounts[account.id]
  if (accountStore?.activeDefaultSkinId) {
    try {
      const defaultSkin = getDefaultSkinPreset(accountStore.activeDefaultSkinId)
      const fileName = getDefaultSkinCacheFileName(defaultSkin.id)
      const filePath = getDefaultSkinCachePath(defaultSkin.id)
      if (fs.existsSync(filePath)) {
        return {
          account,
          preset: {
            id: `default:${defaultSkin.id}`,
            accountId: account.id,
            name: defaultSkin.name,
            model: defaultSkin.model,
            fileName,
            capeId: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString()
          }
        }
      }
    } catch {
      return null
    }
  }
  const preset = accountStore?.skins.find((skin) => skin.id === accountStore.activeSkinId)
  if (!preset || !fs.existsSync(getSkinPresetPath(preset))) return null
  return { account, preset }
}

const getOfflineTexturePayload = (account: StoredAccount, preset: StoredSkinPreset, port: number) => {
  const skinBuffer = readSkinPresetBuffer(preset)
  const skinHash = crypto.createHash('sha256').update(skinBuffer).digest('hex')
  const capePath = getSkinPresetCapePath(preset)
  const capeBuffer = capePath && fs.existsSync(capePath) ? fs.readFileSync(capePath) : null
  const capeHash = capeBuffer ? crypto.createHash('sha256').update(capeBuffer).digest('hex') : null
  const textureBase = `http://127.0.0.1:${port}/textures/${offlineSkinServerToken}/${encodeURIComponent(account.id)}`
  const payload = {
    timestamp: Date.now(),
    profileId: account.uuid.replace(/-/g, ''),
    profileName: account.name,
    textures: {
      SKIN: {
        url: `${textureBase}/${skinHash}.png`,
        ...(preset.model === 'slim' ? { metadata: { model: 'slim' } } : {})
      },
      ...(capeHash ? { CAPE: { url: `${textureBase}/${capeHash}.png` } } : {})
    }
  }
  const value = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const signature = crypto.createSign('RSA-SHA1')
    .update(value, 'utf8')
    .sign(getOfflineSkinSigningKeys().privateKey, 'base64')
  return { value, signature, skinHash, capeHash }
}

const sendOfflineSkinJson = (response: any, status: number, body?: unknown) => {
  if (body === undefined) {
    response.writeHead(status, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  const encoded = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(encoded.length),
    'Cache-Control': 'no-store'
  })
  response.end(encoded)
}

const ensureOfflineSkinServer = async () => {
  if (offlineSkinServer && offlineSkinServerPort) return offlineSkinServerPort

  offlineSkinServer = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      const parts = requestUrl.pathname.split('/').filter(Boolean)
      const serveTexture = (accountId: string, requestedHash?: string) => {
        const active = getActiveOfflineSkin(accountId)
        if (!active) return false
        const texture = getOfflineTexturePayload(active.account, active.preset, offlineSkinServerPort)
        const skinPath = getSkinPresetPath(active.preset)
        const capePath = getSkinPresetCapePath(active.preset)
        const isCape = Boolean(requestedHash && texture.capeHash && requestedHash === texture.capeHash)
        const isSkin = !requestedHash || requestedHash === texture.skinHash
        const texturePath = isCape ? capePath : isSkin ? skinPath : null
        if (!texturePath || !fs.existsSync(texturePath)) return false
        const buffer = fs.readFileSync(texturePath)
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff'
        })
        response.end(buffer)
        return true
      }

      // Backward-compatible texture endpoints used by beta.11 launch metadata.
      if (parts.length === 3 && ['skin', 'cape'].includes(parts[0]) && parts[1] === offlineSkinServerToken) {
        const accountId = decodeURIComponent(parts[2].replace(/\.png$/i, ''))
        if (parts[0] === 'skin' && serveTexture(accountId)) return
        const active = getActiveOfflineSkin(accountId)
        const capePath = active ? getSkinPresetCapePath(active.preset) : null
        if (capePath && fs.existsSync(capePath)) {
          const buffer = fs.readFileSync(capePath)
          response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buffer.length), 'Cache-Control': 'no-store' })
          response.end(buffer)
          return
        }
      }

      if (parts[0] === 'textures' && parts[1] === offlineSkinServerToken && parts.length === 4) {
        const accountId = decodeURIComponent(parts[2])
        const requestedHash = parts[3].replace(/\.png$/i, '')
        if (serveTexture(accountId, requestedHash)) return
      }

      if (parts[0] === 'yggdrasil' && parts[1] === offlineSkinServerToken && parts.length >= 3) {
        const accountId = decodeURIComponent(parts[2])
        const active = getActiveOfflineSkin(accountId)
        if (!active) {
          sendOfflineSkinJson(response, 204)
          return
        }

        if (parts.length === 3) {
          sendOfflineSkinJson(response, 200, getOfflineSkinMetadata())
          return
        }

        if (
          parts.length === 8
          && parts.slice(3, 7).join('/') === 'sessionserver/session/minecraft/profile'
        ) {
          const requestedUuid = String(parts[7] || '').replace(/-/g, '').toLowerCase()
          if (requestedUuid !== active.account.uuid.replace(/-/g, '').toLowerCase()) {
            sendOfflineSkinJson(response, 204)
            return
          }
          const texture = getOfflineTexturePayload(active.account, active.preset, offlineSkinServerPort)
          sendOfflineSkinJson(response, 200, {
            id: requestedUuid,
            name: active.account.name,
            properties: [{ name: 'textures', value: texture.value, signature: texture.signature }]
          })
          return
        }

        if (parts.length === 6 && parts.slice(3, 5).join('/') === 'skins/MinecraftSkins') {
          if (serveTexture(accountId)) return
        }

        if (parts.slice(3).join('/') === 'sessionserver/session/minecraft/join') {
          sendOfflineSkinJson(response, 204)
          return
        }
      }

      response.writeHead(404).end()
    } catch {
      response.writeHead(500).end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    const server = offlineSkinServer
    if (!server) {
      reject(new Error('Could not create the offline skin server.'))
      return
    }
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      offlineSkinServerPort = typeof address === 'object' && address ? address.port : 0
      resolve()
    })
  })

  return offlineSkinServerPort
}

const getFileSha256 = (filePath: string) => {
  if (!fs.existsSync(filePath)) return ''
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const getDiscordPlayerTextureIdForLaunch = (accountId?: string) => {
  try {
    const cleanAccountId = String(accountId || '').trim()
    if (!cleanAccountId) return null

    const account = readAccounts().find((item) => item.id === cleanAccountId)
    const accountStore = readSkinLibrary().accounts[cleanAccountId]
    if (!account || !accountStore) return null

    if (account.type === 'offline') {
      if (accountStore.activeDefaultSkinId || !accountStore.activeSkinId) return null
      const activePreset = accountStore.skins.find((skin) => skin.id === accountStore.activeSkinId)
      if (!activePreset) return null
      return verifyMinecraftTextureFile({
        rootDirectory: skinsDirectory,
        fileName: activePreset.fileName,
        textureId: activePreset.sourceTextureId
      })
    }

    const profileCache = accountStore.profileCache
    if (!profileCache) return null
    const textureId = verifyMinecraftTextureFile({
      rootDirectory: skinsDirectory,
      fileName: profileCache.fileName,
      textureId: profileCache.textureId
    })
    if (!textureId) return null

    let selectedSkinFileName = ''
    if (accountStore.activeDefaultSkinId) {
      selectedSkinFileName = getDefaultSkinCacheFileName(
        getDefaultSkinPreset(accountStore.activeDefaultSkinId).id
      )
    } else if (accountStore.activeSkinId) {
      const activePreset = accountStore.skins.find((skin) => skin.id === accountStore.activeSkinId)
      if (activePreset) {
        selectedSkinFileName = activePreset.fileName
      } else if (!/^minecraft(?:-public)?:/.test(accountStore.activeSkinId)) {
        return null
      }
    }

    if (selectedSkinFileName && !verifyMinecraftTextureFile({
      rootDirectory: skinsDirectory,
      fileName: selectedSkinFileName,
      textureId
    })) return null

    return textureId
  } catch {
    // Discord artwork is optional and must never prevent the game from starting.
    return null
  }
}

const ensureAuthlibInjector = async () => {
  const injectorDirectory = path.join(userDataPath, 'offline-skin-loader')
  const cachedPath = path.join(injectorDirectory, AUTHLIB_INJECTOR_FILE)
  ensureDir(injectorDirectory)
  if (getFileSha256(cachedPath) === AUTHLIB_INJECTOR_SHA256) return cachedPath
  if (fs.existsSync(cachedPath)) fs.rmSync(cachedPath, { force: true })

  const bundledCandidates = [
    path.join(process.resourcesPath, 'authlib-injector.jar'),
    path.join(app.getAppPath(), 'build', AUTHLIB_INJECTOR_FILE)
  ]
  const bundledPath = bundledCandidates.find((candidate) => getFileSha256(candidate) === AUTHLIB_INJECTOR_SHA256)
  if (bundledPath) {
    fs.copyFileSync(bundledPath, cachedPath)
    return cachedPath
  }

  await downloadFile(AUTHLIB_INJECTOR_URL, cachedPath, 'offline-skin-loader', true)
  if (getFileSha256(cachedPath) !== AUTHLIB_INJECTOR_SHA256) {
    fs.rmSync(cachedPath, { force: true })
    throw new Error('Offline skin loader integrity check failed.')
  }
  return cachedPath
}

const prepareOfflineSkinLaunch = async (authorization: any, accountId?: string) => {
  const account = readAccounts().find((item) => item.id === accountId && item.type === 'offline')
  if (!account) return { authorization, javaArgs: [] as string[] }

  let active = getActiveOfflineSkin(account.id)
  if (!active) {
    const library = readSkinLibrary()
    const accountStore = getSkinAccountStore(library, account.id)
    if (accountStore.activeSkinId) {
      const storedPreset = accountStore.skins.find((skin) => skin.id === accountStore.activeSkinId)
      if (!storedPreset || !fs.existsSync(getSkinPresetPath(storedPreset))) accountStore.activeSkinId = null
    }

    if (!accountStore.activeSkinId) {
      let defaultSkin
      try {
        defaultSkin = getDefaultSkinPreset(accountStore.activeDefaultSkinId || 'steve')
      } catch {
        defaultSkin = getDefaultSkinPreset('steve')
      }
      await downloadDefaultSkinBuffer(defaultSkin)
      accountStore.activeDefaultSkinId = defaultSkin.id
      writeSkinLibrary(library)
      active = getActiveOfflineSkin(account.id)
    }
  }
  if (!active) return { authorization, javaArgs: [] as string[] }
  const { preset } = active

  const [port, injectorPath] = await Promise.all([
    ensureOfflineSkinServer(),
    ensureAuthlibInjector()
  ])
  if (!port) return { authorization, javaArgs: [] as string[] }

  const apiRoot = `http://127.0.0.1:${port}/yggdrasil/${offlineSkinServerToken}/${encodeURIComponent(account.id)}/`
  const prefetchedMetadata = Buffer.from(JSON.stringify(getOfflineSkinMetadata()), 'utf8').toString('base64')
  log.info(`Offline skin loader prepared for ${account.name} (${preset.model}).`)
  return {
    authorization: {
      ...authorization,
      meta: {
        ...(authorization.meta || {}),
        type: 'mojang',
        skinProfileUuid: preset.sourceProfileUuid || null,
        skinProfileName: preset.sourceProfileName || null,
        skinPresetName: preset.name
      },
      user_properties: '{}'
    },
    javaArgs: [
      `-javaagent:${injectorPath}=${apiRoot}`,
      `-Dauthlibinjector.yggdrasil.prefetched=${prefetchedMetadata}`,
      '-Dauthlibinjector.noShowServerName',
      '-Dauthlibinjector.mojangNamespace=disabled',
      '-Dauthlibinjector.profileKey=disabled'
    ]
  }
}

const normalizeInstance = (request: LaunchRequest) => {
  const raw = request.instance || {}
  const version = raw.version || request.version || '1.20.1'
  const loader = normalizeLoader(raw.loader || request.loader)
  const loaderVersion = raw.loaderVersion || request.loaderVersion || ''
  const name = raw.name || request.instanceName || (loader === 'vanilla' ? `Minecraft ${version}` : `${loader} ${version}`)
  const id = String(raw.id || `${loader}-${version}-${loaderVersion || 'default'}`)

  const iconUrl = typeof raw.iconUrl === 'string' && raw.iconUrl.trim() ? raw.iconUrl : null

  return { id, name, version, loader, loaderVersion, iconUrl }
}

const getModpackMetadataPath = (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot } = getInstancePaths(instance)
  return path.join(instanceRoot, 'namlauncher-modpack.json')
}

const hydrateInstanceIcon = async (input: LauncherInstance) => {
  const normalized = normalizeInstance({ instance: input })
  const instance = {
    ...input,
    id: normalized.id,
    name: normalized.name,
    version: normalized.version,
    loader: normalized.loader,
    loaderVersion: normalized.loaderVersion,
    iconUrl: normalized.iconUrl
  }

  if (instance.iconUrl) return instance

  const metadataPath = getModpackMetadataPath(normalized)
  if (!fs.existsSync(metadataPath)) return instance

  const metadata = readJsonFile<Record<string, any>>(metadataPath, {})
  if (typeof metadata.iconUrl === 'string' && metadata.iconUrl.trim()) {
    return { ...instance, iconUrl: metadata.iconUrl }
  }

  const projectId = typeof metadata.projectId === 'string' ? metadata.projectId.trim() : ''
  if (!projectId) return instance
  if (metadata.source === 'local' || projectId.startsWith('local-')) return instance

  try {
    const project = await requestModrinth<{ icon_url?: string | null }>(
      `${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}`,
      {}
    )
    const iconUrl = project.icon_url || null
    if (!iconUrl) return instance

    writeJsonFile(metadataPath, { ...metadata, iconUrl })
    return { ...instance, iconUrl }
  } catch (err) {
    log.warn(`Could not hydrate modpack icon for ${instance.name}`, err)
    return instance
  }
}

const hydrateLauncherInstances = async (instances: LauncherInstance[] = []) => {
  return Promise.all(
    instances
      .filter(Boolean)
      .map((instance) => hydrateInstanceIcon(instance))
  )
}

const sanitizeFolderName = (value: string) => {
  const safe = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[^A-Za-z0-9\u0E00-\u0E7F _.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 80)

  return safe || 'instance'
}

const getInstancesRoot = () => path.join(userDataPath, 'instances')

const getInstanceMarkerPath = (instanceRoot: string) => path.join(instanceRoot, 'namlauncher-instance.json')

const readInstanceMarker = (instanceRoot: string) => {
  const markerPath = getInstanceMarkerPath(instanceRoot)
  assertChildPathIsSafe(instanceRoot, markerPath)
  return readJsonFile<{ instanceId?: string; name?: string }>(markerPath, {})
}

const findExistingInstanceRoot = (instancesRoot: string, instanceId: string) => {
  if (!fs.existsSync(instancesRoot)) return null

  for (const entry of fs.readdirSync(instancesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue

    const candidateRoot = path.join(instancesRoot, entry.name)
    assertInstancePathIsSafe(candidateRoot)
    const marker = readInstanceMarker(candidateRoot)
    if (marker.instanceId === instanceId) return candidateRoot
  }

  return null
}

const writeInstanceMarker = (
  instanceRoot: string,
  instance: ReturnType<typeof normalizeInstance>
) => {
  const markerPath = getInstanceMarkerPath(instanceRoot)
  assertChildPathIsSafe(instanceRoot, markerPath)
  writeJsonFile(markerPath, {
    instanceId: instance.id,
    name: instance.name,
    updatedAt: new Date().toISOString()
  })
}

const getAvailableInstanceFolderName = (
  instancesRoot: string,
  instance: ReturnType<typeof normalizeInstance>,
  preferredName: string
) => {
  for (let index = 1; index <= 100; index += 1) {
    const candidate = index === 1 ? preferredName : sanitizeFolderName(`${preferredName}-${index}`)
    const candidateRoot = path.join(instancesRoot, candidate)
    if (!fs.existsSync(candidateRoot)) return candidate

    assertInstancePathIsSafe(candidateRoot)
    const marker = readInstanceMarker(candidateRoot)
    if (!marker.instanceId || marker.instanceId === instance.id) return candidate
  }

  return sanitizeFolderName(`${preferredName}-${instance.id.slice(0, 8)}`)
}

const getInstancePaths = (instance: ReturnType<typeof normalizeInstance>) => {
  const instancesRoot = getInstancesRoot()
  const preferredName = sanitizeFolderName(instance.name)
  const preferredRoot = path.join(instancesRoot, preferredName)
  ensureDir(instancesRoot)
  const toSafePaths = (folderName: string, instanceRoot: string) => {
    const gameDirectory = path.join(instanceRoot, 'game')
    assertInstancePathIsSafe(instanceRoot)
    assertChildPathIsSafe(instanceRoot, gameDirectory)
    return { folderName, instanceRoot, gameDirectory }
  }

  if (fs.existsSync(preferredRoot)) {
    assertInstancePathIsSafe(preferredRoot)
    const preferredMarker = readInstanceMarker(preferredRoot)
    if (!preferredMarker.instanceId || preferredMarker.instanceId === instance.id) {
      return toSafePaths(preferredName, preferredRoot)
    }
  }

  const existingRoot = findExistingInstanceRoot(instancesRoot, instance.id)
  if (existingRoot) {
    const existingFolderName = path.basename(existingRoot)
    const existingPaths = toSafePaths(existingFolderName, existingRoot)
    if (existingFolderName !== preferredName && !fs.existsSync(preferredRoot)) {
      try {
        fs.renameSync(existingRoot, preferredRoot)
      } catch (err) {
        log.warn(`Could not rename instance folder ${existingFolderName} to ${preferredName}`, err)
        return existingPaths
      }
      writeInstanceMarker(preferredRoot, instance)
      return toSafePaths(preferredName, preferredRoot)
    }

    return existingPaths
  }

  if (!fs.existsSync(preferredRoot)) {
    return toSafePaths(preferredName, preferredRoot)
  }

  const folderName = getAvailableInstanceFolderName(instancesRoot, instance, preferredName)
  const instanceRoot = path.join(instancesRoot, folderName)
  return toSafePaths(folderName, instanceRoot)
}

const ensureInstanceRoot = (instance: ReturnType<typeof normalizeInstance>) => {
  const paths = getInstancePaths(instance)
  assertInstancePathIsSafe(paths.instanceRoot)
  ensureDir(paths.instanceRoot)
  assertInstancePathIsSafe(paths.instanceRoot)
  writeInstanceMarker(paths.instanceRoot, instance)
  return paths
}

const updateInstanceMetadata = (request: InstanceUpdateRequest) => {
  const current = normalizeInstance({ instance: request.instance })
  if (runningGames.has(current.id) || activeLaunches.has(current.id)) {
    throw new Error('Stop Minecraft before editing this instance.')
  }

  const updates = request.updates || {}
  const next = normalizeInstance({
    instance: {
      ...(request.instance || {}),
      ...updates,
      id: current.id,
      loaderVersion: updates.loader === 'vanilla' ? '' : updates.loaderVersion ?? request.instance?.loaderVersion
    }
  })

  ensureInstanceRoot(next)

  return {
    ...(request.instance || {}),
    id: next.id,
    name: next.name,
    version: next.version,
    loader: next.loader,
    loaderVersion: next.loaderVersion,
    iconUrl: next.iconUrl,
    updatedAt: new Date().toISOString()
  }
}

const THAI_RESOURCE_PACK_FILE = 'NamLauncher-Thai-Font.zip'
const THAI_RESOURCE_PACK_SHA256 = 'fa09236c8410aec8123692a7d999149e5e9e3c63bb28b415e9e2666bc5eb4767'
const THAI_RESOURCE_PACK_MARKER = 'namlauncher-default-resourcepacks.json'
const PARTNER_SERVERS_MARKER = 'namlauncher-partner-servers.json'
const LEGACY_THAI_RESOURCE_PACK_FILES = ['Th-En-Font.zip']
const LEGACY_THAI_RESOURCE_PACK_ENTRIES = [
  ...LEGACY_THAI_RESOURCE_PACK_FILES,
  ...LEGACY_THAI_RESOURCE_PACK_FILES.map((filename) => filename.replace(/\.zip$/i, ''))
]

const getBundledThaiResourcePackPath = () => {
  const candidates = [
    path.join(process.resourcesPath, 'resourcepacks', THAI_RESOURCE_PACK_FILE),
    path.join(app.getAppPath(), 'build', 'resourcepacks', THAI_RESOURCE_PACK_FILE)
  ]
  return candidates.find((candidate) => getFileSha256(candidate) === THAI_RESOURCE_PACK_SHA256) || null
}

const readMinecraftOptionList = (rawValue: string) => {
  try {
    const parsed = JSON.parse(rawValue)
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    // Preserve quoted entries if another launcher wrote a non-standard list.
  }

  return Array.from(rawValue.matchAll(/"([^"]*)"/g)).map((match) => match[1])
}

const updateMinecraftOptionList = (
  lines: string[],
  key: string,
  update: (values: string[]) => string[]
) => {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`))
  const current = index >= 0
    ? readMinecraftOptionList(lines[index].slice(key.length + 1))
    : []
  const next = Array.from(new Set(update(current)))
  const line = `${key}:${JSON.stringify(next)}`
  if (index >= 0) lines[index] = line
  else lines.push(line)
}

const enableResourcePackInOptions = (gameDirectory: string, filename: string) => {
  const optionsPath = path.join(gameDirectory, 'options.txt')
  const existing = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, 'utf8') : ''
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = /\r?\n$/.test(existing)
  const lines = existing ? existing.replace(/\r?\n$/, '').split(/\r?\n/) : []
  const resourcePackId = `file/${filename}`
  const legacyResourcePackIds = new Set(
    LEGACY_THAI_RESOURCE_PACK_ENTRIES.map((legacyEntry) => `file/${legacyEntry}`)
  )

  updateMinecraftOptionList(lines, 'resourcePacks', (values) => (
    values.includes(resourcePackId)
      ? values.filter((value) => !legacyResourcePackIds.has(value))
      : [...values.filter((value) => !legacyResourcePackIds.has(value)), resourcePackId]
  ))
  updateMinecraftOptionList(lines, 'incompatibleResourcePacks', (values) => (
    values.filter((value) => value !== resourcePackId && !legacyResourcePackIds.has(value))
  ))

  fs.writeFileSync(optionsPath, `${lines.join(eol)}${hadTrailingNewline || !existing ? eol : ''}`, 'utf8')
}

const disableManagedThaiResourcePacksInOptions = (gameDirectory: string) => {
  const optionsPath = path.join(gameDirectory, 'options.txt')
  if (!fs.existsSync(optionsPath)) return

  const existing = fs.readFileSync(optionsPath, 'utf8')
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = /\r?\n$/.test(existing)
  const lines = existing.replace(/\r?\n$/, '').split(/\r?\n/)
  const managedIds = new Set([
    `file/${THAI_RESOURCE_PACK_FILE}`,
    ...LEGACY_THAI_RESOURCE_PACK_ENTRIES.map((legacyEntry) => `file/${legacyEntry}`)
  ])

  updateMinecraftOptionList(lines, 'resourcePacks', (values) => (
    values.filter((value) => !managedIds.has(value))
  ))
  updateMinecraftOptionList(lines, 'incompatibleResourcePacks', (values) => (
    values.filter((value) => !managedIds.has(value))
  ))
  fs.writeFileSync(optionsPath, `${lines.join(eol)}${hadTrailingNewline ? eol : ''}`, 'utf8')
}

const provisionThaiResourcePack = (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  ensureDir(gameDirectory)

  const bundledPath = getBundledThaiResourcePackPath()
  if (!bundledPath) throw new Error('Bundled Thai font resource pack failed integrity verification.')

  const resourcePacksDirectory = path.join(gameDirectory, 'resourcepacks')
  const destinationPath = path.join(resourcePacksDirectory, THAI_RESOURCE_PACK_FILE)
  ensureDir(resourcePacksDirectory)
  for (const legacyEntry of LEGACY_THAI_RESOURCE_PACK_ENTRIES) {
    const legacyPath = path.join(resourcePacksDirectory, legacyEntry)
    if (!isPathInside(legacyPath, resourcePacksDirectory) || !fs.existsSync(legacyPath)) continue
    try {
      const quarantinePath = `${legacyPath}.disabled-namlauncher-recovery-${Date.now()}-${crypto.randomUUID()}`
      fs.renameSync(legacyPath, quarantinePath)
      log.info(`Disabled legacy NamLauncher Thai font resource pack: ${legacyPath}`)
    } catch (err) {
      log.warn(`Could not disable legacy NamLauncher Thai font resource pack: ${legacyPath}`, getCompactErrorLog(err))
    }
  }

  if (getFileSha256(destinationPath) !== THAI_RESOURCE_PACK_SHA256) {
    const temporaryPath = `${destinationPath}.${crypto.randomUUID()}.tmp`
    fs.copyFileSync(bundledPath, temporaryPath)
    if (getFileSha256(temporaryPath) !== THAI_RESOURCE_PACK_SHA256) {
      fs.rmSync(temporaryPath, { force: true })
      throw new Error('Thai font resource pack copy failed integrity verification.')
    }
    fs.rmSync(destinationPath, { force: true })
    fs.renameSync(temporaryPath, destinationPath)
  }

  enableResourcePackInOptions(gameDirectory, THAI_RESOURCE_PACK_FILE)
  writeJsonFile(path.join(instanceRoot, THAI_RESOURCE_PACK_MARKER), {
    version: 2,
    filename: THAI_RESOURCE_PACK_FILE,
    sha256: THAI_RESOURCE_PACK_SHA256,
    enabledByDefault: true,
    installedAt: new Date().toISOString()
  })

  return {
    filename: THAI_RESOURCE_PACK_FILE,
    enabled: true,
    sha256: THAI_RESOURCE_PACK_SHA256
  }
}

const instanceHasAllPartnerServers = async (serversPath: string) => {
  try {
    const stored = (await readMinecraftServersDat(serversPath)).servers
    const existingKeys = new Set(stored.map((server) => server.canonicalKey))
    return PARTNER_SERVERS.every((partner) => (
      existingKeys.has(normalizeMinecraftServerEndpoint(partner.address).canonicalKey)
    ))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const provisionPartnerServers = async (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  ensureDir(gameDirectory)

  const serversPath = path.join(gameDirectory, 'servers.dat')
  const markerPath = path.join(instanceRoot, PARTNER_SERVERS_MARKER)
  assertChildPathIsSafe(instanceRoot, markerPath)
  const marker = readJsonFile<{ revision?: number }>(markerPath, {})
  if (marker.revision === PARTNER_SERVER_REVISION && await instanceHasAllPartnerServers(serversPath)) {
    return {
      revision: PARTNER_SERVER_REVISION,
      changed: false,
      skipped: true,
      addedServerIds: [] as string[]
    }
  }

  const result = await mergePartnerServersDat(serversPath)
  writeJsonFile(markerPath, {
    revision: PARTNER_SERVER_REVISION,
    installedAt: new Date().toISOString(),
    addedServerIds: result.addedServerIds
  })
  return {
    revision: PARTNER_SERVER_REVISION,
    skipped: false,
    ...result
  }
}

const provisionInstanceDefaults = async (instance: ReturnType<typeof normalizeInstance>) => ({
  resourcePack: provisionThaiResourcePack(instance),
  partnerServers: await provisionPartnerServers(instance)
})

const createInstanceRunLog = (
  instance: ReturnType<typeof normalizeInstance>,
  _instanceRoot: string
) => {
  writeRunLog(null, `NamLauncher launch started for ${instance.name}`, instance)
  writeRunLog(null, `NamLauncher ${app.getVersion()} on ${process.platform}/${process.arch}`, instance)
  writeRunLog(null, `Minecraft ${instance.version} ${instance.loader} ${instance.loaderVersion || ''}`, instance)
  return null
}

const createRunLogEntry = (message: string) => {
  const at = new Date().toISOString()
  const text = redactSensitiveText(message).replace(/\r?\n$/, '')
  return {
    at,
    text,
    line: `[${at}] ${text}`
  }
}

const writeRunLog = (
  stream: fs.WriteStream | null | undefined,
  message: string,
  instance?: ReturnType<typeof normalizeInstance>
) => {
  const entry = createRunLogEntry(message)
  if (stream && !stream.destroyed) {
    stream.write(`${entry.line}\n`)
  }
  sendGameLog({
    ...entry,
    instanceId: instance?.id || null,
    instanceName: instance?.name || null
  })
}

const closeRunLog = (
  stream: fs.WriteStream | null | undefined,
  message?: string,
  instance?: ReturnType<typeof normalizeInstance>
) => {
  if (message) writeRunLog(stream, message, instance)
  if (stream && !stream.destroyed) stream.end()
}

const releaseChildProcessFromLauncher = (childProcess: any) => {
  try {
    childProcess?.stdout?.unref?.()
    childProcess?.stderr?.unref?.()
    childProcess?.stdin?.unref?.()
    childProcess?.unref?.()
  } catch (err) {
    log.debug('Failed to unref Minecraft process handles.', err)
  }
}

const releaseRunningGamesForLauncherExit = () => {
  const telemetryFlushes: Promise<void>[] = []
  for (const game of runningGames.values()) {
    if (game.telemetryActive) {
      telemetryFlushes.push(queueGameSessionEvent(game, 'end', { endReason: 'launcher-exit' }))
    }
    if (game.badgePresenceActive) {
      telemetryFlushes.push(queuePlayerBadgePresence(game, 'end'))
    }
    releaseChildProcessFromLauncher(game.process)
    closeRunLog(
      game.logStream,
      'Launcher closed. Minecraft continues running in detached mode.'
    )
    game.logStream = null
  }
  return Promise.allSettled(telemetryFlushes).then(() => undefined)
}

const publishLauncherUpdate = async () => {
  const update = await checkLauncherUpdate()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return update
  mainWindow.webContents.send('launcher-update', update)
  return update
}

async function checkLauncherUpdateFromTray() {
  showMainWindow()
  const update = await publishLauncherUpdate()
  if (update.updateAvailable) return update

  const thai = getTrayLanguage() === 'th'
  const updateError = 'error' in update ? String(update.error || '') : ''
  const options: MessageBoxOptions = {
    type: updateError ? 'warning' : 'info',
    buttons: [thai ? 'ตกลง' : 'OK'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: thai ? 'ตรวจสอบอัปเดต NamLauncher' : 'NamLauncher update check',
    message: updateError
      ? (thai ? 'ยังตรวจสอบอัปเดตไม่ได้ในขณะนี้' : 'NamLauncher could not check for updates right now.')
      : (thai ? 'NamLauncher เป็นเวอร์ชันล่าสุดแล้ว' : 'NamLauncher is up to date.'),
    detail: updateError || `Version ${update.currentVersion}`
  }
  if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options)
  else await dialog.showMessageBox(options)
  return update
}

const configureLauncherUpdateChecks = () => {
  if (launcherUpdateTimer) clearInterval(launcherUpdateTimer)
  launcherUpdateTimer = setInterval(() => {
    publishLauncherUpdate().catch((err) => log.debug('Scheduled launcher update check failed.', getCompactErrorLog(err)))
  }, LAUNCHER_UPDATE_CHECK_INTERVAL_MS)
}

const stopLauncherUpdateChecks = () => {
  if (!launcherUpdateTimer) return
  clearInterval(launcherUpdateTimer)
  launcherUpdateTimer = null
}

const readTextFileTail = (filePath: string, maxBytes: number) => {
  if (!fs.existsSync(filePath)) {
    return {
      content: '',
      exists: false,
      truncated: false
    }
  }

  const stat = fs.statSync(filePath)
  const start = Math.max(0, stat.size - maxBytes)
  const length = stat.size - start
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(filePath, 'r')

  try {
    fs.readSync(fd, buffer, 0, length, start)
  } finally {
    fs.closeSync(fd)
  }

  return {
    content: buffer.toString('utf8'),
    exists: true,
    truncated: start > 0
  }
}

const readTextFileHeadAndTail = (filePath: string, headBytes: number, tailBytes: number) => {
  if (!fs.existsSync(filePath)) {
    return {
      content: '',
      exists: false,
      truncated: false
    }
  }

  const stat = fs.statSync(filePath)
  const totalBytes = Math.max(0, headBytes) + Math.max(0, tailBytes)
  if (stat.size <= totalBytes) {
    return {
      content: fs.readFileSync(filePath, 'utf8'),
      exists: true,
      truncated: false
    }
  }

  const head = Buffer.alloc(Math.max(0, headBytes))
  const tail = Buffer.alloc(Math.max(0, tailBytes))
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, head, 0, head.length, 0)
    fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length))
  } finally {
    fs.closeSync(fd)
  }

  return {
    content: `${head.toString('utf8')}\n\n[NamLauncher] middle of file omitted; preserving crash header and tail.\n\n${tail.toString('utf8')}`,
    exists: true,
    truncated: true
  }
}

const getLatestCrashReportPath = (gameDirectory: string, since = 0) => {
  const crashReportsDirectory = path.join(gameDirectory, 'crash-reports')
  if (!fs.existsSync(crashReportsDirectory)) return ''

  return fs.readdirSync(crashReportsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => {
      const filePath = path.join(crashReportsDirectory, entry.name)
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }
    })
    .filter((entry) => entry.mtimeMs >= since)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath || ''
}

const buildDiagnosticExcerpt = (value: string, headLines: number, tailLines: number) => {
  const lines = value.split(/\r?\n/)
  if (lines.length <= headLines + tailLines) return value

  const selected = new Set<number>()
  for (let index = 0; index < Math.min(headLines, lines.length); index += 1) selected.add(index)
  for (let index = Math.max(0, lines.length - tailLines); index < lines.length; index += 1) selected.add(index)

  const signalPattern = /(?:caused by:|exception|error|failed|fatal|crash|mixin|requires\b|incompatible|glfw|renderer|noclass|nosuch|unsatisfiedlink)/i
  for (let index = 0; index < lines.length; index += 1) {
    if (!signalPattern.test(lines[index])) continue
    for (let offset = -2; offset <= 4; offset += 1) {
      const candidate = index + offset
      if (candidate >= 0 && candidate < lines.length) selected.add(candidate)
    }
  }

  const ordered = [...selected].sort((left, right) => left - right)
  const output: string[] = []
  let previous = -2
  for (const index of ordered) {
    if (index > previous + 1) output.push('[... lines omitted ...]')
    output.push(lines[index])
    previous = index
  }
  return output.join('\n')
}

const buildInstanceCrashLog = (instance: ReturnType<typeof normalizeInstance>, since = 0) => {
  const { instanceRoot, gameDirectory } = getInstancePaths(instance)
  const latestLogPath = path.join(gameDirectory, 'logs', 'latest.log')
  const latestCrashReportPath = getLatestCrashReportPath(gameDirectory, since)
  const combinedLogPath = path.join(instanceRoot, 'crash_logs.txt')
  // Only current-launch files may determine ownership; an old companion crash
  // must not turn a new third-party mod issue into an automatic report.
  const latestLogIsCurrent = since === 0 || (fs.existsSync(latestLogPath) && fs.statSync(latestLogPath).mtimeMs >= since)
  const latestLog = latestLogIsCurrent ? readTextFileTail(latestLogPath, 512 * 1024) : {
    content: '', exists: false, truncated: false
  }
  const crashReport = latestCrashReportPath ? readTextFileHeadAndTail(latestCrashReportPath, 192 * 1024, 128 * 1024) : {
    content: '',
    exists: false,
    truncated: false
  }
  const launcherLog = readTextFileTail(logPath, 256 * 1024)
  const sections = [
    `NamLauncher combined instance logs`,
    `Generated: ${new Date().toISOString()}`,
    `Instance: ${instance.name}`,
    `Minecraft: ${instance.version} ${instance.loader} ${instance.loaderVersion || ''}`,
    '',
    `===== Game latest.log (${latestLogPath}) =====`,
    latestLog.exists
      ? `${latestLog.truncated ? '[NamLauncher] latest.log was truncated to the latest 512 KiB.\n' : ''}${redactSensitiveText(latestLog.content)}`
      : '[NamLauncher] latest.log was not found.',
    '',
    `===== Latest crash report (${latestCrashReportPath || 'none'}) =====`,
    crashReport.exists
      ? `${crashReport.truncated ? '[NamLauncher] crash report was truncated while preserving its header and tail.\n' : ''}${redactSensitiveText(crashReport.content)}`
      : '[NamLauncher] No crash report was found.',
    '',
    `===== Launcher app log (${logPath}) =====`,
    launcherLog.exists
      ? `${launcherLog.truncated ? '[NamLauncher] launcher log was truncated to the latest 256 KiB.\n' : ''}${sanitizeBugReport(launcherLog.content)}`
      : '[NamLauncher] Launcher app log was not found.',
    ''
  ]
  const content = sections.join('\n')
  const diagnosticExcerpt = truncateRemoteText([
    '===== Crash report diagnostic excerpt =====',
    crashReport.exists
      ? redactSensitiveText(buildDiagnosticExcerpt(crashReport.content, 90, 45))
      : '[NamLauncher] No crash report was found.',
    '',
    '===== latest.log diagnostic excerpt =====',
    latestLog.exists
      ? redactSensitiveText(buildDiagnosticExcerpt(latestLog.content, 25, 90))
      : '[NamLauncher] latest.log was not found.'
  ].join('\n'), 9000)

  ensureDir(instanceRoot)
  fs.writeFileSync(combinedLogPath, content, 'utf8')

  return {
    content,
    diagnosticExcerpt,
    path: combinedLogPath,
    exists: true,
    truncated: latestLog.truncated || crashReport.truncated || launcherLog.truncated,
    latestLogPath,
    latestCrashReportPath: latestCrashReportPath || null,
    launcherLogPath: logPath
  }
}

const getInstanceRunLog = (request: LaunchRequest) => {
  return buildInstanceCrashLog(normalizeInstance(request))
}

const assertInstancePathIsSafe = (targetPath: string) => {
  const instancesRoot = path.resolve(userDataPath, 'instances')
  assertPathWithinRoot(instancesRoot, targetPath)
}

const assertChildPathIsSafe = (parentPath: string, targetPath: string) => {
  assertPathWithinRoot(parentPath, targetPath, { allowRoot: true })
}

const getInstancePlacesPaths = (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot, gameDirectory } = getInstancePaths(instance)
  assertInstancePathIsSafe(instanceRoot)
  assertChildPathIsSafe(instanceRoot, gameDirectory)
  const serversPath = path.join(gameDirectory, 'servers.dat')
  const savesDirectory = path.join(gameDirectory, 'saves')
  assertChildPathIsSafe(instanceRoot, serversPath)
  assertChildPathIsSafe(instanceRoot, savesDirectory)
  return {
    instanceRoot,
    gameDirectory,
    serversPath
  }
}

const readInstanceServers = async (instance: ReturnType<typeof normalizeInstance>) => {
  const { serversPath } = getInstancePlacesPaths(instance)
  try {
    return (await readMinecraftServersDat(serversPath)).servers
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const readWorldIconDataUrl = (gameDirectory: string, iconPath: string | null) => {
  if (!iconPath) return null
  try {
    const savesDirectory = path.join(gameDirectory, 'saves')
    const resolvedPath = fs.realpathSync(iconPath)
    assertChildPathIsSafe(savesDirectory, resolvedPath)
    const info = fs.lstatSync(resolvedPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 512 * 1024) return null
    const content = fs.readFileSync(resolvedPath)
    if (content.length < 8 || !content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return null
    }
    return `data:image/png;base64,${content.toString('base64')}`
  } catch {
    return null
  }
}

const serializeMinecraftWorld = (
  world: Awaited<ReturnType<typeof scanMinecraftWorlds>>['worlds'][number],
  gameDirectory: string
) => ({
  folderName: world.folderName,
  displayName: world.displayName,
  iconDataUrl: readWorldIconDataUrl(gameDirectory, world.iconPath),
  recoveredFromBackup: world.recoveredFromBackup,
  lastPlayedAt: world.lastPlayedAt,
  gameMode: world.gameMode,
  difficulty: world.difficulty,
  hardcore: world.hardcore,
  allowCommands: world.allowCommands,
  minecraftVersion: world.minecraftVersion,
  dataVersion: world.dataVersion
})

const getInstancePlaces = async (request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  const { gameDirectory } = getInstancePlacesPaths(instance)
  const [worldResult, servers] = await Promise.all([
    scanMinecraftWorlds(gameDirectory),
    readInstanceServers(instance)
  ])
  return {
    worlds: worldResult.worlds.map((world) => serializeMinecraftWorld(world, gameDirectory)),
    worldFailures: worldResult.failures.map((failure) => ({
      folderName: failure.folderName,
      message: failure.message
    })),
    servers
  }
}

const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  worker: (value: Input, index: number) => Promise<Output>
) => {
  const output = new Array<Output>(values.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      output[index] = await worker(values[index], index)
    }
  })
  await Promise.all(runners)
  return output
}

const pingInstanceServers = async (request: InstanceServerPingRequest) => {
  const instance = normalizeInstance(request)
  const targets = selectMinecraftServerPingTargets(await readInstanceServers(instance), request.addresses)
  return mapWithConcurrency(targets, 8, async ({ server, requestedAddresses }) => {
    if (!server.canonicalKey) {
      return {
        index: server.index,
        name: server.name,
        canonicalKey: null,
        address: server.address,
        requestedAddresses,
        iconDataUrl: server.iconDataUrl,
        online: false,
        errorCode: 'INVALID_ADDRESS',
        errorMessage: 'Minecraft server address is invalid.'
      }
    }
    try {
      const status = await pingMinecraftServer(server.address, { timeoutMs: 2_500 })
      return {
        index: server.index,
        name: server.name,
        canonicalKey: server.canonicalKey,
        address: server.address,
        requestedAddresses,
        iconDataUrl: server.iconDataUrl,
        online: true,
        status
      }
    } catch (error) {
      return {
        index: server.index,
        name: server.name,
        canonicalKey: server.canonicalKey,
        address: server.address,
        requestedAddresses,
        iconDataUrl: server.iconDataUrl,
        online: false,
        errorCode: String((error as { code?: unknown })?.code || 'NETWORK'),
        errorMessage: error instanceof Error ? error.message : 'Could not connect to Minecraft server.'
      }
    }
  })
}

const validateQuickPlayRequest = async (
  request: LaunchRequest,
  instance: ReturnType<typeof normalizeInstance>
) => {
  const quickPlay = request.quickPlay
  if (!quickPlay) return null

  if (quickPlay.type === 'server') {
    const endpoint = normalizeMinecraftServerEndpoint(String(quickPlay.address || ''))
    const servers = await readInstanceServers(instance)
    if (!servers.some((server) => server.canonicalKey === endpoint.canonicalKey)) {
      throw new Error('Refresh the instance server list before joining this server.')
    }
    return createServerQuickPlay(endpoint, instance.version)
  }

  if (quickPlay.type === 'world') {
    const folderName = String(quickPlay.folderName || '')
    if (!folderName || folderName !== path.basename(folderName) || folderName.length > 255) {
      throw new Error('Minecraft world folder name is invalid.')
    }
    const { gameDirectory } = getInstancePlacesPaths(instance)
    const worlds = await scanMinecraftWorlds(gameDirectory)
    if (!worlds.worlds.some((world) => world.folderName === folderName)) {
      throw new Error('Refresh the instance world list before opening this world.')
    }
    return createWorldQuickPlay(folderName, instance.version)
  }

  throw new Error('Minecraft quick play request is invalid.')
}

const getContentManifestPath = (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot } = getInstancePaths(instance)
  return path.join(instanceRoot, 'namlauncher-content.json')
}

const readContentManifest = (instance: ReturnType<typeof normalizeInstance>): InstanceContentManifest => {
  const manifest = readJsonFile<InstanceContentManifest>(getContentManifestPath(instance), {
    version: 1,
    projects: {}
  })

  return {
    version: 1,
    projects: manifest.projects && typeof manifest.projects === 'object' ? manifest.projects : {}
  }
}

const writeContentManifest = (
  instance: ReturnType<typeof normalizeInstance>,
  manifest: InstanceContentManifest
) => {
  writeJsonFile(getContentManifestPath(instance), manifest)
}

const listInstanceMods = (instance: ReturnType<typeof normalizeInstance>) => {
  const { instanceRoot, gameDirectory } = getInstancePaths(instance)
  const modsDirectory = path.join(gameDirectory, 'mods')

  if (!fs.existsSync(modsDirectory)) return []
  const managedFiles = new Set(listManagedBrandingBridgeFiles({ instanceRoot, gameDirectory }).map((file) => path.resolve(file)))

  return fs.readdirSync(modsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && entry.name.toLowerCase().endsWith('.jar')
      && !managedFiles.has(path.resolve(modsDirectory, entry.name)))
    .map((entry) => {
      const filePath = path.join(modsDirectory, entry.name)
      const stat = fs.statSync(filePath)
      return {
        name: entry.name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

const normalizeContentKind = (kind?: string): InstanceContentKind => {
  if (kind === 'resourcepacks' || kind === 'shaderpacks' || kind === 'screenshots') return kind
  return 'mods'
}

const getContentDirectory = (gameDirectory: string, kind: InstanceContentKind) => {
  if (kind === 'resourcepacks') return path.join(gameDirectory, 'resourcepacks')
  if (kind === 'shaderpacks') return path.join(gameDirectory, 'shaderpacks')
  if (kind === 'screenshots') return path.join(gameDirectory, 'screenshots')
  return path.join(gameDirectory, 'mods')
}

const stripDisableSuffix = (filename: string) => filename.replace(/\.(disable|disabled)$/i, '')

const isDisabledContentFile = (filename: string) => /\.(disable|disabled)$/i.test(filename)

const isContentFileForKind = (kind: InstanceContentKind, filename: string) => {
  const enabledName = stripDisableSuffix(filename).toLowerCase()
  if (kind === 'mods') return enabledName.endsWith('.jar') || enabledName.endsWith('.litemod')
  if (kind === 'screenshots') return /\.(png|jpe?g|webp)$/i.test(enabledName)
  return enabledName.endsWith('.zip')
}

const getInstanceContentId = (contentDirectory: string, fileName: string) => {
  const canonicalPath = path.join(contentDirectory, stripDisableSuffix(fileName))
  return crypto.createHash('sha1').update(canonicalPath).digest('hex')
}

const getContentKindFileLabel = (kind: InstanceContentKind) => {
  if (kind === 'mods') return 'mod'
  if (kind === 'resourcepacks') return 'resource pack'
  if (kind === 'shaderpacks') return 'shader pack'
  return 'screenshot'
}

const assertArchiveContentReadable = (filePath: string, kind: InstanceContentKind) => {
  if (kind === 'screenshots') return
  try {
    const zip = new AdmZip(filePath)
    zip.getEntries()
  } catch {
    throw new Error(`The selected ${getContentKindFileLabel(kind)} is not a valid ZIP/JAR archive. Download it again before importing.`)
  }
}

const getLocalImageDataUrl = (filePath: string) => {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return null
    const data = fs.readFileSync(filePath)
    return `data:${getMimeType(filePath)};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

const getMimeType = (filename: string) => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

const getZipEntryDataUrl = (zip: AdmZip, entryName?: string | null) => {
  if (!entryName) return null
  const normalizedName = entryName.replace(/^\/+/, '')
  const entry = zip.getEntry(normalizedName)
    || zip.getEntries().find((candidate) => candidate.entryName.toLowerCase() === normalizedName.toLowerCase())
    || zip.getEntries().find((candidate) => path.basename(candidate.entryName).toLowerCase() === path.basename(normalizedName).toLowerCase())

  if (!entry || entry.isDirectory) return null

  try {
    const data = getZipEntryDataWithLimit(entry, MAX_ZIP_METADATA_ENTRY_BYTES, 'ZIP image entry')
    return `data:${getMimeType(entry.entryName)};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

const getFabricIconPath = (metadata: any) => {
  const icon = metadata?.icon
  if (typeof icon === 'string') return icon
  if (icon && typeof icon === 'object') {
    const entries = Object.entries(icon)
      .filter(([, value]) => typeof value === 'string')
      .sort(([a], [b]) => Number(b) - Number(a))
    return entries[0]?.[1] as string | undefined
  }
  return null
}

const getQuiltIconPath = (metadata: any) => {
  const icon = metadata?.quilt_loader?.metadata?.icon || metadata?.quilt_loader?.metadata?.icon_url
  return typeof icon === 'string' ? icon : null
}

const getForgeLogoPath = (modsToml: string) => {
  const match = modsToml.match(/logoFile\s*=\s*["']([^"']+)["']/i)
  return match?.[1] || null
}

const readZipJsonEntry = (zip: AdmZip, entryName: string) => {
  const entry = zip.getEntry(entryName)
  if (!entry) return null

  try {
    return JSON.parse(getZipEntryDataWithLimit(entry, MAX_ZIP_METADATA_ENTRY_BYTES, entryName).toString('utf8'))
  } catch {
    return null
  }
}

const getZipEntrySize = (entry: AdmZip.IZipEntry) => {
  const size = Number(entry.header?.size ?? 0)
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Archive entry ${entry.entryName} has an invalid size.`)
  }
  return size
}

const getZipEntryDataWithLimit = (entry: AdmZip.IZipEntry, maxBytes: number, label: string) => {
  const expectedSize = getZipEntrySize(entry)
  if (expectedSize > maxBytes) {
    throw new Error(`${label} is too large to process safely.`)
  }

  const data = entry.getData()
  if (data.length > maxBytes) {
    throw new Error(`${label} expanded beyond the safe size limit.`)
  }
  return data
}

const preflightModpackOverrideEntries = (entries: AdmZip.IZipEntry[], label: string) => {
  if (entries.length > MAX_MODPACK_OVERRIDE_FILES) {
    throw new Error(`${label} contains too many override files to extract safely.`)
  }

  let totalSize = 0
  for (const entry of entries) {
    const entrySize = getZipEntrySize(entry)
    if (entrySize > MAX_MODPACK_OVERRIDE_ENTRY_BYTES) {
      throw new Error(`${label} contains an override file that is too large to extract safely.`)
    }
    totalSize += entrySize
    if (totalSize > MAX_MODPACK_OVERRIDE_TOTAL_BYTES) {
      throw new Error(`${label} overrides are too large to extract safely.`)
    }
  }
}

const writeZipEntryToFile = (entry: AdmZip.IZipEntry, targetPath: string, label: string) => {
  const data = getZipEntryDataWithLimit(entry, MAX_MODPACK_OVERRIDE_ENTRY_BYTES, label)
  ensureDir(path.dirname(targetPath))
  fs.writeFileSync(targetPath, data)
}

const getTomlString = (content: string, key: string) => {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'im'))
  return match?.[1]?.trim() || null
}

const normalizeArchiveVersion = (value: unknown) => {
  const version = String(value || '').trim()
  if (!version || /^\$\{.+\}$/.test(version) || version === 'unknown') return null
  return version
}

const getArchiveContentMetadata = (filePath: string, kind: InstanceContentKind) => {
  try {
    if (kind === 'screenshots') {
      return { iconUrl: getLocalImageDataUrl(filePath), name: null, version: null }
    }

    const zip = new AdmZip(filePath)

    if (kind !== 'mods') {
      return { iconUrl: getZipEntryDataUrl(zip, 'pack.png'), name: null, version: null }
    }

    const fabricMetadata = readZipJsonEntry(zip, 'fabric.mod.json')
    if (fabricMetadata) {
      const metadata = fabricMetadata
      const icon = getFabricIconPath(metadata)
      return {
        iconUrl: getZipEntryDataUrl(zip, icon),
        name: String(metadata.name || metadata.id || '').trim() || null,
        version: normalizeArchiveVersion(metadata.version)
      }
    }

    const quiltMetadata = readZipJsonEntry(zip, 'quilt.mod.json')
    if (quiltMetadata) {
      const metadata = quiltMetadata
      const icon = getQuiltIconPath(metadata)
      const loaderMetadata = metadata.quilt_loader || metadata
      return {
        iconUrl: getZipEntryDataUrl(zip, icon),
        name: String(loaderMetadata?.metadata?.name || loaderMetadata?.id || '').trim() || null,
        version: normalizeArchiveVersion(loaderMetadata?.version)
      }
    }

    const forgeEntry = zip.getEntry('META-INF/mods.toml') || zip.getEntry('META-INF/neoforge.mods.toml')
    if (forgeEntry) {
      const content = getZipEntryDataWithLimit(forgeEntry, MAX_ZIP_METADATA_ENTRY_BYTES, 'Forge mod metadata').toString('utf8')
      const icon = getForgeLogoPath(content)
      return {
        iconUrl: getZipEntryDataUrl(zip, icon),
        name: getTomlString(content, 'displayName') || getTomlString(content, 'modId'),
        version: normalizeArchiveVersion(getTomlString(content, 'version'))
      }
    }

    const legacyMetadata = readZipJsonEntry(zip, 'mcmod.info')
    const legacyMod = Array.isArray(legacyMetadata) ? legacyMetadata[0] : legacyMetadata?.modList?.[0]
    return {
      iconUrl: getZipEntryDataUrl(zip, legacyMod?.logoFile || 'pack.png'),
      name: String(legacyMod?.name || legacyMod?.modid || '').trim() || null,
      version: normalizeArchiveVersion(legacyMod?.version)
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.debug(`Could not read content metadata for ${filePath}: ${detail}`)
    return { iconUrl: null, name: null, version: null }
  }
}

const findInstalledRecordForFile = (manifest: InstanceContentManifest, filePath: string, filename: string) => {
  const resolvedPath = path.resolve(filePath)
  const normalizedName = stripDisableSuffix(filename).toLowerCase()

  return Object.values(manifest.projects).find((record) => record.files.some((file) => {
    const storedPath = path.resolve(file.path)
    const storedName = stripDisableSuffix(path.basename(file.path)).toLowerCase()
    return storedPath === resolvedPath || storedName === normalizedName
  }))
}

const EMPTY_ARCHIVE_CONTENT_METADATA = Object.freeze({ iconUrl: null, name: null, version: null })
const INSTANCE_CONTENT_YIELD_INTERVAL = 8

const getInstanceContent = async (request: InstanceContentRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const kind = normalizeContentKind(request.kind)
  const { instanceRoot, gameDirectory } = getInstancePaths(instance)
  const contentDirectory = getContentDirectory(gameDirectory, kind)
  const manifest = readContentManifest(instance)
  const lightweightWhilePlaying = hasActiveMinecraft() && kind !== 'screenshots'

  if (!fs.existsSync(contentDirectory)) return []

  const entries = fs.readdirSync(contentDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isContentFileForKind(kind, entry.name))
  const managedFiles = kind === 'mods'
    ? new Set(listManagedBrandingBridgeFiles({ instanceRoot, gameDirectory }).map((file) => path.resolve(file)))
    : new Set<string>()
  const items = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const filePath = path.join(contentDirectory, entry.name)
    if (managedFiles.has(path.resolve(filePath))) continue
    const stat = fs.statSync(filePath)
    const enabledName = stripDisableSuffix(entry.name)
    const record = findInstalledRecordForFile(manifest, filePath, entry.name)
    const archiveMetadata = lightweightWhilePlaying
      ? EMPTY_ARCHIVE_CONTENT_METADATA
      : getArchiveContentMetadata(filePath, kind)
    const iconDataUrl = record?.iconUrl || archiveMetadata.iconUrl
    items.push({
      id: getInstanceContentId(contentDirectory, entry.name),
      kind,
      name: archiveMetadata.name || record?.title || enabledName.replace(/\.(jar|litemod|zip|png|jpe?g|webp)$/i, ''),
      fileName: entry.name,
      enabledFileName: enabledName,
      filePath,
      enabled: !isDisabledContentFile(entry.name),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      iconUrl: iconDataUrl,
      projectId: record?.projectId || null,
      versionNumber: archiveMetadata.version || record?.versionNumber || null,
      source: record?.provider || (record ? 'modrinth' : 'local')
    })

    if (!lightweightWhilePlaying && (index + 1) % INSTANCE_CONTENT_YIELD_INTERVAL === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  return items.sort((a, b) => kind === 'screenshots'
    ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    : a.name.localeCompare(b.name)
  )
}

const getSafeContentFilePath = (request: InstanceContentRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const kind = normalizeContentKind(request.kind)
  const { gameDirectory } = getInstancePaths(instance)
  const contentDirectory = getContentDirectory(gameDirectory, kind)
  const fileName = String(request.fileName || '').trim()
  const contentId = String(request.contentId || '').trim().toLowerCase()

  if (
    !fileName
    || path.basename(fileName) !== fileName
    || !isContentFileForKind(kind, fileName)
    || !/^[a-f0-9]{40}$/.test(contentId)
  ) {
    throw new Error('Content selection is no longer current. Refresh the instance content and try again.')
  }

  const expectedContentId = getInstanceContentId(contentDirectory, fileName)
  if (contentId !== expectedContentId) {
    throw new Error('Content selection is no longer current. Refresh the instance content and try again.')
  }

  const filePath = path.join(contentDirectory, fileName)

  assertChildPathIsSafe(contentDirectory, filePath)
  return { instance, kind, gameDirectory, contentDirectory, filePath }
}

const isModContentMutation = (contentType: ModrinthProjectType | InstanceContentKind) => {
  return contentType === 'mod' || contentType === 'mods'
}

const assertInstanceContentMutable = (
  instance: ReturnType<typeof normalizeInstance>,
  contentType: ModrinthProjectType | InstanceContentKind
) => {
  if (!isModContentMutation(contentType)) return
  if (runningGames.has(instance.id) || activeLaunches.has(instance.id)) {
    throw new Error('Stop Minecraft before changing mods in this instance.')
  }
}

const assertContentFileIsNotLauncherManaged = (
  instance: ReturnType<typeof normalizeInstance>,
  kind: InstanceContentKind,
  gameDirectory: string,
  filePath: string
) => {
  if (kind === 'mods' && isManagedBrandingBridgeFile({
    instanceRoot: getInstancePaths(instance).instanceRoot,
    gameDirectory,
    filePath
  })) {
    throw new Error('This NamLauncher game component is maintained automatically and cannot be changed here.')
  }
}

const updateManifestFilePath = (
  instance: ReturnType<typeof normalizeInstance>,
  oldPath: string,
  nextPath: string | null
) => {
  const manifest = readContentManifest(instance)
  let changed = false

  Object.entries(manifest.projects).forEach(([projectId, record]) => {
    const seenPaths = new Set<string>()
    const nextFiles = record.files
      .map((file) => {
        if (path.resolve(file.path) !== path.resolve(oldPath)) return file
        changed = true
        return nextPath ? { ...file, path: nextPath, filename: path.basename(nextPath) } : null
      })
      .filter(Boolean) as InstalledContentFile[]

    const uniqueFiles = nextFiles.filter((file) => {
      const resolvedPath = path.resolve(file.path)
      if (seenPaths.has(resolvedPath)) {
        changed = true
        return false
      }
      seenPaths.add(resolvedPath)
      return true
    })

    if (uniqueFiles.length === 0) {
      delete manifest.projects[projectId]
      changed = true
      return
    }

    manifest.projects[projectId] = {
      ...record,
      files: uniqueFiles,
      updatedAt: new Date().toISOString()
    }
  })

  if (changed) writeContentManifest(instance, manifest)
}

const toggleInstanceContent = async (request: InstanceContentRequest) => {
  const { instance, kind, gameDirectory, filePath, contentDirectory } = getSafeContentFilePath(request)
  assertInstanceContentMutable(instance, kind)
  assertContentFileIsNotLauncherManaged(instance, kind, gameDirectory, filePath)
  if (!fs.existsSync(filePath)) throw new Error('Content file was not found.')

  const enable = Boolean(request.enabled)
  const filename = path.basename(filePath)
  const disabled = isDisabledContentFile(filename)
  let nextPath = filePath

  if (enable && disabled) {
    nextPath = path.join(path.dirname(filePath), stripDisableSuffix(filename))
  } else if (!enable && !disabled) {
    nextPath = `${filePath}.disable`
  }

  assertChildPathIsSafe(contentDirectory, nextPath)

  if (nextPath !== filePath) {
    if (fs.existsSync(nextPath)) {
      if (!await reconcileMatchingContentFileCollision(filePath, nextPath)) {
        throw new Error('A different file already uses the target enabled/disabled name. Remove one duplicate in the instance folder, refresh, and try again.')
      }
      updateManifestFilePath(instance, filePath, nextPath)
    } else {
      fs.renameSync(filePath, nextPath)
      updateManifestFilePath(instance, filePath, nextPath)
    }
  }

  const stat = fs.statSync(nextPath)
  return {
    success: true,
    filePath: nextPath,
    fileName: path.basename(nextPath),
    enabledFileName: stripDisableSuffix(path.basename(nextPath)),
    enabled: enable,
    updatedAt: stat.mtime.toISOString()
  }
}

const deleteInstanceContent = (request: InstanceContentRequest) => {
  const { instance, kind, gameDirectory, filePath } = getSafeContentFilePath(request)
  assertInstanceContentMutable(instance, kind)
  assertContentFileIsNotLauncherManaged(instance, kind, gameDirectory, filePath)
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true })
    updateManifestFilePath(instance, filePath, null)
  }

  return { success: true, deleted: !fs.existsSync(filePath) }
}

const getUniqueContentDestinationPath = (contentDirectory: string, filename: string) => {
  const parsed = path.parse(filename)
  let candidate = path.join(contentDirectory, filename)
  let index = 1

  while (fs.existsSync(candidate)) {
    candidate = path.join(contentDirectory, `${parsed.name} (${index})${parsed.ext}`)
    index += 1
  }

  return candidate
}

const sanitizeDroppedContentFilename = (filename: string) => {
  return path.basename(filename).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

const importInstanceContentFiles = (request: InstanceContentRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const kind = normalizeContentKind(request.kind)
  assertInstanceContentMutable(instance, kind)

  const { gameDirectory } = getInstancePaths(instance)
  const contentDirectory = getContentDirectory(gameDirectory, kind)
  ensureDir(contentDirectory)

  const filePaths = Array.from(new Set((request.filePaths || [])
    .map((filePath) => String(filePath || '').trim())
    .filter(Boolean)
  ))

  if (filePaths.length === 0) throw new Error('Drop one or more files to import.')

  const imported: Array<{ sourcePath: string; filePath: string; fileName: string }> = []
  const skipped: Array<{ sourcePath: string; reason: string }> = []
  const rejected: Array<{ sourcePath: string; reason: string }> = []

  for (const sourcePath of filePaths) {
    try {
      const stat = fs.statSync(sourcePath)
      if (!stat.isFile()) {
        skipped.push({ sourcePath, reason: 'Not a file' })
        continue
      }

      const safeName = sanitizeDroppedContentFilename(path.basename(sourcePath))
      if (!safeName || !isContentFileForKind(kind, safeName) || isDisabledContentFile(safeName)) {
        rejected.push({ sourcePath, reason: `Unsupported file for ${kind}` })
        continue
      }

      assertArchiveContentReadable(sourcePath, kind)

      const sourceResolved = path.resolve(sourcePath)
      const destination = getUniqueContentDestinationPath(contentDirectory, safeName)
      const destinationResolved = path.resolve(destination)
      if (sourceResolved === destinationResolved) {
        skipped.push({ sourcePath, reason: 'Already in this folder' })
        continue
      }

      assertChildPathIsSafe(contentDirectory, destination)
      fs.copyFileSync(sourcePath, destination)
      imported.push({ sourcePath, filePath: destination, fileName: path.basename(destination) })
    } catch (err) {
      rejected.push({
        sourcePath,
        reason: err instanceof Error ? err.message : 'Could not import file'
      })
    }
  }

  return {
    success: imported.length > 0,
    kind,
    imported,
    skipped,
    rejected,
    content: getInstanceContent({ instance, kind })
  }
}

const revealInstanceContentFile = (request: InstanceContentRequest) => {
  const { filePath, contentDirectory } = getSafeContentFilePath(request)
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath)
  } else {
    ensureDir(contentDirectory)
    shell.openPath(contentDirectory).catch(() => undefined)
  }
  return { success: true }
}

const normalizeModrinthProjectType = (value?: string): ModrinthProjectType => {
  if (value === 'modpack' || value === 'resourcepack' || value === 'shader') return value
  return 'mod'
}

const getModrinthLoaderFilters = (projectType: ModrinthProjectType, instance: ReturnType<typeof normalizeInstance>) => {
  if (projectType === 'mod') {
    if (instance.loader === 'vanilla') {
      throw new Error('Mods require a Fabric, Forge, Quilt, or NeoForge instance.')
    }
    return [instance.loader]
  }

  if (projectType === 'resourcepack') return ['minecraft']
  return []
}

const getModrinthInstallFolder = (projectType: ModrinthProjectType, gameDirectory: string) => {
  if (projectType === 'mod') return path.join(gameDirectory, 'mods')
  if (projectType === 'resourcepack') return path.join(gameDirectory, 'resourcepacks')
  if (projectType === 'shader') return path.join(gameDirectory, 'shaderpacks')
  throw new Error('Modpack installation is not supported yet.')
}

const isVersionCompatible = (
  version: ModrinthVersion,
  instance: ReturnType<typeof normalizeInstance>,
  loaderFilters: string[]
) => {
  if (!version.game_versions.includes(instance.version)) return false
  if (loaderFilters.length === 0) return true
  return loaderFilters.some((loader) => version.loaders.includes(loader))
}

const getProjectVersions = async (
  projectId: string,
  instance: ReturnType<typeof normalizeInstance>,
  loaderFilters: string[]
) => {
  const cacheKey = JSON.stringify({
    projectId,
    gameVersion: instance.version,
    loaders: [...loaderFilters].sort()
  })
  const cached = modrinthVersionCache.get(cacheKey)
  if (cached && Date.now() - cached.storedAt < MODRINTH_VERSION_CACHE_TTL_MS) {
    return cached.versions
  }
  if (cached) modrinthVersionCache.delete(cacheKey)

  const inFlight = modrinthVersionRequests.get(cacheKey)
  if (inFlight) return inFlight

  const request = requestModrinth<ModrinthVersion[]>(`${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}/version`, {
    params: {
      game_versions: JSON.stringify([instance.version]),
      ...(loaderFilters.length > 0 ? { loaders: JSON.stringify(loaderFilters) } : {}),
      include_changelog: false
    }
  }).then((versions) => {
    const normalized = Array.isArray(versions) ? versions : []
    setCachedModrinthVersions(cacheKey, normalized)
    return normalized
  }).finally(() => {
    modrinthVersionRequests.delete(cacheKey)
  })

  modrinthVersionRequests.set(cacheKey, request)
  return request
}

const getVersionById = async (versionId: string, signal?: AbortSignal) => {
  throwIfInstallCancelled(signal)
  return requestModrinth<ModrinthVersion>(`${MODRINTH_API_BASE}/version/${encodeURIComponent(versionId)}`, {
    params: {
      include_changelog: false
    },
    signal
  })
}

const selectProjectVersion = (versions: ModrinthVersion[]) => {
  const withFiles = versions.filter((version) => Array.isArray(version.files) && version.files.length > 0)
  return withFiles.find((version) => version.version_type === 'release') || withFiles[0] || null
}

const resolveCompatibleProjectVersion = async (
  projectId: string,
  projectType: ModrinthProjectType,
  instance: ReturnType<typeof normalizeInstance>,
  loaderFilters: string[]
) => {
  let versions = await getProjectVersions(projectId, instance, loaderFilters)
  if (versions.length === 0 && projectType !== 'mod' && loaderFilters.length > 0) {
    versions = await getProjectVersions(projectId, instance, [])
  }
  return selectProjectVersion(versions)
}

const getModrinthProjectId = (project?: ModrinthInstallRequest['project']) => {
  return String(project?.project_id || project?.id || project?.slug || '').trim()
}

const getModrinthProjectTitle = (project: ModrinthInstallRequest['project'], fallback: string) => {
  return String(project?.title || project?.slug || fallback)
}

const isInstallableModrinthFile = (projectType: ModrinthProjectType, file: ModrinthVersionFile) => {
  const filename = file.filename.toLowerCase()
  const ignoredTypes = ['sources-jar', 'dev-jar', 'javadoc-jar', 'signature']

  if (file.file_type && ignoredTypes.includes(file.file_type)) return false
  if (projectType === 'modpack') return filename.endsWith('.mrpack')
  if (projectType === 'mod') return filename.endsWith('.jar') || filename.endsWith('.litemod')
  if (projectType === 'resourcepack' || projectType === 'shader') return filename.endsWith('.zip')
  return false
}

const selectVersionFile = (projectType: ModrinthProjectType, version: ModrinthVersion) => {
  return version.files.find((file) => file.primary && isInstallableModrinthFile(projectType, file))
    || version.files.find((file) => isInstallableModrinthFile(projectType, file))
    || null
}

const sanitizeDownloadFileName = (filename: string) => {
  const safeName = path.basename(filename).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim()
  return safeName || 'download.jar'
}

const assertModrinthDownloadUrl = (url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.modrinth.com') {
    throw new Error('Refusing to download a file from an unsupported host.')
  }
}

const assertModpackDownloadUrl = (url: string) => {
  const parsed = new URL(url)
  const allowedHosts = new Set([
    'cdn.modrinth.com',
    'github.com',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'gitlab.com'
  ])

  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error(`Refusing to download an unsupported modpack file host: ${parsed.hostname}`)
  }
}

const resolveModpackRelativePath = (gameDirectory: string, relativePath: string) => {
  const rawPath = String(relativePath || '').replace(/\\/g, '/')
  const normalized = path.posix.normalize(rawPath).replace(/^\.\/+/, '')

  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:\//.test(rawPath) ||
    rawPath.startsWith('/')
  ) {
    throw new Error(`Unsafe modpack file path: ${relativePath}`)
  }

  const targetPath = path.join(gameDirectory, ...normalized.split('/').filter(Boolean))
  assertChildPathIsSafe(gameDirectory, targetPath)
  return targetPath
}

const hashFile = (filePath: string, algorithm: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash(algorithm)
  const stream = fs.createReadStream(filePath)

  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex')))
})

const verifyModrinthFile = async (filePath: string, file: ModrinthVersionFile) => {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
  if (file.size && fs.statSync(filePath).size !== file.size) return false

  const sha512 = String(file.hashes?.sha512 || '').trim().toLowerCase()
  if (/^[a-f0-9]{128}$/.test(sha512)) {
    return (await hashFile(filePath, 'sha512')).toLowerCase() === sha512
  }
  const sha1 = String(file.hashes?.sha1 || '').trim().toLowerCase()
  if (/^[a-f0-9]{40}$/.test(sha1)) {
    return (await hashFile(filePath, 'sha1')).toLowerCase() === sha1
  }
  return false
}

type DownloadCandidateValidator = (candidatePath: string) => Promise<void>
type DownloadRedirectValidator = (redirectUrl: string) => void

const assertModrinthFileVerifiable = (file: ModrinthVersionFile, filename: string) => {
  const sha512 = String(file.hashes?.sha512 || '').trim()
  const sha1 = String(file.hashes?.sha1 || '').trim()
  if (/^[a-f0-9]{128}$/i.test(sha512) || /^[a-f0-9]{40}$/i.test(sha1)) return
  throw new Error(`Modrinth did not provide a supported checksum for ${filename}.`)
}

const createModrinthCandidateValidator = (
  file: ModrinthVersionFile,
  filename: string
): DownloadCandidateValidator => {
  assertModrinthFileVerifiable(file, filename)
  return async (candidatePath) => {
    if (await verifyModrinthFile(candidatePath, file)) return

    const error = new Error(`Downloaded file failed verification: ${filename}`) as Error & { code?: string }
    error.code = DOWNLOAD_INTEGRITY_ERROR_CODE
    throw error
  }
}

const getMrpackDependencies = (instance: ReturnType<typeof normalizeInstance>) => {
  const dependencies: Record<string, string> = {
    minecraft: instance.version
  }

  if (instance.loader === 'fabric' && instance.loaderVersion) {
    dependencies['fabric-loader'] = instance.loaderVersion
  } else if (instance.loader === 'forge' && instance.loaderVersion) {
    dependencies.forge = instance.loaderVersion
  } else if (instance.loader === 'quilt' && instance.loaderVersion) {
    dependencies['quilt-loader'] = instance.loaderVersion
  } else if (instance.loader === 'neoforge' && instance.loaderVersion) {
    dependencies.neoforge = instance.loaderVersion
  }

  return dependencies
}

const getEnabledExportContentFiles = (instance: ReturnType<typeof normalizeInstance>) => {
  const { gameDirectory } = getInstancePaths(instance)
  const manifest = readContentManifest(instance)
  const items: Array<{
    kind: InstanceContentKind
    filePath: string
    relativePath: string
    filename: string
    size: number
    record?: InstalledContentRecord
  }> = []

  ;(['mods', 'resourcepacks', 'shaderpacks'] as InstanceContentKind[]).forEach((kind) => {
    const directory = getContentDirectory(gameDirectory, kind)
    if (!fs.existsSync(directory)) return

    fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isContentFileForKind(kind, entry.name) && !isDisabledContentFile(entry.name))
      .forEach((entry) => {
        const filePath = path.join(directory, entry.name)
        const stat = fs.statSync(filePath)
        const relativePath = path.relative(gameDirectory, filePath).replace(/\\/g, '/')
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return

        items.push({
          kind,
          filePath,
          relativePath,
          filename: entry.name,
          size: stat.size,
          record: findInstalledRecordForFile(manifest, filePath, entry.name)
        })
      })
  })

  return items.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

const selectExportVersionFile = async (
  record: InstalledContentRecord,
  filePath: string,
  filename: string
) => {
  if (record.projectType === 'modpack' || !record.versionId) return null

  try {
    const version = await getVersionById(record.versionId)
    const storedFile = record.files.find((file) => {
      return path.resolve(file.path) === path.resolve(filePath)
        || stripDisableSuffix(file.filename).toLowerCase() === stripDisableSuffix(filename).toLowerCase()
    })
    const installableFiles = version.files.filter((file) => isInstallableModrinthFile(record.projectType, file))
    const selected = installableFiles.find((file) => file.filename.toLowerCase() === stripDisableSuffix(filename).toLowerCase())
      || installableFiles.find((file) => storedFile?.hashes?.sha512 && file.hashes?.sha512 === storedFile.hashes.sha512)
      || installableFiles.find((file) => storedFile?.hashes?.sha1 && file.hashes?.sha1 === storedFile.hashes.sha1)
      || selectVersionFile(record.projectType, version)

    if (!selected?.url) return null
    assertModpackDownloadUrl(selected.url)

    if (!await verifyModrinthFile(filePath, selected)) return null
    return selected
  } catch (err) {
    log.warn(`Could not resolve Modrinth export metadata for ${filename}`, err)
    return null
  }
}

const addInstanceIconToMrpack = async (zip: AdmZip, iconUrl?: string | null) => {
  const source = String(iconUrl || '').trim()
  const dataMatch = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/)

  if (dataMatch) {
    const extension = dataMatch[1] === 'image/jpeg' ? 'jpg' : dataMatch[1].split('/')[1]
    const buffer = Buffer.from(dataMatch[2], 'base64')
    if (buffer.length > 0 && buffer.length <= 1_500_000) {
      zip.addFile(`icon.${extension}`, buffer)
    }
    return
  }

  if (!source) return

  try {
    const parsed = new URL(source)
    if (parsed.protocol !== 'https:') return

    const response = await axios.get<ArrayBuffer>(source, {
      headers: HTTP_HEADERS,
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: 1_500_000
    })
    const contentType = String(response.headers['content-type'] || '').toLowerCase()
    const extension = contentType.includes('jpeg') || contentType.includes('jpg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png'
    const buffer = Buffer.from(response.data as any)
    if (buffer.length > 0 && buffer.length <= 1_500_000) {
      zip.addFile(`icon.${extension}`, buffer)
    }
  } catch (err) {
    log.warn('Could not include instance icon in exported .mrpack', err)
  }
}

const exportInstanceMrpack = async (
  input: LauncherInstance | undefined,
  outputPath: string
): Promise<ExportInstanceMrpackResult> => {
  const instance = normalizeInstance({ instance: input })
  const { instanceRoot } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)

  const zip = new AdmZip()
  const packFiles: ModrinthPackFile[] = []
  const contentFiles = getEnabledExportContentFiles(instance)
  let overrideFiles = 0

  sendProgress({ type: 'content-export', task: 8, total: 100, detail: 'Preparing export' })

  for (let index = 0; index < contentFiles.length; index += 1) {
    const item = contentFiles[index]
    const modrinthFile = item.record
      ? await selectExportVersionFile(item.record, item.filePath, item.filename)
      : null

    if (modrinthFile?.url) {
      packFiles.push({
        path: item.relativePath,
        hashes: modrinthFile.hashes || {},
        env: {
          client: 'required',
          server: 'unsupported'
        },
        downloads: [modrinthFile.url],
        fileSize: modrinthFile.size || item.size
      })
    } else {
      zip.addFile(`overrides/${item.relativePath}`, fs.readFileSync(item.filePath))
      overrideFiles += 1
    }

    sendProgress({
      type: 'content-export',
      task: 8 + Math.round(((index + 1) / Math.max(1, contentFiles.length)) * 82),
      total: 100,
      detail: item.relativePath
    })
    await yieldToEventLoop()
  }

  const packIndex: ModrinthPackIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: `namlauncher-${instance.id}-${Date.now()}`,
    name: instance.name,
    summary: `Exported from NamLauncher for Minecraft ${instance.version}.`,
    files: packFiles,
    dependencies: getMrpackDependencies(instance)
  }

  await addInstanceIconToMrpack(zip, instance.iconUrl)
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(packIndex, null, 2), 'utf8'))

  const finalPath = outputPath.toLowerCase().endsWith('.mrpack') ? outputPath : `${outputPath}.mrpack`
  ensureDir(path.dirname(finalPath))
  zip.writeZip(finalPath)

  sendProgress({ type: 'content-export', task: 100, total: 100, detail: path.basename(finalPath) })

  return {
    success: true,
    filePath: finalPath,
    modrinthFiles: packFiles.length,
    overrideFiles,
    totalFiles: contentFiles.length
  }
}

const recordFilesExist = (record?: InstalledContentRecord) => {
  if (!record || record.files.length === 0) return false
  return record.files.every((file) => fs.existsSync(file.path))
}

const getLocalContentFilePath = (
  projectType: ModrinthProjectType,
  gameDirectory: string,
  filename: string
) => {
  const installDirectory = getModrinthInstallFolder(projectType, gameDirectory)
  const enabledPath = path.join(installDirectory, sanitizeDownloadFileName(filename))
  const disabledPath = `${enabledPath}.disable`
  if (fs.existsSync(enabledPath)) return enabledPath
  if (fs.existsSync(disabledPath)) return disabledPath
  return enabledPath
}

const findInstalledVersionFromFiles = async (
  projectType: ModrinthProjectType,
  instance: ReturnType<typeof normalizeInstance>,
  versions: ModrinthVersion[]
) => {
  const { gameDirectory } = getInstancePaths(instance)

  for (const version of versions) {
    const file = selectVersionFile(projectType, version)
    if (!file) continue

    const candidatePath = getLocalContentFilePath(projectType, gameDirectory, file.filename)
    if (!fs.existsSync(candidatePath)) continue

    try {
      if (await verifyModrinthFile(candidatePath, file)) {
        return { version, file, path: candidatePath }
      }
    } catch (err) {
      log.debug(`Could not verify local Modrinth file ${candidatePath}`, err)
    }
  }

  return null
}

const getModrinthContentStatuses = async (request: ModrinthContentStatusRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const manifest = readContentManifest(instance)
  const projects = Array.isArray(request.projects) ? request.projects.filter(Boolean) : []
  const statuses: Record<string, any> = {}

  await Promise.all(projects.map(async (project) => {
    const projectId = getModrinthProjectId(project)
    if (!projectId) return

    const projectType = normalizeModrinthProjectType(project?.project_type)
    const installed = manifest.projects[projectId]

    try {
      if (projectType === 'modpack') {
        statuses[projectId] = { state: 'install' }
        return
      }

      if (!installed || !recordFilesExist(installed)) {
        statuses[projectId] = { state: 'install' }
        return
      }

      const loaderFilters = getModrinthLoaderFilters(projectType, instance)
      let versions = await getProjectVersions(projectId, instance, loaderFilters)
      if (versions.length === 0 && projectType !== 'mod' && loaderFilters.length > 0) {
        versions = await getProjectVersions(projectId, instance, [])
      }
      const latest = selectProjectVersion(versions)

      if (!latest) {
        statuses[projectId] = {
          state: installed && recordFilesExist(installed) ? 'installed' : 'unavailable',
          reason: `No compatible version for Minecraft ${instance.version}.`,
          installedVersion: installed?.versionNumber || null,
          installedVersionId: installed?.versionId || null
        }
        return
      }

      statuses[projectId] = installed.versionId === latest.id
          ? {
              state: 'installed',
              installedVersion: installed.versionNumber,
              installedVersionId: installed.versionId,
              latestVersion: latest.version_number,
              latestVersionId: latest.id
            }
          : {
              state: 'update',
              installedVersion: installed.versionNumber,
              installedVersionId: installed.versionId,
              latestVersion: latest.version_number,
              latestVersionId: latest.id
            }
    } catch (err: any) {
      statuses[projectId] = {
        state: recordFilesExist(installed) ? 'installed' : 'unavailable',
        reason: err?.message || 'Could not resolve compatible version.',
        installedVersion: installed?.versionNumber || null,
        installedVersionId: installed?.versionId || null
      }
    }
  }))

  return statuses
}

const normalizeLocalProjectSearchText = (value: string) => String(value || '')
  .replace(/\.(jar|litemod|zip)$/i, '')
  .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
  .replace(/\b(?:fabric|forge|neoforge|quilt|mc|minecraft)\b/gi, ' ')
  .replace(/\b\d+(?:\.\d+)+(?:[-+][0-9a-z.-]+)?\b/gi, ' ')
  .replace(/[_+.-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

type InstanceContentResultItem = Awaited<ReturnType<typeof getInstanceContent>>[number]

const getLocalModSearchTerms = (item: InstanceContentResultItem) => {
  const terms = [
    normalizeLocalProjectSearchText(item.name),
    normalizeLocalProjectSearchText(item.enabledFileName),
    normalizeLocalProjectSearchText(item.fileName)
  ].filter((value) => value.length >= 3)

  return Array.from(new Set(terms)).slice(0, 3)
}

const resolveLocalModrinthRecord = async (
  instance: ReturnType<typeof normalizeInstance>,
  item: InstanceContentResultItem
) => {
  if (item.kind !== 'mods' || item.projectId || !item.enabled) return null

  const loaderFilters = getModrinthLoaderFilters('mod', instance)
  const terms = getLocalModSearchTerms(item)
  if (terms.length === 0) return null

  for (const query of terms) {
    const result = await searchModrinthProjects({
      query,
      projectType: 'mod',
      limit: 5,
      offset: 0
    }) as { hits?: Array<Record<string, any>> }

    for (const project of result.hits || []) {
      const projectId = getModrinthProjectId(project)
      if (!projectId) continue

      const versions = await getProjectVersions(projectId, instance, loaderFilters)
      if (versions.length === 0) continue

      for (const version of versions) {
        const file = selectVersionFile('mod', version)
        if (!file || !await verifyModrinthFile(item.filePath, file)) continue

        const latest = selectProjectVersion(versions)
        return {
          record: {
            projectId,
            title: getModrinthProjectTitle(project, item.name),
            projectType: 'mod' as ModrinthProjectType,
            iconUrl: typeof project.icon_url === 'string' ? project.icon_url : item.iconUrl || null,
            versionId: version.id,
            versionNumber: version.version_number,
            versionName: version.name,
            gameVersion: instance.version,
            loader: instance.loader,
            files: [{
              filename: path.basename(item.filePath),
              path: item.filePath,
              hashes: file.hashes || {},
              dependency: false
            }],
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            provider: 'modrinth' as ContentProvider
          },
          latest
        }
      }
    }
  }

  return null
}

const getInstanceUpdateSummary = async (request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  const manifest = readContentManifest(instance)
  const records = Object.values(manifest.projects)
    .filter((record) => record.projectType !== 'modpack')
    .filter((record) => recordFilesExist(record))
  const updates: ContentUpdateItem[] = []

  for (const record of records) {
    try {
      if (record.provider === 'curseforge') {
        const modId = Number(record.projectId.replace(/^curseforge:/i, ''))
        if (!modId) continue
        const projectType = normalizeCurseForgeProjectType(record.projectType)
        if (projectType === 'modpack') continue
        const latestFile = (await getCurseForgeCompatibleFiles(modId, instance, projectType))[0]
        if (!latestFile || String(latestFile.id) === record.versionId) continue

        updates.push({
          projectId: record.projectId,
          title: record.title,
          projectType,
          iconUrl: record.iconUrl || null,
          installedVersion: record.versionNumber,
          installedVersionId: record.versionId,
          latestVersion: latestFile.displayName || latestFile.fileName,
          latestVersionId: String(latestFile.id),
          provider: 'curseforge'
        })
        continue
      }

      const projectType = record.projectType as Exclude<ModrinthProjectType, 'modpack'>
      const loaderFilters = getModrinthLoaderFilters(projectType, instance)
      const latest = await resolveCompatibleProjectVersion(record.projectId, projectType, instance, loaderFilters)

      if (!latest || latest.id === record.versionId) continue

      updates.push({
        projectId: record.projectId,
        title: record.title,
        projectType,
        iconUrl: record.iconUrl || null,
        installedVersion: record.versionNumber,
        installedVersionId: record.versionId,
        latestVersion: latest.version_number,
        latestVersionId: latest.id,
        provider: 'modrinth'
      })
    } catch (err) {
      log.warn(`Could not check update for ${record.title}`, err)
    }
  }

  return {
    updates,
    checkedAt: new Date().toISOString()
  }
}

const getRedirectTargetUrl = (options: Record<string, any>) => {
  const protocol = String(options.protocol || '').toLowerCase()
  const hostname = String(options.hostname || '').toLowerCase()
  const port = options.port ? `:${String(options.port)}` : ''
  if (!protocol || !hostname) throw new Error('Refusing a redirect with an invalid target.')
  return new URL(String(options.path || '/'), `${protocol}//${hostname}${port}`).toString()
}

const getDownloadUrlForLog = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return sanitizeBugReport(parsed.toString())
  } catch {
    return '[invalid download URL]'
  }
}

const replaceFileWithCandidate = (candidatePath: string, targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    fs.renameSync(candidatePath, targetPath)
    return
  }

  const backupPath = `${targetPath}.${process.pid}-${crypto.randomUUID()}.backup`
  fs.renameSync(targetPath, backupPath)
  let replacementInstalled = false
  try {
    fs.renameSync(candidatePath, targetPath)
    replacementInstalled = true
  } catch (replacementError) {
    try {
      fs.renameSync(backupPath, targetPath)
    } catch (restoreError) {
      try {
        fs.copyFileSync(backupPath, targetPath)
      } catch {
        log.error('A verified download could not be installed and the previous file could not be restored automatically.', restoreError)
        throw new Error('NamLauncher could not safely replace the existing file. The previous copy was preserved as a backup.', {
          cause: replacementError
        })
      }
    }
    throw replacementError
  } finally {
    if (replacementInstalled && fs.existsSync(backupPath)) {
      try {
        fs.rmSync(backupPath, { force: true })
      } catch (cleanupError) {
        log.warn('A download backup could not be removed after a successful replacement.', cleanupError)
      }
    }
  }
}

const downloadFile = async (
  url: string,
  filePath: string,
  progressType: string,
  force = false,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
  maxBytes = MAX_CONTENT_DOWNLOAD_BYTES,
  validateCandidate?: DownloadCandidateValidator,
  validateRedirect?: DownloadRedirectValidator
) => withFileDownloadLock(filePath, async () => {
  throwIfInstallCancelled(signal)
  if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return filePath
  }

  ensureDir(path.dirname(filePath))
  const legacyTempPath = `${filePath}.download`
  const tempPath = `${filePath}.${process.pid}-${crypto.randomUUID()}.download`
  if (fs.existsSync(legacyTempPath)) fs.rmSync(legacyTempPath, { force: true })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })

    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        headers: HTTP_HEADERS,
        timeout: 120000,
        signal,
        maxRedirects: validateRedirect ? 5 : undefined,
        beforeRedirect: validateRedirect
          ? (options: Record<string, any>) => validateRedirect(getRedirectTargetUrl(options))
          : undefined,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes
      })
      throwIfInstallCancelled(signal)

      const totalLength = Number(response.headers['content-length']) || 0
      if (totalLength > maxBytes) {
        throw new Error('The download is larger than NamLauncher can install safely.')
      }

      let downloadedLength = 0
      let lastProgressAt = 0
      let lastProgressValue = -1
      const writer = fs.createWriteStream(tempPath)

      response.data.on('data', (chunk: Buffer) => {
        downloadedLength += chunk.length
        if (downloadedLength > maxBytes) {
          const error = new Error('The download is larger than NamLauncher can install safely.')
          response.data.destroy(error)
          writer.destroy(error)
          return
        }
        if (totalLength > 0) {
          const progressValue = Math.round((downloadedLength / totalLength) * 100)
          const now = Date.now()
          if (progressValue !== lastProgressValue && (now - lastProgressAt > 250 || progressValue >= 100)) {
            lastProgressAt = now
            lastProgressValue = progressValue
            if (onProgress) {
              onProgress(Math.min(progressValue, 100))
            } else {
              sendProgress({
                type: progressType,
                task: progressValue,
                total: 100
              })
            }
          }
        }
      })

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error | null) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve()
        }
        const abort = () => {
          const error = new Error(INSTALL_CANCELLED_MESSAGE)
          response.data.destroy?.(error)
          writer.destroy(error)
          finish(error)
        }
        if (signal?.aborted) {
          abort()
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
        response.data.on('error', (error: Error) => finish(error))
        writer.on('error', (error) => finish(error))
        writer.on('finish', () => finish())
        response.data.pipe(writer)
      })
      throwIfInstallCancelled(signal)
      if (validateCandidate) await validateCandidate(tempPath)
      replaceFileWithCandidate(tempPath, filePath)
      return filePath
    } catch (err) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
      if (signal?.aborted || isInstallCancelledError(err, signal)) throw err
      if (attempt >= 2 || !shouldRetryDownloadError(err)) throw err

      const retryDelay = getGenericRetryAfterMs(err, 750 * (attempt + 1))
      log.warn(`Download failed; retrying in ${retryDelay}ms: ${getDownloadUrlForLog(url)}`, getCompactErrorLog(err))
      await waitForModrinthRetry(retryDelay, signal)
    }
  }

  throw new Error(`Could not download ${url}`)
})

const getDeclaredDownloadLimit = (declaredSize?: number | null) => {
  const size = Number(declaredSize)
  if (!Number.isFinite(size) || size <= 0) return MAX_CONTENT_DOWNLOAD_BYTES
  return Math.min(Math.ceil(size), MAX_CONTENT_DOWNLOAD_BYTES)
}

const downloadModrinthFile = async (
  file: ModrinthVersionFile,
  installDirectory: string,
  signal?: AbortSignal
) => {
  throwIfInstallCancelled(signal)
  assertModrinthDownloadUrl(file.url)
  ensureDir(installDirectory)

  const filename = sanitizeDownloadFileName(file.filename)
  const targetPath = path.join(installDirectory, filename)
  const targetExisted = fs.existsSync(targetPath)

  if (targetExisted && await verifyModrinthFile(targetPath, file)) {
    return { filename, path: targetPath, skipped: true, created: false }
  }

  await downloadFile(
    file.url,
    targetPath,
    'content-download',
    true,
    signal,
    undefined,
    getDeclaredDownloadLimit(file.size),
    createModrinthCandidateValidator(file, filename),
    assertModrinthDownloadUrl
  )

  return { filename, path: targetPath, skipped: false, created: !targetExisted }
}

const getModrinthProjectVersions = async (request: ModrinthInstallRequest) => {
  const project = request.project || {}
  const projectId = String(request.projectId || getModrinthProjectId(project)).trim()
  const projectType = normalizeModrinthProjectType(request.projectType || project.project_type)

  if (!projectId) throw new Error('Missing Modrinth project id.')

  let versions: ModrinthVersion[]
  if (request.instance && projectType !== 'modpack') {
    const instance = normalizeInstance({ instance: request.instance })
    const loaderFilters = getModrinthLoaderFilters(projectType, instance)
    versions = await getProjectVersions(projectId, instance, loaderFilters)
    if (versions.length === 0 && projectType !== 'mod' && loaderFilters.length > 0) {
      versions = await getProjectVersions(projectId, instance, [])
    }
    versions = versions.filter((version) => isVersionCompatible(version, instance, projectType === 'mod' ? loaderFilters : []))
  } else {
    versions = await requestModrinth<ModrinthVersion[]>(`${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}/version`, {
      params: { include_changelog: false }
    })
  }

  return versions
    .filter((version) => version.files.some((file) => isInstallableModrinthFile(projectType, file)))
    .map((version: any) => ({
      id: version.id,
      name: version.name,
      version_number: version.version_number,
      version_type: version.version_type,
      game_versions: version.game_versions || [],
      loaders: version.loaders || [],
      date_published: version.date_published || version.datePublished || null,
      files: version.files || []
    }))
}

const downloadModpackArchive = async (
  version: ModrinthVersion,
  signal?: AbortSignal,
  onProgress?: (percent: number, detail: string) => void
) => {
  throwIfInstallCancelled(signal)
  const file = selectVersionFile('modpack', version)
  if (!file) throw new Error(`No .mrpack file found for ${version.name}.`)

  assertModrinthDownloadUrl(file.url)
  const cacheDirectory = path.join(userDataPath, 'cache', 'modpacks')
  ensureDir(cacheDirectory)

  const filename = `${version.id}-${sanitizeDownloadFileName(file.filename)}`
  const targetPath = path.join(cacheDirectory, filename)

  if (fs.existsSync(targetPath) && await verifyModrinthFile(targetPath, file)) {
    return targetPath
  }

  await downloadFile(file.url, targetPath, 'content-download', true, signal, (percent) => {
    onProgress?.(percent, file.filename)
  }, getDeclaredDownloadLimit(file.size), createModrinthCandidateValidator(file, file.filename), assertModrinthDownloadUrl)

  return targetPath
}

const getLocalMrpackVersion = (filePath: string, index: ModrinthPackIndex): ModrinthVersion => {
  const stat = fs.statSync(filePath)
  const hash = crypto
    .createHash('sha1')
    .update(`${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}:${index.versionId || index.name}`)
    .digest('hex')
    .slice(0, 12)
  const dependencies = index.dependencies || {}
  const loaders = Object.keys(dependencies)
    .filter((key) => key === 'fabric-loader' || key === 'forge' || key === 'quilt-loader' || key === 'neoforge')

  return {
    id: index.versionId || `local-${hash}`,
    project_id: `local-${hash}`,
    name: index.name || path.basename(filePath, '.mrpack'),
    version_number: index.versionId || 'local',
    version_type: 'release',
    game_versions: dependencies.minecraft ? [dependencies.minecraft] : [],
    loaders,
    files: []
  }
}

const getModpackIconDataUrl = (zip: AdmZip) => {
  const candidates = [
    'icon.png',
    'icon.jpg',
    'icon.jpeg',
    'icon.webp',
    'overrides/icon.png',
    'overrides/icon.jpg',
    'overrides/icon.jpeg',
    'overrides/icon.webp',
    'client-overrides/icon.png',
    'client-overrides/icon.jpg',
    'client-overrides/icon.jpeg',
    'client-overrides/icon.webp'
  ]
  const entry = candidates
    .map((candidate) => zip.getEntry(candidate))
    .find((candidate) => candidate && !candidate.isDirectory)

  if (!entry) return null

  const ext = path.extname(entry.entryName).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png'

  try {
    const data = getZipEntryDataWithLimit(entry, MAX_MODPACK_ICON_BYTES, 'Modpack icon')
    return `data:${mime};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

const readModpackIndex = (zip: AdmZip): ModrinthPackIndex => {
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry || entry.isDirectory) throw new Error('This .mrpack is missing modrinth.index.json.')

  const index = JSON.parse(getZipEntryDataWithLimit(entry, MAX_MODPACK_INDEX_BYTES, 'Modrinth modpack index').toString('utf8')) as ModrinthPackIndex
  if (index.formatVersion !== 1 || index.game !== 'minecraft') {
    throw new Error('Unsupported Modrinth modpack format.')
  }

  if (!index.dependencies?.minecraft) {
    throw new Error('This modpack does not declare a Minecraft version.')
  }

  if (index.files !== undefined && !Array.isArray(index.files)) {
    throw new Error('This modpack has an invalid file list.')
  }

  if ((index.files || []).length > MAX_MODPACK_OVERRIDE_FILES) {
    throw new Error('This modpack contains too many files to install safely.')
  }

  return index
}

const getModpackInstanceFromIndex = (
  request: ModrinthInstallRequest,
  version: ModrinthVersion,
  index: ModrinthPackIndex
) => {
  const project = request.project || {}
  const projectId = String(request.projectId || getModrinthProjectId(project) || version.project_id).trim()
  const dependencies = index.dependencies || {}
  const minecraftVersion = dependencies.minecraft || version.game_versions[0]
  let loader: LoaderType = 'vanilla'
  let loaderVersion = ''

  if (dependencies['fabric-loader']) {
    loader = 'fabric'
    loaderVersion = dependencies['fabric-loader']
  } else if (dependencies.forge) {
    loader = 'forge'
    loaderVersion = dependencies.forge
  } else if (dependencies['quilt-loader']) {
    loader = 'quilt'
    loaderVersion = dependencies['quilt-loader']
  } else if (dependencies.neoforge) {
    loader = 'neoforge'
    loaderVersion = dependencies.neoforge
  }

  return {
    id: `modpack-${projectId || 'pack'}-${version.id}-${Date.now()}`,
    name: getModrinthProjectTitle(project, index.name || version.name),
    version: minecraftVersion,
    loader,
    loaderVersion,
    iconUrl: project.icon_url || null,
    createdAt: new Date().toISOString(),
    playtimeSeconds: 0
  }
}

const getProjectTypeFromModpackPath = (filePath: string): Exclude<ModrinthProjectType, 'modpack'> | null => {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  if (normalized.startsWith('mods/')) return 'mod'
  if (normalized.startsWith('resourcepacks/')) return 'resourcepack'
  if (normalized.startsWith('shaderpacks/')) return 'shader'
  return null
}

const resolveModpackClientFilePlan = async (
  files: ModrinthPackFile[],
  minecraftVersion: string,
  signal?: AbortSignal
) => {
  const optionalVersionIds = Array.from(new Set(files
    .filter((file) => file.env?.client === 'optional')
    .map((file) => getModrinthPackFileIdentity(file)?.versionId || '')
    .filter(Boolean)))
  const versionsById = new Map<string, ModrinthVersion>()

  for (let offset = 0; offset < optionalVersionIds.length; offset += 100) {
    throwIfInstallCancelled(signal)
    const versionIds = optionalVersionIds.slice(offset, offset + 100)
    try {
      const versions = await requestModrinth<ModrinthVersion[]>(`${MODRINTH_API_BASE}/versions`, {
        params: {
          ids: JSON.stringify(versionIds),
          include_changelog: false
        },
        signal
      })
      for (const version of Array.isArray(versions) ? versions : []) {
        if (version?.id) versionsById.set(version.id, version)
      }
    } catch (err) {
      if (signal?.aborted || isInstallCancelledError(err, signal)) throw err
      log.warn(
        `Could not verify ${versionIds.length} optional modpack file${versionIds.length === 1 ? '' : 's'}; preserving the pack declaration.`,
        getCompactErrorLog(err)
      )
    }
  }

  const plan = planModpackClientFiles(files, minecraftVersion, versionsById)
  for (const file of plan.skippedIncompatibleFiles) {
    log.warn(`Skipping optional modpack file that does not support Minecraft ${minecraftVersion}: ${file.path}`)
  }
  return plan
}

const verifyModpackFile = async (filePath: string, file: ModrinthPackFile) => {
  const fileForHash: ModrinthVersionFile = {
    url: '',
    filename: path.basename(file.path),
    hashes: file.hashes,
    size: file.fileSize
  }
  return verifyModrinthFile(filePath, fileForHash)
}

const downloadModpackIndexFile = async (
  file: ModrinthPackFile,
  gameDirectory: string,
  signal?: AbortSignal,
  onProgress?: (percent: number, detail: string) => void
) => {
  throwIfInstallCancelled(signal)
  if (!Array.isArray(file.downloads) || file.downloads.length === 0) {
    throw new Error(`No download URL for ${file.path}`)
  }

  const supportedUrls = Array.from(new Set(file.downloads.filter((candidate) => {
    try {
      assertModpackDownloadUrl(candidate)
      return true
    } catch {
      return false
    }
  })))
  if (supportedUrls.length === 0) throw new Error(`No supported download URL for ${file.path}`)

  const targetPath = resolveModpackRelativePath(gameDirectory, file.path)
  ensureDir(path.dirname(targetPath))
  const identity = getModrinthPackFileIdentity(file)
  const projectType = getProjectTypeFromModpackPath(file.path)
  const filename = path.basename(targetPath)

  if (fs.existsSync(targetPath) && await verifyModpackFile(targetPath, file)) {
    return {
      filename,
      path: targetPath,
      skipped: true,
      hashes: file.hashes,
      projectType,
      projectId: identity?.projectId || null,
      versionId: identity?.versionId || null
    }
  }

  const validateCandidate = createModrinthCandidateValidator({
    url: supportedUrls[0],
    filename,
    hashes: file.hashes,
    size: file.fileSize
  }, file.path)
  let lastMirrorError: unknown = null
  let downloadedFromMirror = false
  for (const url of supportedUrls) {
    try {
      await downloadFile(url, targetPath, 'content-download', true, signal, (percent) => {
        onProgress?.(percent, file.path)
      }, getDeclaredDownloadLimit(file.fileSize), validateCandidate, assertModpackDownloadUrl)
      downloadedFromMirror = true
      break
    } catch (err) {
      if (signal?.aborted || isInstallCancelledError(err, signal)) throw err
      lastMirrorError = err
      log.warn(`Modpack mirror failed for ${file.path}; trying another declared mirror.`, getCompactErrorLog(err))
    }
  }
  if (!downloadedFromMirror) {
    throw new Error(`All supported download mirrors failed for ${file.path}.`, { cause: lastMirrorError })
  }

  return {
    filename,
    path: targetPath,
    skipped: false,
    hashes: file.hashes,
    projectType,
    projectId: identity?.projectId || null,
    versionId: identity?.versionId || null
  }
}

const extractModpackOverrides = async (zip: AdmZip, gameDirectory: string, signal?: AbortSignal) => {
  let count = 0
  const overridePrefixes = ['overrides/', 'client-overrides/']
  const entries = zip.getEntries()
    .filter((entry) => !entry.isDirectory && overridePrefixes.some((prefix) => entry.entryName.startsWith(prefix)))
  preflightModpackOverrideEntries(entries, 'Modrinth modpack')

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    throwIfInstallCancelled(signal)
    const entry = entries[entryIndex]
    const prefix = overridePrefixes.find((candidate) => entry.entryName.startsWith(candidate)) || ''
    const relativePath = entry.entryName.slice(prefix.length)
    if (!relativePath) continue

    const targetPath = resolveModpackRelativePath(gameDirectory, relativePath)
    writeZipEntryToFile(entry, targetPath, 'Modrinth modpack override file')
    count += 1
    sendProgress({
      type: 'content-install',
      task: 86 + Math.round(((entryIndex + 1) / Math.max(1, entries.length)) * 10),
      total: 100,
      detail: relativePath
    })
    if (count % 12 === 0) await yieldToEventLoop()
  }

  return count
}

const persistModpackInstalledContent = (
  instance: ReturnType<typeof normalizeInstance>,
  installedItems: Array<{
    filename: string
    path: string
    skipped: boolean
    hashes?: Record<string, string>
    projectType: Exclude<ModrinthProjectType, 'modpack'> | null
    projectId: string | null
    versionId: string | null
  }>
) => {
  const manifest = readContentManifest(instance)
  const now = new Date().toISOString()
  let changed = false

  installedItems
    .filter((item) => item.projectId && item.versionId && item.projectType)
    .forEach((item) => {
      const projectId = item.projectId as string
      const projectType = item.projectType as Exclude<ModrinthProjectType, 'modpack'>
      const previous = manifest.projects[projectId]

      manifest.projects[projectId] = {
        projectId,
        provider: 'modrinth',
        title: previous?.title || path.basename(item.filename).replace(/\.(jar|litemod|zip)$/i, ''),
        projectType,
        iconUrl: previous?.iconUrl || null,
        versionId: item.versionId as string,
        versionNumber: previous?.versionNumber && previous.versionId === item.versionId
          ? previous.versionNumber
          : item.versionId as string,
        versionName: previous?.versionName && previous.versionId === item.versionId
          ? previous.versionName
          : item.filename,
        gameVersion: instance.version,
        loader: instance.loader,
        files: [{
          filename: item.filename,
          path: item.path,
          hashes: item.hashes,
          dependency: false
        }],
        installedAt: previous?.installedAt || now,
        updatedAt: now
      }
      changed = true
    })

  if (changed) writeContentManifest(instance, manifest)
}

const installModpackArchive = async (
  request: ModrinthInstallRequest,
  version: ModrinthVersion,
  archivePath: string,
  options: {
    projectId: string
    source: 'modrinth' | 'local'
    sourcePath?: string
    zip?: AdmZip
    index?: ModrinthPackIndex
    signal?: AbortSignal
  }
) => {
  const signal = options.signal
  throwIfInstallCancelled(signal)
  const project = request.project || {}
  const zip = options.zip || new AdmZip(archivePath)
  const index = options.index || readModpackIndex(zip)
  const instance = getModpackInstanceFromIndex(request, version, index)
  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)

  assertInstancePathIsSafe(instanceRoot)
  ensureDir(gameDirectory)

  const filePlan = await resolveModpackClientFilePlan(index.files || [], instance.version, signal)
  const packFiles = filePlan.installableFiles
  sendProgress({ type: 'content-install', task: 15, total: 100, detail: index.name })

  let installedFiles = 0
  let skippedFiles = 0
  const installedItems: Awaited<ReturnType<typeof downloadModpackIndexFile>>[] = []
  for (let indexFile = 0; indexFile < packFiles.length; indexFile += 1) {
    throwIfInstallCancelled(signal)
    const file = packFiles[indexFile]
    const fileStart = 15 + ((indexFile / Math.max(1, packFiles.length)) * 70)
    const fileEnd = 15 + (((indexFile + 1) / Math.max(1, packFiles.length)) * 70)
    sendProgress({
      type: 'content-install',
      task: Math.round(fileStart),
      total: 100,
      detail: file.path
    })
    const downloaded = await downloadModpackIndexFile(file, gameDirectory, signal, (percent, detail) => {
      sendProgress({
        type: 'content-install',
        task: Math.round(fileStart + ((fileEnd - fileStart) * (Math.min(Math.max(percent, 0), 100) / 100))),
        total: 100,
        detail
      })
    })
    installedItems.push(downloaded)
    if (downloaded.skipped) skippedFiles += 1
    else installedFiles += 1

    sendProgress({
      type: 'content-install',
      task: 15 + Math.round(((indexFile + 1) / Math.max(1, packFiles.length)) * 70),
      total: 100,
      detail: file.path
    })
    await yieldToEventLoop()
  }

  const overrideFiles = await extractModpackOverrides(zip, gameDirectory, signal)
  await provisionInstanceDefaults(instance)
  persistModpackInstalledContent(instance, installedItems)
  writeJsonFile(path.join(instanceRoot, 'namlauncher-modpack.json'), {
    projectId: options.projectId,
    projectTitle: getModrinthProjectTitle(project, index.name),
    versionId: version.id,
    versionNumber: version.version_number,
    modpackName: index.name,
    iconUrl: instance.iconUrl || null,
    source: options.source,
    sourcePath: options.sourcePath || null,
    installedAt: new Date().toISOString()
  })

  sendProgress({ type: 'content-install', task: 100, total: 100, detail: index.name })

  return {
    success: true,
    instance,
    version: version.version_number,
    installedFiles,
    skippedFiles,
    overrideFiles,
    incompatibleOptionalFiles: filePlan.skippedIncompatibleFiles.map((file) => file.path)
  }
}

const installModrinthModpack = async (request: ModrinthInstallRequest, signal?: AbortSignal) => {
  throwIfInstallCancelled(signal)
  const project = request.project || {}
  const projectId = String(request.projectId || getModrinthProjectId(project)).trim()
  if (!projectId) throw new Error('Missing Modrinth project id.')

  const version = request.versionId
    ? await getVersionById(request.versionId, signal)
    : selectProjectVersion(await requestModrinth<ModrinthVersion[]>(`${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}/version`, {
        params: { include_changelog: false },
        signal
      }))

  if (!version) throw new Error('No installable modpack version was found.')

  const archivePath = await downloadModpackArchive(version, signal, (percent, detail) => {
    sendProgress({
      type: 'content-install',
      task: 3 + Math.round((Math.min(Math.max(percent, 0), 100) / 100) * 9),
      total: 100,
      detail
    })
  })
  return installModpackArchive(request, version, archivePath, {
    projectId,
    source: 'modrinth',
    signal
  })
}

const installLocalMrpack = async (filePath: string, signal?: AbortSignal) => {
  throwIfInstallCancelled(signal)
  const archivePath = path.resolve(String(filePath || ''))
  if (!archivePath.toLowerCase().endsWith('.mrpack')) {
    throw new Error('Please choose a .mrpack file.')
  }
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    throw new Error('The selected .mrpack file was not found.')
  }

  sendProgress({ type: 'content-install', task: 2, total: 100, detail: `Reading ${path.basename(archivePath)}` })
  await yieldToEventLoop()
  throwIfInstallCancelled(signal)
  const zip = new AdmZip(archivePath)
  sendProgress({ type: 'content-install', task: 6, total: 100, detail: 'Validating modpack index' })
  throwIfInstallCancelled(signal)
  const index = readModpackIndex(zip)
  const version = getLocalMrpackVersion(archivePath, index)
  const iconUrl = getModpackIconDataUrl(zip)
  const projectId = version.project_id
  const request: ModrinthInstallRequest = {
    project: {
      project_id: projectId,
      id: projectId,
      title: index.name || path.basename(archivePath, '.mrpack'),
      project_type: 'modpack',
      icon_url: iconUrl
    },
    projectId,
    projectType: 'modpack',
    versionId: version.id
  }

  sendProgress({ type: 'content-install', task: 10, total: 100, detail: index.name || path.basename(archivePath) })
  return installModpackArchive(request, version, archivePath, {
    projectId,
    source: 'local',
    sourcePath: archivePath,
    zip,
    index,
    signal
  })
}

const installModrinthVersion = async (
  version: ModrinthVersion,
  projectType: ModrinthProjectType,
  instance: ReturnType<typeof normalizeInstance>,
  installDirectory: string,
  loaderFilters: string[],
  visited: Set<string>,
  createdPaths: Set<string>
): Promise<InstalledModrinthItem[]> => {
  if (visited.has(version.id)) return []
  visited.add(version.id)

  if (!isVersionCompatible(version, instance, loaderFilters)) {
    throw new Error(`No compatible version found for Minecraft ${instance.version}.`)
  }

  const installed: InstalledModrinthItem[] = []

  if (projectType === 'mod') {
    const requiredDependencies = (version.dependencies || [])
      .filter((dependency) => dependency.dependency_type === 'required')

    for (const dependency of requiredDependencies) {
      let dependencyVersion: ModrinthVersion | null = null

      if (dependency.version_id) {
        const exactVersion = await getVersionById(dependency.version_id)
        if (isVersionCompatible(exactVersion, instance, loaderFilters)) {
          dependencyVersion = exactVersion
        }
      }

      if (!dependencyVersion && dependency.project_id) {
        const dependencyVersions = await getProjectVersions(dependency.project_id, instance, loaderFilters)
        dependencyVersion = selectProjectVersion(dependencyVersions)
      }

      if (!dependencyVersion) {
        throw new Error('A required Modrinth dependency has no compatible version.')
      }

      const dependencyFiles = await installModrinthVersion(
        dependencyVersion,
        projectType,
        instance,
        installDirectory,
        loaderFilters,
        visited,
        createdPaths
      )
      installed.push(...dependencyFiles.map((item) => ({ ...item, dependency: true })))
      await yieldToEventLoop()
    }
  }

  const file = selectVersionFile(projectType, version)
  if (!file) {
    throw new Error(`No installable file found for ${version.name}.`)
  }

  sendProgress({ type: 'content-install', task: 35, total: 100, detail: file.filename })
  const downloaded = await downloadModrinthFile(file, installDirectory)
  if (downloaded.created) createdPaths.add(downloaded.path)
  await yieldToEventLoop()
  installed.push({
    ...downloaded,
    hashes: file.hashes,
    dependency: false,
    projectId: version.project_id,
    versionId: version.id,
    versionNumber: version.version_number,
    versionName: version.name
  })

  return installed
}

const groupInstalledItems = (items: InstalledModrinthItem[]) => {
  return items.reduce<Record<string, InstalledModrinthItem[]>>((groups, item) => {
    if (!groups[item.projectId]) groups[item.projectId] = []
    groups[item.projectId].push(item)
    return groups
  }, {})
}

const removeOutdatedContentFiles = (
  manifest: InstanceContentManifest,
  gameDirectory: string,
  installedItems: InstalledModrinthItem[]
) => {
  const grouped = groupInstalledItems(installedItems)

  Object.entries(grouped).forEach(([projectId, nextItems]) => {
    const previous = manifest.projects[projectId]
    if (!previous) return

    const nextPaths = new Set(nextItems.map((item) => path.resolve(item.path)))
    previous.files.forEach((file) => {
      const previousPath = path.resolve(file.path)
      if (nextPaths.has(previousPath) || !fs.existsSync(previousPath)) return

      if (!isPathInside(previousPath, gameDirectory)) {
        log.warn(`Ignored stale content manifest path outside the active instance: ${previousPath}`)
        return
      }
      fs.rmSync(previousPath, { force: true })
    })
  })
}

const removeLocalContentFileReplacedByInstall = (
  gameDirectory: string,
  localMatch: Awaited<ReturnType<typeof findInstalledVersionFromFiles>>,
  installedItems: InstalledModrinthItem[]
) => {
  if (!localMatch) return

  const localPath = path.resolve(localMatch.path)
  if (!fs.existsSync(localPath)) return

  const installedPaths = new Set(installedItems.map((item) => path.resolve(item.path)))
  if (installedPaths.has(localPath)) return

  const replacedByMainInstall = installedItems.some((item) => (
    item.projectId === localMatch.version.project_id && !item.dependency
  ))
  if (!replacedByMainInstall) return

  assertChildPathIsSafe(gameDirectory, localPath)
  fs.rmSync(localPath, { force: true })
  log.info(`Removed local content file replaced by Modrinth install: ${localPath}`)
}

const persistInstalledContent = (
  instance: ReturnType<typeof normalizeInstance>,
  project: ModrinthInstallRequest['project'],
  projectType: ModrinthProjectType,
  installedItems: InstalledModrinthItem[]
) => {
  const { gameDirectory } = getInstancePaths(instance)
  const manifest = readContentManifest(instance)
  const now = new Date().toISOString()
  const mainProjectId = getModrinthProjectId(project)
  const grouped = groupInstalledItems(installedItems)

  removeOutdatedContentFiles(manifest, gameDirectory, installedItems)

  Object.entries(grouped).forEach(([projectId, items]) => {
    const first = items[0]
    const previous = manifest.projects[projectId]
    const title = projectId === mainProjectId
      ? getModrinthProjectTitle(project, projectId)
      : previous?.title || projectId

    manifest.projects[projectId] = {
      projectId,
      provider: 'modrinth',
      title,
      projectType,
      iconUrl: projectId === mainProjectId ? project?.icon_url || previous?.iconUrl || null : previous?.iconUrl || null,
      versionId: first.versionId,
      versionNumber: first.versionNumber,
      versionName: first.versionName,
      gameVersion: instance.version,
      loader: instance.loader,
      files: items.map((item) => ({
        filename: item.filename,
        path: item.path,
        hashes: item.hashes,
        dependency: item.dependency
      })),
      installedAt: previous?.installedAt || now,
      updatedAt: now
    }
  })

  writeContentManifest(instance, manifest)
}

const installModrinthProject = async (request: ModrinthInstallRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const project = request.project || {}
  const projectId = String(request.projectId || getModrinthProjectId(project)).trim()
  const projectType = normalizeModrinthProjectType(request.projectType || project.project_type)

  if (!projectId) {
    throw new Error('Missing Modrinth project id.')
  }

  if (projectType === 'modpack') {
    throw new Error('Modpacks need a separate instance importer and cannot be dropped into mods.')
  }

  assertInstanceContentMutable(instance, projectType)
  const loaderFilters = getModrinthLoaderFilters(projectType, instance)
  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  ensureDir(gameDirectory)

  const installDirectory = getModrinthInstallFolder(projectType, gameDirectory)
  const title = project.title || project.slug || projectId
  sendProgress({ type: 'content-install', task: 10, total: 100, detail: title })

  let versions = await getProjectVersions(projectId, instance, loaderFilters)
  if (versions.length === 0 && projectType !== 'mod' && loaderFilters.length > 0) {
    versions = await getProjectVersions(projectId, instance, [])
  }
  versions = versions.filter((candidate) => (
    isVersionCompatible(candidate, instance, projectType === 'mod' ? loaderFilters : [])
    && candidate.files.some((file) => isInstallableModrinthFile(projectType, file))
  ))
  const requestedVersionId = String(request.versionId || '').trim()
  const version = requestedVersionId
    ? versions.find((candidate) => candidate.id === requestedVersionId) || null
    : selectProjectVersion(versions)
  if (requestedVersionId && !version) {
    throw new Error('Selected Modrinth version is not compatible with this instance.')
  }
  if (!version) {
    throw new Error(`No compatible ${projectType} version found for Minecraft ${instance.version}.`)
  }
  const localMatch = await findInstalledVersionFromFiles(projectType, instance, versions)

  const createdPaths = new Set<string>()
  let installed: InstalledModrinthItem[]
  try {
    installed = await installModrinthVersion(
      version,
      projectType,
      instance,
      installDirectory,
      loaderFilters,
      new Set<string>(),
      createdPaths
    )
  } catch (err) {
    for (const createdPath of createdPaths) {
      if (isPathInside(createdPath, installDirectory) && fs.existsSync(createdPath)) {
        fs.rmSync(createdPath, { force: true })
      }
    }
    throw err
  }

  removeLocalContentFileReplacedByInstall(gameDirectory, localMatch, installed)
  persistInstalledContent(instance, project, projectType, installed)

  sendProgress({ type: 'content-install', task: 100, total: 100, detail: title })

  return {
    success: true,
    projectType,
    version: version.version_number,
    installDirectory,
    installed
  }
}

const getCurseForgeModId = (project?: CurseForgeProject | null) => {
  const raw = String(project?.project_id || project?.id || '').replace(/^curseforge:/i, '')
  const modId = Number(raw)
  return Number.isInteger(modId) && modId > 0 ? modId : 0
}

const getCurseForgeProjectId = (modId: number | string) => `curseforge:${modId}`

const getCurseForgeLoaderName = (instance: ReturnType<typeof normalizeInstance>) => {
  if (instance.loader === 'forge' || instance.loader === 'fabric' || instance.loader === 'quilt' || instance.loader === 'neoforge') {
    return instance.loader
  }
  return undefined
}

const normalizeCurseForgeProjectType = (value?: string): ModrinthProjectType => normalizeModrinthProjectType(value)

const getCurseForgeProjectTypeFromClassId = (classId?: number): ModrinthProjectType => {
  const match = (Object.entries(CURSEFORGE_CLASS_IDS) as Array<[ModrinthProjectType, number]>)
    .find(([, id]) => id === classId)
  return match?.[0] || 'mod'
}

const getCurseForgeWebsiteSection = (projectType: ModrinthProjectType) => {
  if (projectType === 'modpack') return 'modpacks'
  if (projectType === 'resourcepack') return 'texture-packs'
  if (projectType === 'shader') return 'shaders'
  return 'mc-mods'
}

const getCurseForgeProjectWebsiteUrl = (mod: CurseForgeMod, projectType: ModrinthProjectType) => {
  return mod.links?.websiteUrl
    || `https://www.curseforge.com/minecraft/${getCurseForgeWebsiteSection(projectType)}/${encodeURIComponent(mod.slug)}`
}

const getCurseForgeFilePageUrl = (mod: CurseForgeMod, file: CurseForgeFile, projectType: ModrinthProjectType) => {
  return `${getCurseForgeProjectWebsiteUrl(mod, projectType).replace(/\/+$/, '')}/download/${file.id}`
}

const mapCurseForgeProject = (mod: CurseForgeMod, requestedType?: ModrinthProjectType) => {
  const projectType = requestedType || getCurseForgeProjectTypeFromClassId(mod.classId)
  return {
  id: mod.id,
  project_id: getCurseForgeProjectId(mod.id),
  provider: 'curseforge' as const,
  project_type: projectType,
  slug: mod.slug,
  title: mod.name,
  description: mod.summary || '',
  author: mod.authors?.map((author) => author.name).filter(Boolean).join(', ') || 'CurseForge author',
  downloads: Number(mod.downloadCount || 0),
  icon_url: mod.logo?.thumbnailUrl || mod.logo?.url || null,
  website_url: getCurseForgeProjectWebsiteUrl(mod, projectType),
  allow_distribution: mod.allowModDistribution !== false,
  available: mod.isAvailable !== false
  }
}

const normalizeModrinthSearchIndex = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'relevance' || normalized === 'updated' || normalized === 'newest') return normalized
  return 'downloads'
}

const searchModrinthProjects = async (request: ModrinthSearchRequest, signal?: AbortSignal) => {
  const offset = normalizeLibrarySearchOffset(request.offset)
  const limit = normalizeLibrarySearchLimit(request.limit)
  const projectType = normalizeModrinthProjectType(request.projectType)
  const query = normalizeLibrarySearchQuery(request.query)
  const index = normalizeModrinthSearchIndex(request.index)
  const requestedLoader = String(request.loader || '').trim().toLowerCase()
  const filters = normalizeLibrarySearchFilters({
    sort: index,
    gameVersion: request.gameVersion,
    loader: isLibraryLoader(requestedLoader) ? requestedLoader : '',
    environment: request.environment,
    openSourceOnly: request.openSourceOnly,
    compatibleOnly: false
  })
  const facets = buildModrinthSearchFacets(projectType, {
    sort: filters.sort,
    gameVersion: filters.gameVersion,
    loader: filters.loader,
    environment: filters.environment,
    openSourceOnly: filters.openSourceOnly
  })
  const cacheKey = JSON.stringify({ provider: 'modrinth', query, projectType, offset, limit, index, facets })
  const cached = getCachedProjectSearchResult(cacheKey)
  if (cached) return cached

  const inFlight = signal ? null : projectSearchInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const searchRequest = requestModrinth<{ hits?: any[]; total_hits?: number }>(`${MODRINTH_API_BASE}/search`, {
    timeout: 10000,
    signal,
    params: {
      query,
      limit,
      offset,
      index,
      facets: JSON.stringify(facets)
    }
  }).then((result) => {
    const hits = Array.isArray(result.hits) ? result.hits : []
    const normalizedResult = {
      ...result,
      hits,
      total_hits: normalizeLibraryTotalHits(result.total_hits, hits.length)
    }
    setCachedProjectSearchResult(cacheKey, normalizedResult)
    return normalizedResult
  }).catch((err) => {
    if (signal?.aborted || axios.isCancel(err)) throw err

    const staleResult = getCachedProjectSearchResult(cacheKey, true)
    const canUseStaleResult = shouldRetryModrinthRequest(err) || shouldFallbackToModrinthProxy(err)
    if (staleResult && canUseStaleResult) {
      log.warn('Modrinth search is temporarily unavailable; returning a cached result.', getCompactErrorLog(err))
      return { ...staleResult, stale: true }
    }
    throw err
  }).finally(() => {
    if (projectSearchInFlight.get(cacheKey) === searchRequest) {
      projectSearchInFlight.delete(cacheKey)
    }
  })

  if (!signal) projectSearchInFlight.set(cacheKey, searchRequest)
  return searchRequest
}

const getModrinthFailureMessage = (err: unknown, operation: 'search' | 'download') => {
  if (!axios.isAxiosError(err)) return 'Modrinth request failed unexpectedly.'
  const status = err.response?.status
  if (status === 429) return 'Modrinth is busy. Please wait a moment and try again.'
  if (status === 502 || status === 503 || status === 504) return 'Modrinth is temporarily unavailable. Please try again shortly.'
  if (status === 404 && operation === 'download') return 'The requested Modrinth file is no longer available.'
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'Modrinth did not respond before the request timed out.'
  return `Modrinth request failed${status ? ` (HTTP ${status})` : ''}. Check the network and try again.`
}

const searchCurseForgeProjects = async (request: CurseForgeSearchRequest, signal?: AbortSignal) => {
  const offset = normalizeLibrarySearchOffset(request.offset)
  const limit = normalizeLibrarySearchLimit(request.limit)
  const query = normalizeLibrarySearchQuery(request.query)
  const projectType = normalizeCurseForgeProjectType(request.projectType)
  const instance = request.instance ? normalizeInstance({ instance: request.instance }) : null
  const normalizedFilters = normalizeLibrarySearchFilters({
    sort: request.sort,
    compatibleOnly: false
  })
  const gameVersion = normalizeLibraryGameVersion(request.gameVersion) || (
    request.gameVersion === undefined && projectType !== 'modpack'
      ? normalizeLibraryGameVersion(instance?.version)
      : ''
  )
  const requestedLoader = String(request.loader || '').trim().toLowerCase()
  const instanceLoader = String(instance ? getCurseForgeLoaderName(instance) : '').trim().toLowerCase()
  const loader = projectType === 'mod'
    ? (isLibraryLoader(requestedLoader)
        ? requestedLoader
        : request.loader === undefined && isLibraryLoader(instanceLoader)
          ? instanceLoader
          : '')
    : ''
  const sort = normalizedFilters.sort === 'relevance' ? 'downloads' : normalizedFilters.sort
  const cacheKey = JSON.stringify({
    provider: 'curseforge',
    query,
    projectType,
    offset,
    limit,
    gameVersion,
    loader,
    sort
  })
  const cached = getCachedProjectSearchResult(cacheKey)
  if (cached) return cached

  log.info(`Searching CurseForge ${projectType} projects (query length=${query.length}, offset=${offset}, limit=${limit}).`)
  try {
    const response = await requestCurseForge<{ data?: CurseForgeMod[]; pagination?: { totalCount?: number } }>(
      '/projects',
      {
        signal,
        params: {
          content_type: projectType,
          q: query || undefined,
          game_version: gameVersion || undefined,
          loader: loader || undefined,
          sort,
          index: offset,
          page_size: limit
        }
      }
    )

    const hits = (response.data.data || []).map((mod) => mapCurseForgeProject(mod, projectType))
    const result = {
      hits,
      total_hits: normalizeLibraryTotalHits(response.data.pagination?.totalCount, hits.length)
    }
    setCachedProjectSearchResult(cacheKey, result)
    return result
  } catch (err) {
    if (signal?.aborted || axios.isCancel(err)) throw err
    const message = getCurseForgeFailureMessage(err, 'search')
    log.error(`CurseForge search failed: ${message}`)
    throw new Error(message)
  }
}

const getCurseForgeMod = async (modId: number, signal?: AbortSignal) => {
  const response = await requestCurseForge<{ data?: CurseForgeMod }>(`/projects/${modId}`, { signal })
  if (!response.data.data) throw new Error(`CurseForge project ${modId} was not found.`)
  return response.data.data
}

const getCurseForgeCompatibleFiles = async (
  modId: number,
  instance: ReturnType<typeof normalizeInstance> | null,
  projectType: ModrinthProjectType,
  signal?: AbortSignal
) => {
  const loader = instance ? getCurseForgeLoaderName(instance) : undefined
  if (projectType === 'mod' && !loader) throw new Error('CurseForge mods require a Fabric, Forge, Quilt, or NeoForge instance.')

  const response = await requestCurseForge<{ data?: CurseForgeFile[] }>(`/projects/${modId}/files`, {
    params: {
      game_version: instance?.version,
      loader: projectType === 'mod' || projectType === 'modpack' ? loader : undefined,
      page_size: 50
    },
    signal
  })

  return (response.data.data || [])
    .filter((file) => {
      const filename = file.fileName?.toLowerCase() || ''
      if (file.isAvailable === false) return false
      if (projectType === 'mod') return filename.endsWith('.jar') || filename.endsWith('.litemod')
      return filename.endsWith('.zip')
    })
    .sort((left, right) => new Date(right.fileDate || 0).getTime() - new Date(left.fileDate || 0).getTime())
}

const getCurseForgeFileById = async (modId: number, fileId: number, signal?: AbortSignal) => {
  const response = await requestCurseForge<{ data?: CurseForgeFile }>(`/projects/${modId}/files/${fileId}`, { signal })
  if (!response.data.data) throw new Error(`CurseForge file ${fileId} was not found.`)
  return response.data.data
}

const CURSEFORGE_DISTRIBUTION_DISABLED_MESSAGE = 'This author disabled third-party downloads. Open the project on CurseForge to download it manually.'

const getCurseForgeDistributionDisabledMessage = (mod?: CurseForgeMod | null) => {
  const title = mod?.name ? `"${mod.name}"` : 'This author'
  return `${title} disabled third-party downloads. Open the project on CurseForge to download it manually.`
}

const assertCurseForgeDistributionAllowed = (mod: CurseForgeMod) => {
  if (mod.allowModDistribution === false) {
    throw new Error(getCurseForgeDistributionDisabledMessage(mod))
  }
}

const isCurseForgeDownloadUnavailableStatus = (status?: number) => status === 403 || status === 404 || status === 451

const isCurseForgeManualDownloadRequiredError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err || '')
  return /disabled third-party downloads|does not allow third-party downloads/i.test(message)
}

const getCurseForgeDownloadUrl = async (file: CurseForgeFile, signal?: AbortSignal) => {
  if (file.downloadUrl) return file.downloadUrl
  try {
    const response = await requestCurseForge<{ data?: string }>(
      `/projects/${file.modId}/files/${file.id}/download-url`,
      { signal }
    )
    if (response.data.data) return response.data.data
  } catch (err) {
    if (!axios.isAxiosError(err) || !isCurseForgeDownloadUnavailableStatus(err.response?.status)) throw err
  }
  throw new Error(CURSEFORGE_DISTRIBUTION_DISABLED_MESSAGE)
}

const assertCurseForgeDownloadUrl = (rawUrl: string) => {
  const parsed = new URL(rawUrl)
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:' || !(hostname === 'forgecdn.net' || hostname.endsWith('.forgecdn.net'))) {
    throw new Error(`Blocked unexpected CurseForge download host: ${hostname}`)
  }
}

const getCurseForgeHashes = (file: CurseForgeFile) => {
  const hashes: Record<string, string> = {}
  file.hashes?.forEach((hash) => {
    if (hash.algo === 1) hashes.sha1 = hash.value
    if (hash.algo === 2) hashes.md5 = hash.value
  })
  return hashes
}

const verifyCurseForgeFile = async (filePath: string, file: CurseForgeFile) => {
  const hashes = getCurseForgeHashes(file)
  if (hashes.sha1) return (await hashFile(filePath, 'sha1')) === hashes.sha1.toLowerCase()
  if (hashes.md5) return (await hashFile(filePath, 'md5')) === hashes.md5.toLowerCase()
  if (file.fileLength && fs.existsSync(filePath)) return fs.statSync(filePath).size === file.fileLength
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
}

const createCurseForgeManualDownload = (
  mod: CurseForgeMod,
  file: CurseForgeFile,
  projectType: Exclude<ModrinthProjectType, 'modpack'>,
  targetDirectory: string
): CurseForgeManualDownload => ({
  id: `${mod.id}:${file.id}`,
  title: mod.name,
  filename: sanitizeDownloadFileName(file.fileName),
  displayName: file.displayName || file.fileName,
  projectId: mod.id,
  fileId: file.id,
  projectType,
  websiteUrl: getCurseForgeProjectWebsiteUrl(mod, projectType),
  fileUrl: getCurseForgeFilePageUrl(mod, file, projectType),
  iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || null,
  targetDirectory,
  hashes: getCurseForgeHashes(file),
  fileLength: file.fileLength
})

const verifyManualCurseForgeDownload = async (filePath: string, item: CurseForgeManualDownload) => {
  const hashes = item.hashes || {}
  if (hashes.sha1) return (await hashFile(filePath, 'sha1')) === hashes.sha1.toLowerCase()
  if (hashes.md5) return (await hashFile(filePath, 'md5')) === hashes.md5.toLowerCase()
  if (item.fileLength && fs.existsSync(filePath)) return fs.statSync(filePath).size === item.fileLength
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
}

const isTemporaryBrowserDownload = (filename: string) => /\.(?:crdownload|download|part|tmp)$/i.test(filename)

const findManualCurseForgeDownload = async (downloadsDirectory: string, item: CurseForgeManualDownload) => {
  const filename = sanitizeDownloadFileName(item.filename)
  const exactPath = path.join(downloadsDirectory, filename)
  assertChildPathIsSafe(downloadsDirectory, exactPath)
  if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile() && await verifyManualCurseForgeDownload(exactPath, item)) {
    return exactPath
  }

  const hasVerificationSignal = Boolean(item.hashes?.sha1 || item.hashes?.md5 || item.fileLength)
  if (!hasVerificationSignal) return ''

  const entries = fs.existsSync(downloadsDirectory)
    ? fs.readdirSync(downloadsDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).slice(0, 300)
    : []
  const expectedExtension = path.extname(filename).toLowerCase()

  for (const entry of entries) {
    if (entry.name === filename || isTemporaryBrowserDownload(entry.name)) continue
    if (expectedExtension && path.extname(entry.name).toLowerCase() !== expectedExtension) continue
    const candidatePath = path.join(downloadsDirectory, entry.name)
    assertChildPathIsSafe(downloadsDirectory, candidatePath)
    const stat = fs.statSync(candidatePath)
    if (item.fileLength && stat.size !== item.fileLength) continue
    if (await verifyManualCurseForgeDownload(candidatePath, item)) return candidatePath
  }

  return ''
}

const moveFileReplacingTarget = (sourcePath: string, targetPath: string) => {
  ensureDir(path.dirname(targetPath))
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true })
  try {
    fs.renameSync(sourcePath, targetPath)
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err
    fs.copyFileSync(sourcePath, targetPath)
    fs.rmSync(sourcePath, { force: true })
  }
}

type InstalledCurseForgeItem = InstalledModrinthItem & {
  title: string
  iconUrl?: string | null
}

const installCurseForgeFile = async (
  mod: CurseForgeMod,
  file: CurseForgeFile,
  instance: ReturnType<typeof normalizeInstance>,
  projectType: Exclude<ModrinthProjectType, 'modpack'>,
  installDirectory: string,
  visited: Set<number>
): Promise<InstalledCurseForgeItem[]> => {
  if (visited.has(mod.id)) return []
  visited.add(mod.id)
  assertCurseForgeDistributionAllowed(mod)

  const installed: InstalledCurseForgeItem[] = []
  const requiredDependencies = projectType === 'mod'
    ? (file.dependencies || []).filter((dependency) => dependency.relationType === 3)
    : []
  for (const dependency of requiredDependencies) {
    const dependencyMod = await getCurseForgeMod(dependency.modId)
    assertCurseForgeDistributionAllowed(dependencyMod)
    const dependencyFile = (await getCurseForgeCompatibleFiles(dependency.modId, instance, 'mod'))[0]
    if (!dependencyFile) throw new Error(`Required dependency ${dependencyMod.name} has no compatible file.`)
    const dependencyItems = await installCurseForgeFile(
      dependencyMod,
      dependencyFile,
      instance,
      'mod',
      installDirectory,
      visited
    )
    installed.push(...dependencyItems.map((item) => ({ ...item, dependency: true })))
  }

  const downloadUrl = await getCurseForgeDownloadUrl(file)
  assertCurseForgeDownloadUrl(downloadUrl)
  ensureDir(installDirectory)
  const filename = sanitizeDownloadFileName(file.fileName)
  const targetPath = path.join(installDirectory, filename)
  let skipped = false

  if (fs.existsSync(targetPath) && await verifyCurseForgeFile(targetPath, file)) {
    skipped = true
  } else {
    await downloadFile(downloadUrl, targetPath, 'content-download', true, undefined, undefined, getDeclaredDownloadLimit(file.fileLength))
    if (!await verifyCurseForgeFile(targetPath, file)) {
      fs.rmSync(targetPath, { force: true })
      throw new Error(`Downloaded CurseForge file failed verification: ${filename}`)
    }
  }

  installed.push({
    filename,
    path: targetPath,
    hashes: getCurseForgeHashes(file),
    dependency: false,
    projectId: getCurseForgeProjectId(mod.id),
    versionId: String(file.id),
    versionNumber: file.displayName || file.fileName,
    versionName: file.displayName || file.fileName,
    skipped,
    title: mod.name,
    iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || null,
    projectType
  })
  return installed
}

const persistCurseForgeContent = (
  instance: ReturnType<typeof normalizeInstance>,
  projectType: Exclude<ModrinthProjectType, 'modpack'>,
  installedItems: InstalledCurseForgeItem[]
) => {
  const { gameDirectory } = getInstancePaths(instance)
  const manifest = readContentManifest(instance)
  const now = new Date().toISOString()
  removeOutdatedContentFiles(manifest, gameDirectory, installedItems)

  Object.entries(groupInstalledItems(installedItems)).forEach(([projectId, rawItems]) => {
    const items = rawItems as InstalledCurseForgeItem[]
    const first = items[0]
    const previous = manifest.projects[projectId]
    manifest.projects[projectId] = {
      projectId,
      provider: 'curseforge',
      title: first.title || previous?.title || projectId,
      projectType: first.projectType || projectType,
      iconUrl: first.iconUrl || previous?.iconUrl || null,
      versionId: first.versionId,
      versionNumber: first.versionNumber,
      versionName: first.versionName,
      gameVersion: instance.version,
      loader: instance.loader,
      files: items.map((item) => ({
        filename: item.filename,
        path: item.path,
        hashes: item.hashes,
        dependency: item.dependency
      })),
      installedAt: previous?.installedAt || now,
      updatedAt: now
    }
  })
  writeContentManifest(instance, manifest)
}

const importCurseForgeManualDownload = async (request: CurseForgeManualDownloadRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const item = request.item
  if (!item) throw new Error('Missing CurseForge manual download item.')

  const projectType = normalizeCurseForgeProjectType(item.projectType)
  if (projectType === 'modpack') throw new Error('Manual modpack files cannot be imported into an instance.')
  const projectId = Number(item.projectId || 0)
  const fileId = Number(item.fileId || 0)
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(fileId) || fileId <= 0) {
    throw new Error('Invalid CurseForge manual download identifiers.')
  }

  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  const downloadsDirectory = app.getPath('downloads')
  ensureDir(downloadsDirectory)
  const filename = sanitizeDownloadFileName(item.filename)
  const installDirectory = getModrinthInstallFolder(projectType, gameDirectory)
  const targetPath = path.join(installDirectory, filename)
  assertChildPathIsSafe(gameDirectory, targetPath)

  if (fs.existsSync(targetPath) && await verifyManualCurseForgeDownload(targetPath, item)) {
    return { success: true, imported: true, alreadyInstalled: true, path: targetPath, filename }
  }

  const sourcePath = await findManualCurseForgeDownload(downloadsDirectory, item)
  if (!sourcePath) {
    return { success: true, imported: false, downloadDirectory: downloadsDirectory, filename }
  }

  moveFileReplacingTarget(sourcePath, targetPath)
  if (!await verifyManualCurseForgeDownload(targetPath, item)) {
    fs.rmSync(targetPath, { force: true })
    throw new Error(`Manual CurseForge download failed verification: ${filename}`)
  }

  const installed: InstalledCurseForgeItem = {
    filename,
    path: targetPath,
    hashes: item.hashes || {},
    dependency: false,
    projectId: getCurseForgeProjectId(projectId),
    projectType,
    versionId: String(fileId),
    versionNumber: item.displayName || filename,
    versionName: item.displayName || filename,
    skipped: false,
    title: item.title || `CurseForge project ${projectId}`,
    iconUrl: item.iconUrl || null
  }
  persistCurseForgeContent(instance, projectType, [installed])

  return { success: true, imported: true, path: targetPath, filename }
}

const installCurseForgeProject = async (request: CurseForgeInstallRequest) => {
  const instance = normalizeInstance({ instance: request.instance })
  const project = request.project || {}
  const modId = getCurseForgeModId(project)
  const projectType = normalizeCurseForgeProjectType(project.project_type)
  if (!modId) throw new Error('Missing CurseForge project id.')
  if (project.provider !== 'curseforge') throw new Error('Invalid CurseForge project request.')
  if (projectType === 'modpack') throw new Error('CurseForge modpacks must be installed as a new instance.')

  assertInstanceContentMutable(instance, projectType)
  const mod = await getCurseForgeMod(modId)
  assertCurseForgeDistributionAllowed(mod)
  const compatibleFiles = await getCurseForgeCompatibleFiles(modId, instance, projectType)
  const requestedFileIdText = String(request.fileId || '').trim()
  if (requestedFileIdText && !/^\d{1,12}$/.test(requestedFileIdText)) {
    throw new Error('Selected CurseForge file id is invalid.')
  }
  const requestedFileId = requestedFileIdText ? Number(requestedFileIdText) : 0
  const file = requestedFileId
    ? compatibleFiles.find((candidate) => candidate.id === requestedFileId)
    : compatibleFiles[0]
  if (requestedFileId && !file) {
    throw new Error('Selected CurseForge file is not compatible with this instance.')
  }
  if (!file) throw new Error(`No compatible CurseForge file found for Minecraft ${instance.version}.`)

  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  const installDirectory = getModrinthInstallFolder(projectType, gameDirectory)
  sendProgress({ type: 'content-install', task: 10, total: 100, detail: mod.name })
  const installed = await installCurseForgeFile(mod, file, instance, projectType, installDirectory, new Set<number>())
  persistCurseForgeContent(instance, projectType, installed)
  sendProgress({ type: 'content-install', task: 100, total: 100, detail: mod.name })

  return {
    success: true,
    projectType,
    version: file.displayName || file.fileName,
    installDirectory,
    installed
  }
}

const getCurseForgeModpackVersions = async (request: CurseForgeInstallRequest) => {
  const project = request.project || {}
  const modId = getCurseForgeModId(project)
  if (!modId) throw new Error('Missing CurseForge modpack project id.')
  const files = await getCurseForgeCompatibleFiles(modId, null, 'modpack')
  return files.map((file) => ({
    id: String(file.id),
    name: file.displayName || file.fileName,
    version_number: file.displayName || file.fileName,
    version_type: file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release',
    game_versions: (file.gameVersions || []).filter((version) => !/^(fabric|forge|neoforge|quilt)$/i.test(version)),
    loaders: (file.gameVersions || []).filter((version) => /^(fabric|forge|neoforge|quilt)$/i.test(version)).map((value) => value.toLowerCase()),
    date_published: file.fileDate || null
  }))
}

const downloadCurseForgeFileToDirectory = async (
  mod: CurseForgeMod,
  file: CurseForgeFile,
  projectType: Exclude<ModrinthProjectType, 'modpack'>,
  installDirectory: string,
  signal?: AbortSignal,
  onProgress?: (percent: number, detail: string) => void
): Promise<InstalledCurseForgeItem> => {
  throwIfInstallCancelled(signal)
  assertCurseForgeDistributionAllowed(mod)
  const downloadUrl = await getCurseForgeDownloadUrl(file, signal)
  assertCurseForgeDownloadUrl(downloadUrl)
  ensureDir(installDirectory)
  const filename = sanitizeDownloadFileName(file.fileName)
  const targetPath = path.join(installDirectory, filename)
  let skipped = false

  if (fs.existsSync(targetPath) && await verifyCurseForgeFile(targetPath, file)) {
    skipped = true
  } else {
    await downloadFile(downloadUrl, targetPath, 'content-download', true, signal, (percent) => {
      onProgress?.(percent, filename)
    }, getDeclaredDownloadLimit(file.fileLength))
    if (!await verifyCurseForgeFile(targetPath, file)) {
      fs.rmSync(targetPath, { force: true })
      throw new Error(`Downloaded CurseForge file failed verification: ${filename}`)
    }
  }

  return {
    filename,
    path: targetPath,
    hashes: getCurseForgeHashes(file),
    dependency: false,
    projectId: getCurseForgeProjectId(mod.id),
    projectType,
    versionId: String(file.id),
    versionNumber: file.displayName || file.fileName,
    versionName: file.displayName || file.fileName,
    skipped,
    title: mod.name,
    iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || null
  }
}

const readCurseForgePackManifest = (zip: AdmZip) => {
  const entry = zip.getEntry('manifest.json')
  if (!entry || entry.isDirectory) {
    throw new Error('This CurseForge modpack is missing a valid manifest.json.')
  }
  const manifest = JSON.parse(getZipEntryDataWithLimit(entry, MAX_MODPACK_INDEX_BYTES, 'CurseForge modpack manifest').toString('utf8')) as CurseForgePackManifest
  if (manifest.manifestType !== 'minecraftModpack' || !manifest.minecraft?.version) {
    throw new Error('Unsupported CurseForge modpack manifest.')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > 5000) {
    throw new Error('The CurseForge modpack file list is invalid or too large.')
  }
  return manifest
}

const getCurseForgePackInstance = (
  project: CurseForgeProject,
  modId: number,
  file: CurseForgeFile,
  manifest: CurseForgePackManifest
) => {
  const loaders = manifest.minecraft?.modLoaders || []
  const selected = loaders.find((loader) => loader.primary) || loaders[0]
  const loaderId = String(selected?.id || '')
  let loader: LoaderType = 'vanilla'
  let loaderVersion = ''

  if (/^forge-/i.test(loaderId)) {
    loader = 'forge'
    loaderVersion = loaderId.replace(/^forge-/i, '')
  } else if (/^(?:fabric|fabricloader)-/i.test(loaderId)) {
    loader = 'fabric'
    loaderVersion = loaderId.replace(/^(?:fabric|fabricloader)-/i, '')
  } else if (/^(?:quilt|quiltloader)-/i.test(loaderId)) {
    loader = 'quilt'
    loaderVersion = loaderId.replace(/^(?:quilt|quiltloader)-/i, '')
  } else if (/^neoforge-/i.test(loaderId)) {
    loader = 'neoforge'
    loaderVersion = loaderId.replace(/^neoforge-/i, '')
  } else if (loaderId) {
    throw new Error(`This CurseForge modpack uses an unsupported loader: ${loaderId}`)
  }

  return normalizeInstance({ instance: {
    id: `curseforge-modpack-${modId}-${file.id}-${Date.now()}`,
    name: String(project.title || project.name || manifest.name || file.displayName || 'CurseForge Modpack'),
    version: manifest.minecraft?.version,
    loader,
    loaderVersion,
    iconUrl: project.icon_url || null,
    createdAt: new Date().toISOString(),
    playtimeSeconds: 0
  } })
}

const extractCurseForgeOverrides = async (
  zip: AdmZip,
  gameDirectory: string,
  rawPrefix?: string,
  signal?: AbortSignal
) => {
  const prefix = `${String(rawPrefix || 'overrides').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/`
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix))
  preflightModpackOverrideEntries(entries, 'CurseForge modpack')

  let count = 0
  for (const entry of entries) {
    throwIfInstallCancelled(signal)
    const relativePath = entry.entryName.slice(prefix.length)
    if (!relativePath) continue
    const targetPath = resolveModpackRelativePath(gameDirectory, relativePath)
    writeZipEntryToFile(entry, targetPath, 'CurseForge modpack override file')
    count += 1
    if (count % 12 === 0) await yieldToEventLoop()
  }
  return count
}

const installCurseForgeModpack = async (request: CurseForgeInstallRequest, signal?: AbortSignal) => {
  throwIfInstallCancelled(signal)
  const project = request.project || {}
  const modId = getCurseForgeModId(project)
  if (!modId) throw new Error('Missing CurseForge modpack project id.')
  const mod = await getCurseForgeMod(modId, signal)
  assertCurseForgeDistributionAllowed(mod)

  const requestedFileId = Number(request.fileId || 0)
  const file = requestedFileId > 0
    ? await getCurseForgeFileById(modId, requestedFileId, signal)
    : (await getCurseForgeCompatibleFiles(modId, null, 'modpack', signal))[0]
  if (!file || !file.fileName.toLowerCase().endsWith('.zip')) throw new Error('No installable CurseForge modpack file was found.')
  if (file.fileLength && file.fileLength > 2 * 1024 * 1024 * 1024) throw new Error('This CurseForge modpack archive is too large.')

  const downloadUrl = await getCurseForgeDownloadUrl(file, signal)
  assertCurseForgeDownloadUrl(downloadUrl)
  const cacheDirectory = path.join(userDataPath, 'cache', 'modpacks')
  ensureDir(cacheDirectory)
  const archivePath = path.join(cacheDirectory, `curseforge-${modId}-${file.id}-${sanitizeDownloadFileName(file.fileName)}`)
  if (!fs.existsSync(archivePath) || !await verifyCurseForgeFile(archivePath, file)) {
    await downloadFile(downloadUrl, archivePath, 'content-download', true, signal, (percent) => {
      sendProgress({
        type: 'content-install',
        task: 3 + Math.round((Math.min(Math.max(percent, 0), 100) / 100) * 7),
        total: 100,
        detail: file.fileName
      })
    }, getDeclaredDownloadLimit(file.fileLength))
    if (!await verifyCurseForgeFile(archivePath, file)) {
      fs.rmSync(archivePath, { force: true })
      throw new Error('Downloaded CurseForge modpack failed verification.')
    }
  }

  const zip = new AdmZip(archivePath)
  const manifest = readCurseForgePackManifest(zip)
  const instance = getCurseForgePackInstance(project, modId, file, manifest)
  const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
  assertInstancePathIsSafe(instanceRoot)
  ensureDir(gameDirectory)

  const installedItems: InstalledCurseForgeItem[] = []
  const blockedFiles: string[] = []
  const manualDownloads: CurseForgeManualDownload[] = []
  let installedFiles = 0
  let skippedFiles = 0
  const packFiles = manifest.files || []
  sendProgress({ type: 'content-install', task: 10, total: 100, detail: manifest.name || mod.name })
  for (let index = 0; index < packFiles.length; index += 1) {
    throwIfInstallCancelled(signal)
    const item = packFiles[index]
    const projectId = Number(item.projectID || 0)
    const fileId = Number(item.fileID || 0)
    if (!projectId || !fileId || item.required === false) continue

    const childMod = await getCurseForgeMod(projectId, signal)
    const childType = getCurseForgeProjectTypeFromClassId(childMod.classId)
    if (childType === 'modpack') continue
    const childFile = await getCurseForgeFileById(projectId, fileId, signal)
    const installDirectory = getModrinthInstallFolder(childType, gameDirectory)
    const childName = childMod.name || `CurseForge project ${projectId}`
    const reason = `${childName} (${projectId}/${fileId})`
    const fileStart = 10 + ((index / Math.max(1, packFiles.length)) * 75)
    const fileEnd = 10 + (((index + 1) / Math.max(1, packFiles.length)) * 75)

    if (childMod.allowModDistribution === false) {
      const manualDownload = createCurseForgeManualDownload(childMod, childFile, childType, installDirectory)
      blockedFiles.push(reason)
      manualDownloads.push(manualDownload)
      skippedFiles += 1
      log.warn(`Queued CurseForge ${childType} dependency for browser download because third-party distribution is disabled: ${reason}.`)
      sendProgress({
        type: 'content-install',
        task: 10 + Math.round(((index + 1) / Math.max(1, packFiles.length)) * 75),
        total: 100,
        detail: childFile.fileName
      })
      await yieldToEventLoop()
      continue
    }

    let installed: InstalledCurseForgeItem
    try {
      sendProgress({
        type: 'content-install',
        task: Math.round(fileStart),
        total: 100,
        detail: childFile.fileName
      })
      installed = await downloadCurseForgeFileToDirectory(childMod, childFile, childType, installDirectory, signal, (percent, detail) => {
        sendProgress({
          type: 'content-install',
          task: Math.round(fileStart + ((fileEnd - fileStart) * (Math.min(Math.max(percent, 0), 100) / 100))),
          total: 100,
          detail
        })
      })
    } catch (err) {
      if (!isCurseForgeManualDownloadRequiredError(err)) throw err
      const manualDownload = createCurseForgeManualDownload(childMod, childFile, childType, installDirectory)
      blockedFiles.push(reason)
      manualDownloads.push(manualDownload)
      skippedFiles += 1
      log.warn(`Queued CurseForge ${childType} dependency for browser download after launcher download was denied: ${reason}.`)
      sendProgress({
        type: 'content-install',
        task: 10 + Math.round(((index + 1) / Math.max(1, packFiles.length)) * 75),
        total: 100,
        detail: childFile.fileName
      })
      await yieldToEventLoop()
      continue
    }
    installedItems.push(installed)
    if (installed.skipped) skippedFiles += 1
    else installedFiles += 1
    sendProgress({
      type: 'content-install',
      task: 10 + Math.round(((index + 1) / Math.max(1, packFiles.length)) * 75),
      total: 100,
      detail: childFile.fileName
    })
    await yieldToEventLoop()
  }

  const overrideFiles = await extractCurseForgeOverrides(zip, gameDirectory, manifest.overrides, signal)
  await provisionInstanceDefaults(instance)
  if (installedItems.length > 0) persistCurseForgeContent(instance, 'mod', installedItems)
  writeJsonFile(path.join(instanceRoot, 'namlauncher-modpack.json'), {
    projectId: getCurseForgeProjectId(modId),
    projectTitle: project.title || mod.name,
    versionId: String(file.id),
    versionNumber: file.displayName || file.fileName,
    modpackName: manifest.name || mod.name,
    iconUrl: instance.iconUrl || null,
    source: 'curseforge',
    blockedFiles,
    manualDownloads,
    installedAt: new Date().toISOString()
  })
  sendProgress({ type: 'content-install', task: 100, total: 100, detail: manifest.name || mod.name })
  return {
    success: true,
    instance,
    version: file.displayName || file.fileName,
    installedFiles,
    skippedFiles,
    overrideFiles,
    blockedFiles,
    manualDownloads,
    manualDownloadDirectory: app.getPath('downloads')
  }
}

const getCurseForgeContentStatus = async (request: CurseForgeContentStatusRequest) => {
  const projects = Array.isArray(request.projects) ? request.projects.slice(0, 50) : []
  if (!request.instance) {
    return Object.fromEntries(projects.map((project) => {
      const projectType = normalizeCurseForgeProjectType(project.project_type)
      return [String(project.project_id || project.id), projectType === 'modpack'
        ? { state: 'install' }
        : {
            state: 'unsupported',
            reason: projectType === 'mod'
              ? 'Select a Fabric or Forge instance first.'
              : 'Select an instance first.'
          }]
    }))
  }

  const instance = normalizeInstance({ instance: request.instance })
  const manifest = readContentManifest(instance)
  const statuses: Record<string, any> = {}
  await Promise.all(projects.map(async (project) => {
    const modId = getCurseForgeModId(project)
    const projectId = getCurseForgeProjectId(modId)
    const projectType = normalizeCurseForgeProjectType(project.project_type)
    if (projectType === 'modpack') {
      statuses[projectId] = { state: 'install' }
      return
    }
    if (!modId || project.allow_distribution === false) {
      statuses[projectId] = {
        state: 'unsupported',
        reason: 'The author disabled third-party distribution.'
      }
      return
    }

    const record = manifest.projects[projectId]
    try {
      const latest = (await getCurseForgeCompatibleFiles(modId, instance, projectType))[0]
      if (!latest) {
        statuses[projectId] = {
          state: record && recordFilesExist(record) ? 'installed' : 'unavailable',
          reason: `No compatible file for Minecraft ${instance.version}.`,
          installedVersion: record?.versionNumber || null,
          installedVersionId: record?.versionId || null
        }
        return
      }

      statuses[projectId] = record && recordFilesExist(record)
        ? String(latest.id) === record.versionId
          ? {
              state: 'installed',
              installedVersion: record.versionNumber,
              installedVersionId: record.versionId,
              latestVersion: latest.displayName || latest.fileName,
              latestVersionId: String(latest.id)
            }
          : {
              state: 'update',
              installedVersion: record.versionNumber,
              installedVersionId: record.versionId,
              latestVersion: latest.displayName || latest.fileName,
              latestVersionId: String(latest.id)
            }
        : {
            state: 'install',
            latestVersion: latest.displayName || latest.fileName,
            latestVersionId: String(latest.id)
          }
    } catch (err: any) {
      statuses[projectId] = {
        state: record && recordFilesExist(record) ? 'installed' : 'unavailable',
        reason: err?.message || 'Could not resolve a compatible CurseForge file.'
      }
    }
  }))
  return statuses
}

const resolveFabricLoaderVersion = async (mcVersion: string, requestedLoaderVersion?: string) => {
  if (requestedLoaderVersion) return requestedLoaderVersion

  const versions = await listFabricLoaderVersions(mcVersion)
  const stable = versions.find((item) => item.type === 'stable')
  const selected = stable || versions[0]
  const version = selected?.id

  if (!version) throw new Error(`No Fabric loader version found for Minecraft ${mcVersion}.`)
  return version
}

const normalizeLoaderPathIdentifier = (value: unknown, label: string) => {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}$/.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`)
  }
  return normalized
}

const listFabricLoaderVersions = async (mcVersion: string) => {
  const response = await axios.get<any[]>(`${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(mcVersion)}`, {
    headers: HTTP_HEADERS
  })

  return response.data
    .map((item) => ({
      id: item.loader?.version || item.version,
      type: item.loader?.stable || item.stable ? 'stable' : 'unstable'
    }))
    .filter((item) => item.id)
}

const ensureFabricProfile = async (instanceRoot: string, mcVersion: string, requestedLoaderVersion?: string) => {
  const safeMinecraftVersion = normalizeLoaderPathIdentifier(mcVersion, 'Minecraft version')
  const loaderVersion = normalizeLoaderPathIdentifier(
    await resolveFabricLoaderVersion(safeMinecraftVersion, requestedLoaderVersion),
    'Fabric loader version'
  )
  const profileUrl = `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(safeMinecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const response = await axios.get<any>(profileUrl, { headers: HTTP_HEADERS })
  const customVersionId = normalizeLoaderPathIdentifier(
    response.data.id || `fabric-loader-${loaderVersion}-${safeMinecraftVersion}`,
    'Fabric profile ID'
  )
  const versionDir = path.join(instanceRoot, 'versions', customVersionId)
  assertPathWithinRoot(instanceRoot, versionDir)
  ensureDir(versionDir)
  const profilePath = path.join(versionDir, `${customVersionId}.json`)
  assertPathWithinRoot(versionDir, profilePath)
  fs.writeFileSync(profilePath, JSON.stringify(response.data, null, 2), 'utf8')

  log.info(`Fabric profile ready: ${customVersionId}`)
  return { customVersionId, loaderVersion }
}

const listQuiltLoaderVersions = async (mcVersion: string) => {
  const normalizedVersion = mcVersion.trim()
  const genericEndpoint = `${QUILT_META_BASE}/versions/loader`
  const preferredEndpoint = normalizedVersion
    ? `${genericEndpoint}/${encodeURIComponent(normalizedVersion)}`
    : genericEndpoint

  try {
    const response = await axios.get<any[]>(preferredEndpoint, {
      headers: HTTP_HEADERS,
      timeout: 30000
    })
    const versions = sortLoaderVersions(response.data.map((item) => String(item.loader?.version || item.version || '')))
    if (versions.length > 0) return versions
    log.warn(`Quilt metadata returned no loader versions for ${preferredEndpoint}; trying fallback indexes.`)
  } catch (preferredError) {
    log.warn(`Quilt metadata request failed for ${preferredEndpoint}; trying the generic loader index.`, getCompactErrorLog(preferredError))
  }

  if (preferredEndpoint !== genericEndpoint) {
    try {
      const response = await axios.get<any[]>(genericEndpoint, {
        headers: HTTP_HEADERS,
        timeout: 30000
      })
      const versions = sortLoaderVersions(response.data.map((item) => String(item.loader?.version || item.version || '')))
      if (versions.length > 0) return versions
    } catch (genericError) {
      log.warn(`Quilt generic metadata request failed for ${genericEndpoint}; trying Maven metadata.`, getCompactErrorLog(genericError))
    }
  }

  const mavenResponse = await axios.get<string>(QUILT_MAVEN_METADATA_URL, {
    headers: HTTP_HEADERS,
    timeout: 30000,
    responseType: 'text'
  })
  const mavenVersions = Array.from(
    mavenResponse.data.matchAll(/<version>([^<]+)<\/version>/g),
    (match) => match[1].trim()
  )
  const versions = sortLoaderVersions(mavenVersions)
  if (versions.length === 0) throw new Error('Quilt metadata did not contain any loader versions.')
  return versions
}

const getQuiltGameCompatibility = async (mcVersion: string) => {
  const requestedVersion = mcVersion.trim()
  try {
    const response = await axios.get<Array<{ version?: string; stable?: boolean }>>(
      `${QUILT_META_BASE}/versions/game`,
      { headers: HTTP_HEADERS, timeout: 30000 }
    )
    const gameVersions = Array.isArray(response.data) ? response.data : []
    const supported = gameVersions.some((item) => item.version === requestedVersion)
    const recommendedGameVersion = String(
      gameVersions.find((item) => item.stable && item.version)?.version || ''
    )
    return {
      supported,
      requestedGameVersion: requestedVersion,
      recommendedGameVersion: recommendedGameVersion || null
    }
  } catch (error) {
    log.warn('Could not verify Quilt Minecraft compatibility; allowing the metadata request to decide.', getCompactErrorLog(error))
    return {
      supported: true,
      requestedGameVersion: requestedVersion,
      recommendedGameVersion: null
    }
  }
}

const resolveQuiltLoaderVersion = async (mcVersion: string, requestedLoaderVersion?: string) => {
  if (requestedLoaderVersion) return requestedLoaderVersion
  const version = (await listQuiltLoaderVersions(mcVersion))[0]?.id
  if (!version) throw new Error(`No Quilt loader version found for Minecraft ${mcVersion}.`)
  return version
}

const ensureQuiltProfile = async (instanceRoot: string, mcVersion: string, requestedLoaderVersion?: string) => {
  const safeMinecraftVersion = normalizeLoaderPathIdentifier(mcVersion, 'Minecraft version')
  const compatibility = await getQuiltGameCompatibility(safeMinecraftVersion)
  if (!compatibility.supported) {
    const recommendation = compatibility.recommendedGameVersion
      ? ` Use Minecraft ${compatibility.recommendedGameVersion} or another supported version.`
      : ''
    throw new Error(`Quilt does not support Minecraft ${safeMinecraftVersion}.${recommendation}`)
  }
  const loaderVersion = normalizeLoaderPathIdentifier(
    await resolveQuiltLoaderVersion(safeMinecraftVersion, requestedLoaderVersion),
    'Quilt loader version'
  )
  const profileUrl = `${QUILT_META_BASE}/versions/loader/${encodeURIComponent(safeMinecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const response = await axios.get<any>(profileUrl, { headers: HTTP_HEADERS })
  const customVersionId = normalizeLoaderPathIdentifier(
    response.data.id || `quilt-loader-${loaderVersion}-${safeMinecraftVersion}`,
    'Quilt profile ID'
  )
  const versionDir = path.join(instanceRoot, 'versions', customVersionId)
  assertPathWithinRoot(instanceRoot, versionDir)
  ensureDir(versionDir)
  const profilePath = path.join(versionDir, `${customVersionId}.json`)
  assertPathWithinRoot(versionDir, profilePath)
  fs.writeFileSync(profilePath, JSON.stringify(response.data, null, 2), 'utf8')
  log.info(`Quilt profile ready: ${customVersionId}`)
  return { customVersionId, loaderVersion }
}

const resolveForgeVersion = async (mcVersion: string, requestedForgeVersion?: string) => {
  if (requestedForgeVersion) {
    return requestedForgeVersion.startsWith(`${mcVersion}-`)
      ? requestedForgeVersion.slice(mcVersion.length + 1)
      : requestedForgeVersion
  }

  const versions = await listForgeVersions(mcVersion)
  const recommended = versions.find((item) => item.type === 'recommended')
  const latest = versions.find((item) => item.type === 'latest')
  const version = recommended?.id || latest?.id

  if (!version) throw new Error(`No Forge build found for Minecraft ${mcVersion}.`)
  return version
}

const listForgeVersions = async (mcVersion: string) => {
  const response = await axios.get<{ promos: Record<string, string> }>(FORGE_PROMOTIONS_URL, {
    headers: HTTP_HEADERS
  })
  const promos = response.data.promos || {}
  const versions = [
    promos[`${mcVersion}-recommended`] ? { id: promos[`${mcVersion}-recommended`], type: 'recommended' } : null,
    promos[`${mcVersion}-latest`] ? { id: promos[`${mcVersion}-latest`], type: 'latest' } : null
  ].filter(Boolean) as Array<{ id: string; type: string }>

  return versions.filter((item, index) => versions.findIndex((candidate) => candidate.id === item.id) === index)
}

const verifyMavenExecutableArtifact = async (artifactUrl: string, artifactPath: string, label: string) => {
  const checksumResponse = await axios.get<string>(`${artifactUrl}.sha1`, {
    headers: HTTP_HEADERS,
    timeout: 30000,
    responseType: 'text',
    maxContentLength: 1024
  })
  const expectedSha1 = String(checksumResponse.data || '').trim().split(/\s+/, 1)[0].toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(expectedSha1)) {
    fs.rmSync(artifactPath, { force: true })
    throw new Error(`${label} did not provide a valid Maven SHA-1 checksum.`)
  }
  const actualSha1 = crypto.createHash('sha1').update(fs.readFileSync(artifactPath)).digest('hex')
  if (!crypto.timingSafeEqual(Buffer.from(actualSha1, 'hex'), Buffer.from(expectedSha1, 'hex'))) {
    fs.rmSync(artifactPath, { force: true })
    throw new Error(`${label} failed Maven checksum verification.`)
  }
}

const ensureForgeInstaller = async (instanceRoot: string, mcVersion: string, requestedForgeVersion?: string) => {
  const safeMinecraftVersion = normalizeLoaderPathIdentifier(mcVersion, 'Minecraft version')
  const forgeVersion = normalizeLoaderPathIdentifier(
    await resolveForgeVersion(safeMinecraftVersion, requestedForgeVersion),
    'Forge loader version'
  )
  const loaderDir = path.join(instanceRoot, 'loaders', 'forge')
  assertPathWithinRoot(instanceRoot, loaderDir)
  let lastError: unknown = null

  for (const coordinate of getForgeArtifactCoordinates(safeMinecraftVersion, forgeVersion)) {
    for (const classifier of ['installer', 'universal'] as const) {
      const artifactName = `forge-${coordinate}-${classifier}.jar`
      const artifactPath = path.join(loaderDir, artifactName)
      assertPathWithinRoot(loaderDir, artifactPath)
      const artifactUrl = `${FORGE_MAVEN_BASE}/net/minecraftforge/forge/${coordinate}/${artifactName}`
      try {
        await downloadFile(artifactUrl, artifactPath, 'loader-download')
        await verifyMavenExecutableArtifact(
          artifactUrl,
          artifactPath,
          `Forge ${coordinate} ${classifier === 'installer' ? 'installer' : 'universal JAR'}`
        )
        log.info(`Forge ${classifier} ready: ${artifactPath}`)
        return { forgePath: artifactPath, loaderVersion: forgeVersion }
      } catch (error) {
        lastError = error
        fs.rmSync(artifactPath, { force: true })
        log.warn(
          `Forge ${classifier} artifact is unavailable; trying the next official Maven coordinate.`,
          getCompactErrorLog(error)
        )
      }
    }
  }

  throw lastError || new Error(`No verified Forge artifact was found for ${safeMinecraftVersion}-${forgeVersion}.`)
}

const getCurseForgeProjectVersions = async (request: CurseForgeInstallRequest) => {
  const project = request.project || {}
  const modId = getCurseForgeModId(project)
  const projectType = normalizeCurseForgeProjectType(project.project_type)
  if (!modId) throw new Error('Missing CurseForge project id.')
  if (projectType === 'modpack') return getCurseForgeModpackVersions(request)
  const instance = normalizeInstance({ instance: request.instance })
  const files = await getCurseForgeCompatibleFiles(modId, instance, projectType)
  return files.map((file) => ({
    id: String(file.id),
    name: file.displayName || file.fileName,
    version_number: file.displayName || file.fileName,
    version_type: file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release',
    game_versions: (file.gameVersions || []).filter((version) => !/^(fabric|forge|neoforge|quilt)$/i.test(version)),
    loaders: (file.gameVersions || []).filter((version) => /^(fabric|forge|neoforge|quilt)$/i.test(version)).map((value) => value.toLowerCase()),
    date_published: file.fileDate || null
  }))
}

const listNeoForgeVersions = async (mcVersion: string) => {
  const response = await axios.get<string>(NEOFORGE_METADATA_URL, {
    headers: HTTP_HEADERS,
    responseType: 'text'
  })
  return parseNeoForgeMetadata(response.data, mcVersion)
}

const resolveNeoForgeVersion = async (mcVersion: string, requestedLoaderVersion?: string) => {
  if (requestedLoaderVersion) return requestedLoaderVersion.replace(/^neoforge-/i, '')
  const version = (await listNeoForgeVersions(mcVersion))[0]?.id
  if (!version) throw new Error(`No NeoForge build found for Minecraft ${mcVersion}. NeoForge requires a supported modern Minecraft version.`)
  return version
}

type MojangVersionMetadata = {
  id?: string
  downloads?: {
    client?: {
      url?: string
      sha1?: string
      size?: number
    }
  }
  [key: string]: unknown
}

const assertMojangMetadataUrl = (rawUrl: string, allowedHosts: Set<string>) => {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('Mojang returned an unexpected Minecraft download URL.')
  }
  return parsed.href
}

const getMojangVersionMetadata = async (mcVersion: string, signal?: AbortSignal): Promise<MojangVersionMetadata> => {
  const manifestResponse = await axios.get<any>(MOJANG_VERSION_MANIFEST_URL, {
    timeout: 30000,
    signal,
    headers: HTTP_HEADERS,
    maxContentLength: 16 * 1024 * 1024
  })
  const versionEntry = Array.isArray(manifestResponse.data?.versions)
    ? manifestResponse.data.versions.find((entry: any) => entry?.id === mcVersion)
    : null
  if (!versionEntry?.url) throw new Error(`Minecraft ${mcVersion} is missing from the Mojang version manifest.`)

  const metadataUrl = assertMojangMetadataUrl(String(versionEntry.url), new Set([
    'piston-meta.mojang.com',
    'launchermeta.mojang.com'
  ]))
  const versionResponse = await axios.get<MojangVersionMetadata>(metadataUrl, {
    timeout: 30000,
    signal,
    headers: HTTP_HEADERS,
    maxContentLength: 16 * 1024 * 1024
  })
  const metadata = versionResponse.data || {}
  const client = metadata.downloads?.client
  if (metadata.id !== mcVersion || !client?.url || !/^[a-f0-9]{40}$/i.test(String(client.sha1 || ''))) {
    throw new Error(`Mojang returned incomplete client metadata for Minecraft ${mcVersion}.`)
  }
  assertMojangMetadataUrl(String(client.url), new Set([
    'piston-data.mojang.com',
    'launcher.mojang.com'
  ]))
  return metadata
}

// Author/creator: nattapat2871 (https://nattapat2871.me)
const ensureVerifiedMinecraftClient = async (instanceRoot: string, mcVersion: string, signal?: AbortSignal) => {
  throwIfInstallCancelled(signal)
  const metadata = await getMojangVersionMetadata(mcVersion, signal)
  const client = metadata.downloads!.client!
  const clientUrl = assertMojangMetadataUrl(String(client.url), new Set([
    'piston-data.mojang.com',
    'launcher.mojang.com'
  ]))
  const expectedSha1 = String(client.sha1).toLowerCase()
  const expectedSize = Number(client.size) || 0
  const versionDirectory = path.join(instanceRoot, 'versions', mcVersion)
  const clientPath = path.join(versionDirectory, `${mcVersion}.jar`)
  const versionJsonPath = path.join(versionDirectory, `${mcVersion}.json`)
  ensureDir(versionDirectory)

  const isValidClient = async () => {
    if (!fs.existsSync(clientPath)) return false
    if (expectedSize > 0 && fs.statSync(clientPath).size !== expectedSize) return false
    return (await hashFile(clientPath, 'sha1')).toLowerCase() === expectedSha1
  }

  if (!await isValidClient()) {
    fs.rmSync(clientPath, { force: true })
    let verified = false
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      throwIfInstallCancelled(signal)
      sendProgress({ type: 'loader-install', task: 12 + attempt, total: 100, detail: 'minecraft-client' })
      await downloadFile(
        clientUrl,
        clientPath,
        'loader-download',
        true,
        signal,
        undefined,
        expectedSize > 0 ? expectedSize : 512 * 1024 * 1024
      )
      if (await isValidClient()) {
        verified = true
        break
      }
      fs.rmSync(clientPath, { force: true })
      log.warn(`Minecraft ${mcVersion} client checksum mismatch; retrying verified download (${attempt}/3).`)
    }
    if (!verified) {
      throw new Error(`Minecraft ${mcVersion} client failed checksum verification after 3 downloads.`)
    }
  }

  writeJsonFile(versionJsonPath, metadata)
  log.info(`Verified Minecraft ${mcVersion} client before loader installation.`)
}

const runLoaderInstaller = (
  javaPath: string,
  installerPath: string,
  instanceRoot: string,
  signal?: AbortSignal,
  loaderName: 'NeoForge' | 'Forge' = 'NeoForge'
) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error(LAUNCH_CANCELLED_MESSAGE))
    return
  }

  const launcherProfilesPath = path.join(instanceRoot, 'launcher_profiles.json')
  if (!fs.existsSync(launcherProfilesPath)) {
    fs.writeFileSync(launcherProfilesPath, JSON.stringify({ profiles: {} }, null, 2), 'utf8')
  }

  let output = ''
  let progress = 25
  let settled = false
  const installer = spawn(javaPath, [
    // This short-lived installer must not inherit the game's multi-GB heap policy.
    // Bound Java ergonomics on high-RAM machines; leave room for native allocations.
    '-Xms128m',
    '-Xmx2048m',
    '-Djava.awt.headless=true',
    '-jar',
    installerPath,
    loaderName === 'Forge' ? '--installClient' : '--install-client',
    instanceRoot
  ], {
    cwd: path.dirname(installerPath),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const finish = (error?: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    if (error) reject(error)
    else resolve()
  }
  const appendOutput = (chunk: unknown) => {
    const text = redactSensitiveText(String(chunk || ''))
    output = `${output}${text}`.slice(-24000)
    progress = Math.min(90, progress + 2)
    sendProgress({ type: 'loader-install', task: progress, total: 100, detail: loaderName.toLowerCase() })
  }
  const cancel = () => {
    installer.kill()
    finish(new Error(LAUNCH_CANCELLED_MESSAGE))
  }
  const timeout = setTimeout(() => {
    installer.kill()
    finish(new Error(`${loaderName} installer timed out after 10 minutes.`))
  }, 10 * 60 * 1000)

  signal?.addEventListener('abort', cancel, { once: true })
  installer.stdout?.on('data', appendOutput)
  installer.stderr?.on('data', appendOutput)
  installer.once('error', (error) => finish(error))
  installer.once('close', (code) => {
    if (code === 0) {
      finish()
      return
    }
    const detail = output.trim().split(/\r?\n/).slice(-8).join('\n')
    // Keep a known memory cause even when later installer output pushes it out of the tail.
    const memoryHint = getMinecraftCrashDiagnosis(output)?.code === 'jvm-native-memory'
      ? ' Java native memory allocation failed (RAM / paging file).'
      : ''
    finish(new Error(`${loaderName} installer exited with code ${code}${memoryHint}${detail ? `:\n${detail}` : ''}`))
  })
})

const runNeoForgeInstaller = (javaPath: string, installerPath: string, instanceRoot: string, signal?: AbortSignal) => (
  runLoaderInstaller(javaPath, installerPath, instanceRoot, signal, 'NeoForge')
)

const ensureDirectForgeProfile = async (
  instanceRoot: string, minecraftVersion: string, javaPath: string,
  forge: { forgePath: string; loaderVersion: string }, signal?: AbortSignal
) => {
  const zip = new AdmZip(forge.forgePath)
  const entry = zip.getEntry('version.json')
  if (!entry || entry.isDirectory) return null // Legacy universal JARs use the existing path.
  const profile = JSON.parse(getZipEntryDataWithLimit(entry, MAX_ZIP_METADATA_ENTRY_BYTES, 'Forge version profile').toString('utf8'))
  if (!shouldInstallForgeProfileDirectly(profile, minecraftVersion)) return null
  const customVersionId = normalizeLoaderPathIdentifier(profile.id, 'Forge profile ID')
  const installedProfilePath = path.join(instanceRoot, 'versions', customVersionId, `${customVersionId}.json`)
  const markerPath = path.join(instanceRoot, 'loaders', 'forge', `${forge.loaderVersion}.direct-installed.json`)
  assertPathWithinRoot(instanceRoot, installedProfilePath)
  assertPathWithinRoot(instanceRoot, markerPath)
  const installerSha256 = await hashFile(forge.forgePath, 'sha256')
  const marker = readJsonFile<{ installerSha256?: string; profileSha256?: string }>(markerPath, {})
  if (!fs.existsSync(installedProfilePath) || marker.installerSha256 !== installerSha256
    || !marker.profileSha256 || await hashFile(installedProfilePath, 'sha256') !== marker.profileSha256) {
    await ensureVerifiedMinecraftClient(instanceRoot, minecraftVersion, signal)
    await runLoaderInstaller(javaPath, forge.forgePath, instanceRoot, signal, 'Forge')
    if (!fs.existsSync(installedProfilePath)) throw new Error(`Forge installer completed without creating ${customVersionId}.`)
    const installed = readJsonFile<unknown>(installedProfilePath, null)
    if (!shouldInstallForgeProfileDirectly(installed, minecraftVersion)) throw new Error('Forge created an unexpected launch profile.')
    writeJsonFile(markerPath, { installerSha256, profileSha256: await hashFile(installedProfilePath, 'sha256'),
      customVersionId, installedAt: new Date().toISOString() })
  }
  log.info(`Verified direct Forge profile ready: ${customVersionId}`)
  return {
    customVersionId, resolvedLoaderVersion: forge.loaderVersion, forgePath: undefined,
    javaArgs: resolveNeoForgeJvmArguments(instanceRoot, customVersionId, profile.arguments?.jvm || [])
  }
}

const ensureNeoForgeProfile = async (
  instanceRoot: string,
  mcVersion: string,
  javaPath: string,
  requestedLoaderVersion?: string,
  signal?: AbortSignal
) => {
  const safeMinecraftVersion = normalizeLoaderPathIdentifier(mcVersion, 'Minecraft version')
  const loaderVersion = normalizeLoaderPathIdentifier(
    await resolveNeoForgeVersion(safeMinecraftVersion, requestedLoaderVersion),
    'NeoForge loader version'
  )
  const loaderDir = path.join(instanceRoot, 'loaders', 'neoforge')
  assertPathWithinRoot(instanceRoot, loaderDir)
  const installerName = `neoforge-${loaderVersion}-installer.jar`
  const installerPath = path.join(loaderDir, installerName)
  assertPathWithinRoot(loaderDir, installerPath)
  const installerUrl = `${NEOFORGE_MAVEN_BASE}/net/neoforged/neoforge/${encodeURIComponent(loaderVersion)}/${installerName}`
  await downloadFile(installerUrl, installerPath, 'loader-download')
  await verifyMavenExecutableArtifact(installerUrl, installerPath, `NeoForge ${loaderVersion} installer`)

  const zip = new AdmZip(installerPath)
  const versionEntry = zip.getEntry('version.json')
  if (!versionEntry || versionEntry.isDirectory) throw new Error('The NeoForge installer is missing version.json.')
  const profile = JSON.parse(getZipEntryDataWithLimit(versionEntry, MAX_ZIP_METADATA_ENTRY_BYTES, 'NeoForge version profile').toString('utf8')) as {
    id?: string
    inheritsFrom?: string
    mainClass?: string
    libraries?: unknown[]
    arguments?: {
      jvm?: VersionProfileArgument[]
    }
  }
  if (!profile.id || profile.inheritsFrom !== safeMinecraftVersion || !profile.mainClass || !Array.isArray(profile.libraries)) {
    throw new Error(`The NeoForge ${loaderVersion} profile is not compatible with Minecraft ${safeMinecraftVersion}.`)
  }

  const customVersionId = normalizeLoaderPathIdentifier(profile.id, 'NeoForge profile ID')
  const versionDir = path.join(instanceRoot, 'versions', customVersionId)
  assertPathWithinRoot(instanceRoot, versionDir)
  const installedProfilePath = path.join(versionDir, `${customVersionId}.json`)
  const installMarkerPath = path.join(loaderDir, `${loaderVersion}.installed.json`)
  assertPathWithinRoot(versionDir, installedProfilePath)
  assertPathWithinRoot(loaderDir, installMarkerPath)
  if (!fs.existsSync(installedProfilePath) || !fs.existsSync(installMarkerPath)) {
    sendProgress({ type: 'loader-install', task: 20, total: 100, detail: 'neoforge' })
    await ensureVerifiedMinecraftClient(instanceRoot, safeMinecraftVersion, signal)
    await runNeoForgeInstaller(javaPath, installerPath, instanceRoot, signal)
    if (!fs.existsSync(installedProfilePath)) {
      throw new Error(`NeoForge installer completed without creating ${customVersionId}.`)
    }
    fs.writeFileSync(installMarkerPath, JSON.stringify({
      minecraftVersion: safeMinecraftVersion,
      loaderVersion,
      customVersionId,
      installedAt: new Date().toISOString()
    }, null, 2), 'utf8')
  }
  log.info(`NeoForge profile ready: ${customVersionId}`)
  return {
    customVersionId,
    loaderVersion,
    javaArgs: resolveNeoForgeJvmArguments(instanceRoot, customVersionId, profile.arguments?.jvm || [])
  }
}

type VersionProfileRule = {
  action?: 'allow' | 'disallow'
  os?: {
    name?: string
    arch?: string
  }
}

type VersionProfileArgument = string | number | {
  rules?: VersionProfileRule[]
  value?: string | string[]
}

const getMinecraftOsName = () => {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

const getMinecraftArchName = () => {
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm64') return 'arm64'
  return 'x86_64'
}

const matchesVersionProfileRule = (rule: VersionProfileRule) => {
  if (!rule.os) return true
  if (rule.os.name && rule.os.name !== getMinecraftOsName()) return false
  if (rule.os.arch && rule.os.arch !== getMinecraftArchName()) return false
  return true
}

const shouldUseVersionProfileArgument = (argument: Exclude<VersionProfileArgument, string | number>) => {
  if (!Array.isArray(argument.rules) || argument.rules.length === 0) return true

  let allowed = false
  for (const rule of argument.rules) {
    if (!matchesVersionProfileRule(rule)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

const resolveNeoForgeJvmArguments = (
  instanceRoot: string,
  customVersionId: string,
  args: VersionProfileArgument[]
) => {
  const separator = process.platform === 'win32' ? ';' : ':'
  const replacements: Record<string, string> = {
    '${library_directory}': path.join(instanceRoot, 'libraries'),
    '${classpath_separator}': separator,
    '${version_name}': customVersionId,
    '${launcher_name}': 'NamLauncher',
    '${launcher_version}': app.getVersion()
  }
  const replacePlaceholders = (value: string) => Object.entries(replacements)
    .reduce((text, [key, replacement]) => text.split(key).join(replacement), value)
  const resolved: string[] = []

  for (const arg of args) {
    if (typeof arg === 'string' || typeof arg === 'number') {
      resolved.push(replacePlaceholders(String(arg)))
      continue
    }

    if (!shouldUseVersionProfileArgument(arg)) continue
    const values = Array.isArray(arg.value) ? arg.value : [arg.value]
    values
      .filter((value): value is string => typeof value === 'string')
      .forEach((value) => resolved.push(replacePlaceholders(value)))
  }

  return resolved.filter(Boolean)
}

const prepareLoader = async (
  instanceRoot: string,
  instance: ReturnType<typeof normalizeInstance>,
  javaPath: string,
  signal?: AbortSignal
) => {
  if (instance.loader === 'fabric') {
    sendProgress({ type: 'loader-install', task: 10, total: 100, detail: 'fabric' })
    const fabric = await ensureFabricProfile(instanceRoot, instance.version, instance.loaderVersion)
    sendProgress({ type: 'loader-install', task: 100, total: 100, detail: 'fabric' })
    return {
      customVersionId: fabric.customVersionId,
      resolvedLoaderVersion: fabric.loaderVersion
    }
  }

  if (instance.loader === 'quilt') {
    sendProgress({ type: 'loader-install', task: 10, total: 100, detail: 'quilt' })
    const quilt = await ensureQuiltProfile(instanceRoot, instance.version, instance.loaderVersion)
    sendProgress({ type: 'loader-install', task: 100, total: 100, detail: 'quilt' })
    return {
      customVersionId: quilt.customVersionId,
      resolvedLoaderVersion: quilt.loaderVersion
    }
  }

  if (instance.loader === 'forge') {
    sendProgress({ type: 'loader-install', task: 10, total: 100, detail: 'forge' })
    const forge = await ensureForgeInstaller(instanceRoot, instance.version, instance.loaderVersion)
    const directProfile = await ensureDirectForgeProfile(instanceRoot, instance.version, javaPath, forge, signal)
    sendProgress({ type: 'loader-install', task: 100, total: 100, detail: 'forge' })
    if (directProfile) return directProfile
    return {
      forgePath: forge.forgePath,
      resolvedLoaderVersion: forge.loaderVersion
    }
  }

  if (instance.loader === 'neoforge') {
    sendProgress({ type: 'loader-install', task: 10, total: 100, detail: 'neoforge' })
    const neoForge = await ensureNeoForgeProfile(instanceRoot, instance.version, javaPath, instance.loaderVersion, signal)
    sendProgress({ type: 'loader-install', task: 100, total: 100, detail: 'neoforge' })
    return {
      customVersionId: neoForge.customVersionId,
      resolvedLoaderVersion: neoForge.loaderVersion,
      javaArgs: neoForge.javaArgs
    }
  }

  return {}
}

function createLauncherStartupSplashHtml(iconPath?: string) {
  const iconUrl = iconPath ? pathToFileURL(iconPath).toString() : ''
  const iconMarkup = iconUrl
    ? `<img src="${iconUrl}" alt="" />`
    : '<div class="logo-fallback">NL</div>'

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>NamLauncher</title>
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #07111f;
        color: #e5eefc;
        font-family: "Noto Sans Thai", "Leelawadee UI", "Segoe UI", sans-serif;
      }
      body {
        display: grid;
        place-items: center;
        background:
          linear-gradient(135deg, rgba(37, 99, 235, 0.12), transparent 34%),
          linear-gradient(180deg, #09101f, #07111f);
      }
      main {
        width: min(440px, calc(100vw - 48px));
        text-align: center;
      }
      img, .logo-fallback {
        width: 96px;
        height: 96px;
        margin: 0 auto;
        border-radius: 18px;
        object-fit: contain;
        filter: drop-shadow(0 22px 40px rgba(59, 130, 246, 0.36));
      }
      .logo-fallback {
        display: grid;
        place-items: center;
        border: 1px solid rgba(96, 165, 250, 0.34);
        background: rgba(37, 99, 235, 0.14);
        color: #bfdbfe;
        font-size: 28px;
        font-weight: 900;
      }
      h1 {
        margin: 26px 0 8px;
        color: #fff;
        font-size: 34px;
        font-weight: 900;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #9fb0c9;
        font-size: 13px;
        font-weight: 800;
      }
      .bar {
        position: relative;
        height: 8px;
        margin-top: 30px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.94);
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.1);
      }
      .bar::after {
        position: absolute;
        inset: 0;
        width: 44%;
        border-radius: inherit;
        background: linear-gradient(90deg, #2563eb, #60a5fa);
        animation: load 1.1s ease-in-out infinite;
        content: "";
      }
      @keyframes load {
        from { transform: translateX(-120%); }
        to { transform: translateX(240%); }
      }
    </style>
  </head>
  <body>
    <main role="status" aria-live="polite">
      ${iconMarkup}
      <h1>NamLauncher</h1>
      <p>กำลังเปิดลันเชอร์และโหลดข้อมูล...</p>
      <div class="bar" aria-hidden="true"></div>
    </main>
  </body>
</html>`
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow()
    return
  }

  const icon = getAppIcon()
  const iconPath = icon?.path
  const rendererRoot = path.resolve(__dirname, '../dist')
  const rendererIndexPath = path.join(rendererRoot, 'index.html')
  const devServerUrl = !app.isPackaged ? String(process.env.VITE_DEV_SERVER_URL || '').trim() : ''

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 1280,
    minHeight: 720,
    ...(icon ? { icon: icon.image } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true
    },
    frame: false,
    show: false,
    backgroundColor: '#07111f'
  })
  rendererResponsivenessMonitor?.dispose()
  const monitoredWindow = mainWindow
  rendererResponsivenessMonitor = new WindowResponsivenessMonitor({
    onPersistent: async (durationMs) => {
      if (isAppQuitting || monitoredWindow.isDestroyed()) return
      log.warn('Launcher renderer remained unresponsive.', {
        durationMs,
        visible: monitoredWindow.isVisible(),
        minimized: monitoredWindow.isMinimized(),
        restingInTray: launcherRestingInTray
      })
      await publishLauncherError(
        'The launcher window remained unresponsive for at least 12 seconds.',
        'electron-window',
        'Launcher remained unresponsive'
      )
    },
    onRecovered: (durationMs, reported) => {
      log.info(`Launcher renderer recovered after ${durationMs}ms${reported ? ' (incident reported).' : '.'}`)
    },
    onReportError: (error) => {
      log.warn('Could not publish a sustained renderer unresponsive incident.', getCompactErrorLog(error))
    }
  })

  mainWindow.on('show', () => {
    launcherRestingInTray = false
    mainWindow?.setSkipTaskbar(false)
    syncDiscordForLauncherState()
  })

  mainWindow.on('restore', () => {
    launcherRestingInTray = false
    syncDiscordForLauncherState()
  })
  mainWindow.on('minimize', syncDiscordForLauncherState)
  mainWindow.on('hide', () => {
    launcherRestingInTray = true
    syncDiscordForLauncherState()
  })

  mainWindow.on('close', (event) => {
    if (isAppQuitting) return
    event.preventDefault()
    closeLauncherWindow()
  })

  mainWindow.on('unresponsive', () => rendererResponsivenessMonitor?.markUnresponsive())
  mainWindow.on('responsive', () => rendererResponsivenessMonitor?.markResponsive())

  mainWindow.on('closed', () => {
    rendererResponsivenessMonitor?.dispose()
    rendererResponsivenessMonitor = null
    mainWindow = null
    if (!isAppQuitting) syncDiscordForLauncherState()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(() => undefined)
    return { action: 'deny' }
  })

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  const windowForRenderer = mainWindow
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isAppQuitting || details.reason === 'clean-exit') return
    publishLauncherError(`Renderer process ended: ${details.reason} (exit code ${details.exitCode})`, 'renderer-process', 'Launcher renderer stopped')
      .catch(() => undefined)

    const now = Date.now()
    rendererRecoveryAttempts = rendererRecoveryAttempts.filter((attemptedAt) => (
      now - attemptedAt < RENDERER_RECOVERY_WINDOW_MS
    ))
    if (rendererRecoveryAttempts.length >= MAX_RENDERER_RECOVERIES_PER_WINDOW) {
      log.error('Launcher renderer recovery stopped after repeated failures.')
      return
    }
    rendererRecoveryAttempts.push(now)

    const recoveryTimer = setTimeout(() => {
      if (
        isAppQuitting
        || !windowForRenderer
        || windowForRenderer.isDestroyed()
        || mainWindow !== windowForRenderer
        || windowForRenderer.webContents.isDestroyed()
      ) return
      log.warn(`Reloading the launcher interface after renderer ${details.reason}.`)
      windowForRenderer.webContents.reload()
    }, 250)
    recoveryTimer.unref?.()
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    publishLauncherError(`${errorDescription} (error ${errorCode})`, 'renderer-load', 'Launcher interface failed to load')
      .catch(() => undefined)
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return
    if (!devServerUrl) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'file:') {
          const targetPath = fileURLToPath(parsed)
          if (isSamePath(targetPath, rendererIndexPath) || isPathInside(targetPath, rendererRoot)) return
        }
      } catch {
        // Fall through and block malformed or external navigation targets.
      }
    }

    event.preventDefault()
    openExternalUrl(url).catch(() => undefined)
  })

  const loadLauncherRenderer = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (devServerUrl) {
      mainWindow.loadURL(devServerUrl)
    } else {
      mainWindow.loadFile(rendererIndexPath)
    }
  }

  mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(createLauncherStartupSplashHtml(iconPath))}`)
    .then(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showMainWindow()
      setTimeout(loadLauncherRenderer, 120)
    })
    .catch(() => {
      loadLauncherRenderer()
    })
}

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(() => {
  migrateStoredAccountsEncryption()
  createWindow()
  const settings = readLauncherSettings()
  configureDiscordForActiveGames(settings)
  configureOnlineHeartbeat(settings)
  configureLauncherUpdateChecks()
})

app.on('activate', () => {
  showMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') requestAppQuit()
})

app.on('before-quit', () => {
  isAppQuitting = true
  rendererResponsivenessMonitor?.dispose()
  releaseRunningGamesForLauncherExit()
  stopOnlineHeartbeat()
  stopLauncherUpdateChecks()
  offlineSkinServer?.close()
  offlineSkinServer = null
  offlineSkinServerPort = 0
  discordManager.shutdown()
  minecraftDiscordManager.shutdown()
  tray?.destroy()
  tray = null
})

trustedIpcHandle('get-accounts', async () => {
  return readAccounts().map(toAccountSummary)
})

trustedIpcHandle('set-active-account-context', async (_event, accountId: string | null) => {
  const requestedId = String(accountId || '').trim()
  if (!requestedId) {
    activeErrorReportAccountId = null
    return { activeAccountId: null }
  }

  const account = readAccounts().find((item) => item.id === requestedId)
  if (!account) {
    activeErrorReportAccountId = null
    return { activeAccountId: null }
  }
  activeErrorReportAccountId = account.id
  return { activeAccountId: account.id }
})

trustedIpcHandle('remove-account', async (_event, accountId: string) => {
  return removeStoredAccount(accountId).accounts
})

trustedIpcHandle('get-skin-library', async (_event, accountId: string) => {
  return getPublicSkinLibrary(accountId, false)
})

trustedIpcHandle('refresh-skin-library', async (_event, accountId: string) => {
  return getPublicSkinLibrary(accountId, true)
})

trustedIpcHandle('save-skin-preset', async (_event, request: SkinSaveRequest) => {
  return saveSkinPreset(request || {})
})

trustedIpcHandle('save-default-skin-preset', async (_event, request: SkinDefaultRequest) => {
  return saveDefaultSkinPreset(request || {})
})

trustedIpcHandle('import-skin-by-name', async (_event, request: SkinImportRequest) => {
  return importSkinByPlayerName(request || {})
})

trustedIpcHandle('import-offline-skin-by-name', async (_event, request: SkinImportRequest) => {
  return importSkinByPlayerName(request || {})
})

trustedIpcHandle('activate-skin-preset', async (_event, request: SkinActionRequest) => {
  return activateSkinPreset(request || {})
})

trustedIpcHandle('delete-skin-preset', async (_event, request: SkinActionRequest) => {
  return deleteSkinPreset(request || {})
})

trustedIpcHandle('reset-active-skin', async (_event, request: SkinActionRequest) => {
  return resetActiveSkin(request || {})
})

trustedIpcHandle('get-loader-versions', async (_event, loader: string, mcVersion: string) => {
  const normalizedVersion = String(mcVersion || '').trim()
  try {
    if (loader === 'fabric') return normalizedVersion ? listFabricLoaderVersions(normalizedVersion) : []
    if (loader === 'forge') return normalizedVersion ? listForgeVersions(normalizedVersion) : []
    if (loader === 'quilt') return listQuiltLoaderVersions(normalizedVersion)
    if (loader === 'neoforge') return normalizedVersion ? listNeoForgeVersions(normalizedVersion) : []
    return []
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error(`Could not list ${loader} versions for Minecraft ${normalizedVersion || '(empty)'}.`, detail)
    throw new Error(`Could not load ${loader} versions for Minecraft ${normalizedVersion || 'unknown'}: ${detail}`)
  }
})

trustedIpcHandle('get-loader-compatibility', async (_event, loader: string, mcVersion: string) => {
  const normalizedVersion = String(mcVersion || '').trim()
  if (loader === 'quilt' && normalizedVersion) return getQuiltGameCompatibility(normalizedVersion)
  return {
    supported: true,
    requestedGameVersion: normalizedVersion,
    recommendedGameVersion: null
  }
})

trustedIpcHandle('get-game-state', async () => {
  return getGameState()
})

trustedIpcHandle('hydrate-instances', async (_event, instances: LauncherInstance[]) => {
  return hydrateLauncherInstances(instances)
})

trustedIpcHandle('update-instance', async (_event, request: InstanceUpdateRequest) => {
  return updateInstanceMetadata(request || {})
})

// Author/creator: nattapat2871 (https://nattapat2871.me)
const activeInstanceServerMutations = new Set<string>()

const assertInstanceServerListMutable = (instance: ReturnType<typeof normalizeInstance>) => {
  if (runningGames.has(instance.id) || activeLaunches.has(instance.id)) {
    throw new Error('Stop Minecraft before changing servers in this instance.')
  }
  if (activeInstanceServerMutations.has(instance.id)) {
    throw new Error('Wait for the current server-list update to finish.')
  }
}

const withInstanceServerListMutation = async <Result>(
  instance: ReturnType<typeof normalizeInstance>,
  action: () => Promise<Result>
) => {
  assertInstanceServerListMutable(instance)
  activeInstanceServerMutations.add(instance.id)
  try {
    return await action()
  } finally {
    activeInstanceServerMutations.delete(instance.id)
  }
}

trustedIpcHandle('provision-instance', async (_event, request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  const defaults = await withInstanceServerListMutation(instance, () => provisionInstanceDefaults(instance))
  return {
    success: true,
    ...defaults
  }
})

trustedIpcHandle('get-instance-places', async (_event, request: LaunchRequest) => {
  return getInstancePlaces(request || {})
})

trustedIpcHandle('get-lan-readiness', async (event, request: LanReadinessRequest = {}) => {
  assertMainRendererInvocation(event)
  const instance = request.instance ? normalizeInstance({ instance: request.instance }) : null
  const runningGame = instance ? runningGames.get(instance.id) || null : getLatestRunningGame()
  return assessLanReadiness({
    interfaces: os.networkInterfaces(),
    detectedPort: runningGame?.lanPort
  })
})

trustedIpcHandle('discover-lan-servers', async (event) => {
  assertMainRendererInvocation(event)
  return discoverLocalMinecraftServers()
})

trustedIpcHandle('ping-instance-servers', async (_event, request: InstanceServerPingRequest) => {
  return pingInstanceServers(request || {})
})

trustedIpcHandle('add-instance-server', async (_event, request: InstanceServerMutationRequest) => {
  const instance = normalizeInstance(request || {})
  const { serversPath } = getInstancePlacesPaths(instance)
  return withInstanceServerListMutation(
    instance,
    () => addMinecraftServerDat(
      serversPath,
      String(request?.name || ''),
      String(request?.address || '')
    )
  )
})

trustedIpcHandle('remove-instance-server', async (_event, request: InstanceServerMutationRequest) => {
  const instance = normalizeInstance(request || {})
  const { serversPath } = getInstancePlacesPaths(instance)
  return withInstanceServerListMutation(
    instance,
    () => removeMinecraftServerDat(
      serversPath,
      Number(request?.index),
      String(request?.expectedCanonicalKey || '')
    )
  )
})

trustedIpcHandle('cache-image-url', async (_event, url: string) => {
  return cacheRemoteImageUrl(url)
})

trustedIpcHandle('renderer-ready', async (event) => {
  if (!isMainRendererInvocation(event)) return false
  log.info('--- NamLauncher renderer ready ---')
  return true
})

trustedIpcHandle('get-instance-update-summary', async (_event, request: LaunchRequest) => {
  return getInstanceUpdateSummary(request)
})

trustedIpcHandle('get-launcher-version', async () => {
  return app.getVersion()
})

trustedIpcHandle('check-launcher-update', async () => {
  return checkLauncherUpdate()
})

trustedIpcHandle('install-launcher-update', async () => {
  return installLauncherUpdate()
})

trustedIpcHandle('get-launcher-stats', async () => {
  return getLauncherWebsiteStats()
})

trustedIpcHandle('get-legal-document', async (_event, language: LegalLanguage) => {
  return fetchLegalDocument(STATS_API_BASE, language === 'en' ? 'en' : 'th')
})

trustedIpcHandle('get-discord-settings', async () => {
  return readLauncherSettings()
})

trustedIpcHandle('run-startup-launcher-update', async () => runStartupLauncherUpdate())

trustedIpcHandle('get-launcher-discord-account', async () => {
  return getLauncherDiscordAccountState()
})

trustedIpcHandle('connect-launcher-discord-account', async () => {
  return connectLauncherDiscordAccount()
})

trustedIpcHandle('disconnect-launcher-discord-account', async () => {
  return disconnectLauncherDiscordAccount()
})

trustedIpcHandle('get-launcher-data-location', async () => {
  return getLauncherDataLocation()
})

trustedIpcHandle('choose-launcher-data-location', async (_event, request: DataLocationMoveRequest = {}) => {
  if (hasActiveMinecraft()) {
    throw new Error('Stop Minecraft and wait for launch tasks to finish before moving the game data folder.')
  }

  const restartAfterMove = request.restartAfterMove !== false
  const dialogTitle = request.initialSetup
    ? 'Choose where NamLauncher should store Minecraft data'
    : 'Choose NamLauncher game data location'
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, {
      title: dialogTitle,
      defaultPath: path.dirname(getLauncherRootForSelectedPath(userDataPath)),
      properties: ['openDirectory', 'createDirectory']
    })
    : await dialog.showOpenDialog({
      title: dialogTitle,
      defaultPath: path.dirname(getLauncherRootForSelectedPath(userDataPath)),
      properties: ['openDirectory', 'createDirectory']
    })

  if (result.canceled || !result.filePaths[0]) {
    return { ...getLauncherDataLocation(), canceled: true, changed: false }
  }

  const selectedPath = path.resolve(result.filePaths[0])
  const targetDataPath = normalizeLauncherDataTarget(selectedPath)
  const targetRootPath = getLauncherRootForSelectedPath(selectedPath)

  if (isSamePath(targetDataPath, userDataPath)) {
    return { ...getLauncherDataLocation(), canceled: false, changed: false }
  }

  if (isPathInside(targetDataPath, userDataPath)) {
    throw new Error('Choose a folder outside the current NamLauncher data folder.')
  }

  if (!canWriteToDirectory(targetDataPath)) {
    throw new Error('NamLauncher cannot write to the selected folder.')
  }

  if (!request.initialSetup) {
    const confirmation = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Move and restart', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Move NamLauncher game data',
        message: 'Move NamLauncher data to this folder?',
        detail: `Current:\n${userDataPath}\n\nNew root:\n${targetRootPath}\n\nNew data:\n${targetDataPath}\n\nInstances, runtimes, cache, accounts, settings, and UI data will be copied first. NamLauncher will restart after the move and then clean the old migrated files.`
      })
      : await dialog.showMessageBox({
        type: 'question',
        buttons: ['Move and restart', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Move NamLauncher game data',
        message: 'Move NamLauncher data to this folder?',
        detail: `Current:\n${userDataPath}\n\nNew root:\n${targetRootPath}\n\nNew data:\n${targetDataPath}\n\nInstances, runtimes, cache, accounts, settings, and UI data will be copied first. NamLauncher will restart after the move and then clean the old migrated files.`
      })

    if (confirmation.response !== 0) {
      return { ...getLauncherDataLocation(), canceled: true, changed: false }
    }
  }

  const { copiedEntries } = copyLauncherDataEntries(targetDataPath)
  const cleanupPath = path.join(targetDataPath, DATA_CLEANUP_FILE)
  try {
    if (copiedEntries.length > 0) {
      writePendingDataCleanup(targetDataPath, userDataPath, copiedEntries)
    }
    writeDataLocationConfig(targetDataPath)
  } catch (err) {
    try {
      fs.rmSync(cleanupPath, { force: true })
    } catch (cleanupError) {
      log.warn('Failed to remove pending data cleanup marker after finalization error.', cleanupError)
    }
    for (const entryName of copiedEntries) {
      try {
        fs.rmSync(path.join(targetDataPath, entryName), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 150
        })
      } catch (rollbackError) {
        log.warn(`Failed to roll back launcher data after finalization error: ${entryName}`, rollbackError)
      }
    }
    log.error('Failed to finalize launcher data move.', err)
    throw new Error('Could not finalize the data folder move. The current data folder remains active.')
  }

  const response = {
    ...getLauncherDataLocation(),
    currentRoot: getLauncherRootForSelectedPath(userDataPath),
    nextRoot: targetRootPath,
    nextPath: targetDataPath,
    configuredPath: targetDataPath,
    canceled: false,
    changed: true,
    restartRequired: restartAfterMove,
    copiedEntries,
    skippedEntries: [],
    failedEntries: []
  }

  if (restartAfterMove) {
    const restartMessage = request.initialSetup
      ? 'NamLauncher needs to restart to use your selected game folder.'
      : 'NamLauncher needs to restart to finish moving the game data folder.'
    const restartDetail = `New root:\n${targetRootPath}\n\nData folder:\n${targetDataPath}\n\nAfter restart, NamLauncher will use this folder and clean old migrated files.`

    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart NamLauncher'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Restart required',
        message: restartMessage,
        detail: restartDetail
      })
    } else {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart NamLauncher'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Restart required',
        message: restartMessage,
        detail: restartDetail
      })
    }

    app.relaunch()
    app.exit(0)
  }

  return response
})

trustedIpcHandle('get-discord-status', async () => {
  if (launcherRestingInTray || isAppQuitting) return discordManager.getStatus()
  const runningGame = getLatestRunningGame()
  if (!runningGame) return discordManager.getStatus()

  const settings = readLauncherSettings()
  if (settings.discordRpcEnabled) {
    const status = discordManager.getStatus()
    return {
      ...status,
      lastActivity: status.lastActivity || 'NamLauncher custom status',
      applicationId: status.applicationId || MINECRAFT_OFFICIAL_APPLICATION_ID
    }
  }

  return {
    enabled: false,
    state: 'native',
    connected: false,
    lastActivity: 'Minecraft native detection',
    lastActivityAt: runningGame.startedAt ? new Date(runningGame.startedAt).toISOString() : null,
    applicationId: MINECRAFT_OFFICIAL_APPLICATION_ID,
    lastError: null,
    reconnectAttempts: 0
  }
})

const configureDiscordForActiveGames = (settings = readLauncherSettings()) => {
  minecraftDiscordManager.shutdown()
  // Every caller (including game callbacks/settings changes) must respect tray sleep.
  // Online/gameplay heartbeat services have an independent lifecycle.
  if (launcherRestingInTray || isAppQuitting) {
    discordManager.shutdown()
    return
  }
  const runningGame = getLatestRunningGame()

  if (!runningGame) {
    discordManager.configure(getDiscordRuntimeSettings(settings))
    discordManager.setIdleStatus()
    return
  }

  if (settings.discordRpcEnabled) {
    discordManager.configure(getMinecraftDiscordRuntimeSettings(settings))
    discordManager.setLauncherGameStatus(
      runningGame.instanceName,
      runningGame.minecraftVersion,
      runningGame.playerName,
      runningGame.playerUuid,
      runningGame.gamePid,
      runningGame.playerTextureId
    )
    return
  }

  discordManager.shutdown()
}

trustedIpcHandle('set-discord-settings', async (_event, settings: Partial<LauncherSettings>) => {
  const current = readLauncherSettings()
  const next: LauncherSettings = {
    discordRpcEnabled: settings.discordRpcEnabled ?? current.discordRpcEnabled,
    anonymousStatsEnabled: true,
    gameplayTelemetryEnabled: true,
    playerBadgeEnabled: settings.playerBadgeEnabled ?? current.playerBadgeEnabled,
    restrictedModAuditEnabled: true,
    customJavaArgsEnabled: settings.customJavaArgsEnabled ?? current.customJavaArgsEnabled,
    customJavaArgs: typeof settings.customJavaArgs === 'string'
      ? settings.customJavaArgs
      : current.customJavaArgs,
    autoMinimizeOnLaunch: settings.autoMinimizeOnLaunch ?? current.autoMinimizeOnLaunch,
    closeToTrayEnabled: settings.closeToTrayEnabled ?? current.closeToTrayEnabled,
    automaticMemory: typeof settings.automaticMemory === 'boolean'
      ? settings.automaticMemory
      : current.automaticMemory,
    performanceProfile: normalizePerformanceProfile(
      settings.performanceProfile ?? current.performanceProfile
    ),
    language: settings.language === 'th' || settings.language === 'en'
      ? settings.language
      : current.language
  }

  saveLauncherSettings(next)
  refreshTrayMenu()
  configureDiscordForActiveGames(next)
  log.info(launcherRestingInTray
    ? 'NamLauncher Discord RPC remains paused in the system tray.'
    : runningGames.size > 0 && next.discordRpcEnabled
    ? 'NamLauncher custom Discord RPC is active for the most recently started instance.'
    : runningGames.size > 0
      ? 'NamLauncher Discord RPC is disabled while Minecraft instances are active.'
      : 'NamLauncher Discord RPC returned to launcher status.')
  configureOnlineHeartbeat(next)
  configureGameSessionTelemetry(next)
  configurePlayerBadgePresence(next)
  return next
})

trustedIpcHandle('get-instance-mods', async (_event, request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  return listInstanceMods(instance)
})

trustedIpcHandle('get-instance-content', async (_event, request: InstanceContentRequest) => {
  return getInstanceContent(request)
})

trustedIpcHandle('get-instance-run-log', async (_event, request: LaunchRequest) => {
  return getInstanceRunLog(request)
})

trustedIpcHandle('toggle-instance-content', async (_event, request: InstanceContentRequest) => {
  return toggleInstanceContent(request)
})

trustedIpcHandle('delete-instance-content', async (_event, request: InstanceContentRequest) => {
  return deleteInstanceContent(request)
})

trustedIpcHandle('import-instance-content-files', async (_event, request: InstanceContentRequest) => {
  return importInstanceContentFiles(request)
})

trustedIpcHandle('reveal-instance-content-file', async (_event, request: InstanceContentRequest) => {
  return revealInstanceContentFile(request)
})

trustedIpcHandle('open-instance-folder', async (_event, request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  const { gameDirectory } = ensureInstanceRoot(instance)
  ensureDir(gameDirectory)
  shell.openPath(gameDirectory)
  return { success: true }
})

trustedIpcHandle('open-manual-download-folder', async () => {
  const downloadsDirectory = app.getPath('downloads')
  ensureDir(downloadsDirectory)
  await shell.openPath(downloadsDirectory)
  return { success: true, path: downloadsDirectory }
})

trustedIpcHandle('copy-to-clipboard', async (_event, value: string) => {
  const text = String(value || '')
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('The copied text is too large.')
  }
  clipboard.writeText(text)
  return { success: true }
})

trustedIpcHandle('import-curseforge-manual-download', async (_event, request: CurseForgeManualDownloadRequest) => {
  return importCurseForgeManualDownload(request || {})
})

trustedIpcHandle('get-curseforge-config', async () => {
  return getCurseForgeConfigStatus()
})

trustedIpcHandle('search-curseforge', async (_event, request: CurseForgeSearchRequest) => {
  activeCurseForgeSearchController?.abort()
  const controller = new AbortController()
  activeCurseForgeSearchController = controller
  try {
    return await searchCurseForgeProjects(request || {}, controller.signal)
  } catch (err) {
    if (controller.signal.aborted) {
      return { hits: [], total_hits: 0, canceled: true }
    }
    throw err
  } finally {
    if (activeCurseForgeSearchController === controller) {
      activeCurseForgeSearchController = null
    }
  }
})

trustedIpcHandle('get-home-modpacks', async () => {
  const lanes: Array<{ lane: HomeDiscoveryLane; index: 'downloads' | 'updated' | 'newest' }> = [
    { lane: 'popular', index: 'downloads' },
    { lane: 'updated', index: 'updated' },
    { lane: 'newest', index: 'newest' }
  ]
  const settled = await Promise.allSettled(lanes.map(async ({ lane, index }) => {
    const result = await searchModrinthProjects({
      query: '',
      projectType: 'modpack',
      offset: 0,
      limit: 18,
      index
    })
    return {
      lane,
      hits: result.hits,
      stale: Boolean((result as { stale?: boolean }).stale)
    }
  }))
  const healthyResults = settled
    .filter((result): result is PromiseFulfilledResult<HomeDiscoveryLaneResult & { stale: boolean }> => result.status === 'fulfilled')
    .map((result) => result.value)

  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      log.warn(`Home Modrinth ${lanes[index].lane} lane is unavailable; filling from healthy discovery lanes.`, getCompactErrorLog(result.reason))
    }
  })

  return {
    hits: selectHomeDiscoveryProjects(healthyResults, HOME_DISCOVERY_SESSION_SEED),
    total_hits: healthyResults.reduce((total, result) => total + result.hits.length, 0),
    stale: healthyResults.some((result) => result.stale),
    degraded: healthyResults.length < lanes.length
  }
})

trustedIpcHandle('search-modrinth', async (_event, request: ModrinthSearchRequest) => {
  activeModrinthSearchController?.abort()
  const controller = new AbortController()
  activeModrinthSearchController = controller
  try {
    return await searchModrinthProjects(request || {}, controller.signal)
  } catch (err) {
    // Author/creator: nattapat2871 (https://nattapat2871.me)
    if (controller.signal.aborted && axios.isCancel(err)) {
      return { hits: [], total_hits: 0, canceled: true }
    }
    log.warn('Modrinth search failed after all network fallbacks.', getCompactErrorLog(err))
    throw new Error(axios.isAxiosError(err)
      ? getModrinthFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  } finally {
    if (activeModrinthSearchController === controller) {
      activeModrinthSearchController = null
    }
  }
})

trustedIpcHandle('get-curseforge-modpack-versions', async (_event, request: CurseForgeInstallRequest) => {
  try {
    return await getCurseForgeModpackVersions(request || {})
  } catch (err) {
    throw new Error(axios.isAxiosError(err)
      ? getCurseForgeFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  }
})

trustedIpcHandle('get-curseforge-project-versions', async (_event, request: CurseForgeInstallRequest) => {
  try {
    return await getCurseForgeProjectVersions(request || {})
  } catch (err) {
    throw new Error(axios.isAxiosError(err)
      ? getCurseForgeFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  }
})

trustedIpcHandle('install-curseforge-modpack', async (_event, request: CurseForgeInstallRequest) => {
  const startedAt = Date.now()
  try {
    const result = await withInstallTask(request || {}, 'curseforge-modpack', (signal) => installCurseForgeModpack(request || {}, signal))
    recordContentUsage('curseforge', request || {}, startedAt, 'success', `version=${result?.version || 'unknown'}`)
    return result
  } catch (err) {
    if (isInstallCancelledError(err)) {
      recordContentUsage('curseforge', request || {}, startedAt, 'cancelled')
      return { success: false, canceled: true, cancelled: true }
    }
    const modId = getCurseForgeModId(request?.project)
    const message = axios.isAxiosError(err)
      ? getCurseForgeFailureMessage(err, 'download')
      : sanitizeBugReport(err instanceof Error ? err.message : err)
    recordContentUsage('curseforge', request || {}, startedAt, 'failed', message)
    log.error(`CurseForge modpack install failed${modId ? ` for project ${modId}` : ''}: ${message}`)
    throw new Error(message)
  }
})

trustedIpcHandle('get-curseforge-content-status', async (_event, request: CurseForgeContentStatusRequest) => {
  try {
    return await getCurseForgeContentStatus(request || {})
  } catch (err) {
    throw new Error(axios.isAxiosError(err)
      ? getCurseForgeFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  }
})

trustedIpcHandle('install-curseforge-content', async (_event, request: CurseForgeInstallRequest) => {
  const startedAt = Date.now()
  try {
    const result = await installCurseForgeProject(request || {})
    recordContentUsage('curseforge', request || {}, startedAt, 'success', `version=${result?.version || 'unknown'}`)
    return result
  } catch (err) {
    const modId = getCurseForgeModId(request?.project)
    const message = axios.isAxiosError(err)
      ? getCurseForgeFailureMessage(err, 'download')
      : sanitizeBugReport(err instanceof Error ? err.message : err)
    recordContentUsage('curseforge', request || {}, startedAt, 'failed', message)
    log.error(`CurseForge install failed${modId ? ` for project ${modId}` : ''}: ${message}`)
    throw new Error(message)
  }
})

trustedIpcHandle('get-modrinth-content-status', async (_event, request: ModrinthContentStatusRequest) => {
  try {
    return await getModrinthContentStatuses(request)
  } catch (err) {
    throw new Error(axios.isAxiosError(err)
      ? getModrinthFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  }
})

trustedIpcHandle('get-modrinth-project-versions', async (_event, request: ModrinthInstallRequest) => {
  try {
    return await getModrinthProjectVersions(request)
  } catch (err) {
    throw new Error(axios.isAxiosError(err)
      ? getModrinthFailureMessage(err, 'search')
      : sanitizeBugReport(err instanceof Error ? err.message : err))
  }
})

trustedIpcHandle('install-modrinth-content', async (_event, request: ModrinthInstallRequest) => {
  const startedAt = Date.now()
  try {
    const result = await installModrinthProject(request)
    recordContentUsage('modrinth', request || {}, startedAt, 'success', `version=${result?.version || 'unknown'}`)
    return result
  } catch (err) {
    const message = axios.isAxiosError(err)
      ? getModrinthFailureMessage(err, 'download')
      : sanitizeBugReport(err instanceof Error ? err.message : err)
    recordContentUsage('modrinth', request || {}, startedAt, 'failed', message)
    throw new Error(message)
  }
})

trustedIpcHandle('install-modrinth-modpack', async (_event, request: ModrinthInstallRequest) => {
  const startedAt = Date.now()
  try {
    const result = await withInstallTask(request || {}, 'modrinth-modpack', (signal) => installModrinthModpack(request || {}, signal))
    recordContentUsage('modrinth', request || {}, startedAt, 'success', `version=${result?.version || 'unknown'}`)
    return result
  } catch (err) {
    if (isInstallCancelledError(err)) {
      recordContentUsage('modrinth', request || {}, startedAt, 'cancelled')
      return { success: false, canceled: true, cancelled: true }
    }
    const message = axios.isAxiosError(err)
      ? getModrinthFailureMessage(err, 'download')
      : sanitizeBugReport(err instanceof Error ? err.message : err)
    recordContentUsage('modrinth', request || {}, startedAt, 'failed', message)
    throw new Error(message)
  }
})

trustedIpcHandle('install-local-mrpack', async (_event, request: { taskId?: string } = {}) => {
  const options: OpenDialogOptions = {
    title: 'Install .mrpack',
    properties: ['openFile'],
    filters: [
      { name: 'Modrinth modpack (.mrpack)', extensions: ['mrpack'] }
    ]
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  return withInstallTask(request || {}, 'local-mrpack', (signal) => installLocalMrpack(result.filePaths[0], signal))
})

trustedIpcHandle('cancel-install-task', async (_event, taskId: unknown) => {
  const normalizedTaskId = String(taskId || '').trim()
  if (normalizedTaskId) {
    cancelledInstallTaskIds.add(normalizedTaskId)
    setTimeout(() => cancelledInstallTaskIds.delete(normalizedTaskId), 5 * 60 * 1000).unref?.()
  }
  const task = activeInstallTasks.get(normalizedTaskId)
  if (task) {
    task.cancelled = true
    task.abortController.abort()
    activeInstallTasks.delete(normalizedTaskId)
  }
  sendProgress({
    type: 'content-cancelled',
    task: 0,
    total: 100,
    detail: INSTALL_CANCELLED_MESSAGE
  })
  return { success: true, canceled: true, cancelled: true }
})

trustedIpcHandle('export-instance-mrpack', async (_event, request: LaunchRequest) => {
  const instance = normalizeInstance(request)
  const defaultPath = path.join(app.getPath('downloads'), `${sanitizeFolderName(instance.name)}.mrpack`)
  const options: SaveDialogOptions = {
    title: 'Export instance as .mrpack',
    defaultPath,
    filters: [
      { name: 'Modrinth modpack (.mrpack)', extensions: ['mrpack'] }
    ]
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  return exportInstanceMrpack(instance, result.filePath)
})

trustedIpcHandle('delete-instance', async (_event, request: LaunchRequest) => {
  const instance = normalizeInstance(request)

  if (runningGames.has(instance.id) || activeLaunches.has(instance.id)) {
    throw new Error('Stop Minecraft before deleting this instance.')
  }

  const { instanceRoot } = getInstancePaths(instance)
  assertInstancePathIsSafe(instanceRoot)

  if (fs.existsSync(instanceRoot)) {
    log.info(`Deleting instance folder: ${instanceRoot}`)
    await removeInstanceDirectoryWithRetry(instanceRoot)
  }

  return { success: true, deleted: !fs.existsSync(instanceRoot), instanceRoot }
})

const waitForChildProcessClose = (childProcess: any, timeoutMs: number) => {
  if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (closed: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      childProcess.removeListener?.('close', onClose)
      childProcess.removeListener?.('exit', onClose)
      resolve(closed)
    }
    const onClose = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    childProcess.once?.('close', onClose)
    childProcess.once?.('exit', onClose)
  })
}

const runWindowsTaskkill = (pid: number, force: boolean) => {
  return new Promise<void>((resolve) => {
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    const child = spawn('taskkill.exe', args, {
      windowsHide: true,
      stdio: 'ignore'
    })
    child.once('error', () => resolve())
    child.once('close', () => resolve())
  })
}

const requestMinecraftStop = async (game: RunningGame) => {
  if (game.stopRequestedAt) return
  game.stopRequestedAt = Date.now()
  const pid = Number(game.process?.pid || game.gamePid)

  if (process.platform === 'win32' && pid > 0) {
    await runWindowsTaskkill(pid, false)
  } else {
    try {
      game.process.kill('SIGTERM')
    } catch (err) {
      log.warn(`Failed to request Minecraft stop for ${game.instanceName}.`, err)
    }
  }

  const closedGracefully = await waitForChildProcessClose(game.process, 10_000)
  if (closedGracefully) return

  log.warn(`Minecraft did not close after the save window; forcing shutdown for ${game.instanceName}.`)
  if (process.platform === 'win32' && pid > 0) {
    await runWindowsTaskkill(pid, true)
  } else {
    try {
      game.process.kill('SIGKILL')
    } catch (err) {
      log.warn(`Failed to force Minecraft shutdown for ${game.instanceName}.`, err)
    }
  }
}

// Author/creator: nattapat2871 (https://nattapat2871.me)
async function stopAllMinecraftFromTray() {
  cleanupStaleLaunches()
  for (const launch of activeLaunches.values()) {
    launch.cancelled = true
    launch.abortController.abort()
    try {
      if (launch.childProcess && !launch.childProcess.killed) launch.childProcess.kill()
    } catch (err) {
      log.warn(`Could not stop the partial Minecraft launch for ${launch.instanceName || 'an instance'}.`, getCompactErrorLog(err))
    }
    sendProgress({
      type: 'launch-cancelled',
      task: 0,
      total: 100,
      detail: LAUNCH_CANCELLED_MESSAGE,
      instanceId: launch.instanceId || null
    })
  }

  const stopResults = await Promise.allSettled(
    [...runningGames.values()].map((game) => requestMinecraftStop(game))
  )
  const failedCount = stopResults.filter((result) => result.status === 'rejected').length
  if (failedCount > 0) log.warn(`Tray could not stop ${failedCount} Minecraft process${failedCount === 1 ? '' : 'es'}.`)
  configureDiscordForActiveGames()
  refreshTrayMenu()
}

trustedIpcHandle('stop-minecraft', async (_event, request: LaunchRequest = {}) => {
  cleanupStaleLaunches()
  const requestedInstanceId = request.instance
    ? normalizeInstance(request).id
    : String((request as any).instanceId || '')
  const launch = requestedInstanceId
    ? activeLaunches.get(requestedInstanceId)
    : [...activeLaunches.values()][0]

  if (launch) {
    launch.cancelled = true
    launch.abortController.abort()
    const launchInstance = launch.instanceId && launch.instanceName
      ? normalizeInstance({ instance: {
          id: launch.instanceId,
          name: launch.instanceName,
          version: 'unknown',
          loader: 'vanilla',
          loaderVersion: ''
        } })
      : undefined
    writeRunLog(launch.logStream, LAUNCH_CANCELLED_MESSAGE, launchInstance)

    try {
      if (launch.childProcess && !launch.childProcess.killed) {
        launch.childProcess.kill()
      }
    } catch (err) {
      log.warn('Failed to stop partially launched Minecraft process:', err)
    }

    log.info(`Cancelling Minecraft launch${launch.instanceName ? ` for ${launch.instanceName}` : ''}`)
    sendProgress({
      type: 'launch-cancelled',
      task: 0,
      total: 100,
      detail: LAUNCH_CANCELLED_MESSAGE,
      instanceId: launch.instanceId || null
    })
    configureDiscordForActiveGames()
    return { success: true, stopped: true, phase: 'launch' }
  }

  const runningGame = requestedInstanceId
    ? runningGames.get(requestedInstanceId)
    : getLatestRunningGame()
  if (!runningGame) return { success: true, stopped: false }

  log.info(`Stopping Minecraft process for ${runningGame.instanceName}`)
  requestMinecraftStop(runningGame).catch((err) => log.error('Failed to stop Minecraft process:', err))
  return { success: true, stopped: true, instanceId: runningGame.instanceId }
})

trustedIpcHandle('launch-minecraft', async (_event, request: LaunchRequest) => {
  if (startupUpdatePending || requiredLauncherUpdateVersion) {
    throw new Error('Please update NamLauncher to the latest version before launching Minecraft.')
  }
  cleanupStaleLaunches()
  if (launcherUpdateInstallInFlight) {
    throw new Error('Wait for the NamLauncher update installation to finish before launching Minecraft.')
  }
  const instance = normalizeInstance(request)
  const requestedAccount = readAccounts().find((account) => account.id === request.accountId)
  if (requestedAccount) activeErrorReportAccountId = requestedAccount.id
  if (activeInstanceServerMutations.has(instance.id)) {
    throw new Error('Wait for the current server-list update to finish before launching Minecraft.')
  }
  if (runningGames.has(instance.id)) {
    const game = runningGames.get(instance.id)
    sendGameState({
      status: 'running',
      instanceId: instance.id,
      instanceName: instance.name,
      startedAt: game?.startedAt
    })
    return { success: true, alreadyRunning: true, instanceId: instance.id }
  }
  if (activeLaunches.has(instance.id)) {
    sendGameState({
      status: 'launching',
      instanceId: instance.id,
      instanceName: instance.name
    })
    return { success: false, alreadyLaunching: true, instanceId: instance.id }
  }

  const launcher = new Client()
  const launchSessionState: LaunchSession = {
    id: crypto.randomUUID(),
    launcher,
    abortController: new AbortController(),
    cancelled: false,
    startedAt: Date.now(),
    lastProgressAt: Date.now(),
    instanceId: instance.id,
    instanceName: instance.name
  }
  let launchSession: LaunchSession | null = launchSessionState
  activeLaunches.set(instance.id, launchSessionState)
  refreshTrayMenu()
  const launchSessionId = launchSessionState.id
  let lastKnownError = ''
  // Some bootstrap failures never create latest.log or a Minecraft crash report.
  // Keep only a bounded, already-redacted tail belonging to this launch.
  let launchProcessOutputTail = ''
  const launchedInstanceId = instance.id
  const launchedInstanceName = instance.name
  let runLogStream: fs.WriteStream | null = null
  let runLogInstance: ReturnType<typeof normalizeInstance> | null = instance
  let pendingLaunchProgress: any = null
  let launchProgressTimer: ReturnType<typeof setTimeout> | null = null
  let lastLaunchProgressAt = 0
  let launchPlayerName = ''
  let launchAccountType: 'msa' | 'offline' | 'unknown' = 'unknown'
  let launchManagedComponentActive = false
  let launchLocalGameIssueSent = false
  let launchGameProcessStarted = false

  const isLaunchCancelled = () => {
    return launchSessionState.cancelled || launchSessionState.abortController.signal.aborted
  }

  const flushLaunchProgress = () => {
    if (launchProgressTimer) clearTimeout(launchProgressTimer)
    launchProgressTimer = null
    if (!pendingLaunchProgress || isLaunchCancelled()) return
    const progress = pendingLaunchProgress
    pendingLaunchProgress = null
    lastLaunchProgressAt = Date.now()
    sendProgress(progress)
  }

  const forwardLaunchProgress = (progress: any) => {
    if (isLaunchCancelled()) return
    launchSessionState.lastProgressAt = Date.now()
    pendingLaunchProgress = { ...progress, instanceId: launchedInstanceId }
    const isComplete = Number(progress?.total) > 0 && Number(progress?.task) >= Number(progress?.total)
    const elapsed = Date.now() - lastLaunchProgressAt
    if (isComplete || elapsed >= 100) {
      flushLaunchProgress()
      return
    }
    if (!launchProgressTimer) launchProgressTimer = setTimeout(flushLaunchProgress, Math.max(16, 100 - elapsed))
  }

  const assertLaunchActive = () => {
    if (isLaunchCancelled()) {
      throw new Error(LAUNCH_CANCELLED_MESSAGE)
    }
  }

  launcher.on('debug', (message) => {
    const text = compactMinecraftDebugMessage(message)
    writeRunLog(runLogStream, `[DEBUG] ${text}`, runLogInstance || undefined)
    if (/Error:|Exception|Failed to start due to|Couldn't start Minecraft due to/.test(text)) lastKnownError = text
  })

  launcher.on('data', (message) => {
    launchGameProcessStarted = true
    const serverEvent = parseMinecraftServerLogEvent(message)
    const text = redactSensitiveText(message)
    launchProcessOutputTail = `${launchProcessOutputTail}${text}`.slice(-64 * 1024)
    writeRunLog(runLogStream, text, runLogInstance || undefined)
    if (isLaunchCancelled()) return
    const detectedLanPort = detectLanPortFromLogLine(text)
    if (detectedLanPort) {
      const activeGame = runningGames.get(launchedInstanceId)
      if (activeGame && shouldPublishLanSessionPort(activeGame.lanPort, detectedLanPort)) {
        activeGame.lanPort = detectedLanPort
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('lan-session-detected', {
            instanceId: activeGame.instanceId,
            port: detectedLanPort
          })
        }
        log.info('Minecraft LAN session detected.')
        refreshTrayMenu()
      }
    }
    if (text.includes('Error:') || text.includes('Exception')) lastKnownError = text.split('\n')[0]
    if (text.includes('Connecting to')) {
      sendProgress({ type: 'server-connect', task: 0, total: 100, instanceId: launchedInstanceId })
    }
    if (serverEvent) {
      const activeGame = runningGames.get(launchedInstanceId)
      if (activeGame) {
        const nextServer = serverEvent.type === 'connected'
          ? createMinecraftServerTelemetryState(serverEvent.endpoint, activeGame.knownServers)
          : null
        if (nextServer?.key !== activeGame.currentServer?.key) {
          activeGame.currentServer = nextServer
          void queueGameSessionEvent(activeGame, 'heartbeat')
          sendGameState({
            status: 'running',
            instanceId: activeGame.instanceId,
            instanceName: activeGame.instanceName,
            startedAt: activeGame.startedAt,
            server: nextServer ? { label: nextServer.label, kind: nextServer.kind } : null
          })
          log.info(nextServer
            ? `Minecraft joined server telemetry label: ${nextServer.label}`
            : 'Minecraft left the active multiplayer server.')
          refreshTrayMenu()
        }
      }
    }
    if (text.includes('Failed to retrieve profile key pair') || text.includes('Status: 401')) {
      sendProgress({
        type: 'multiplayer-auth-warning',
        task: 0,
        total: 100,
        detail: 'Microsoft session may be expired, or offline profile is joining an online-mode server.',
        instanceId: launchedInstanceId
      })
    }
  })

  launcher.on('progress', (progress) => {
    forwardLaunchProgress(progress)
  })

  launcher.on('close', (code) => {
    flushLaunchProgress()
    const normalizedCode = typeof code === 'number' && code > 0x7fffffff
      ? code - 0x100000000
      : code
    log.info(`[MC-CLOSE] Game closed with code ${normalizedCode}`)
    const closedGame = runningGames.get(launchedInstanceId)
    const wasCancelledLaunch = isLaunchCancelled()
    if (wasCancelledLaunch && !closedGame) {
      log.info('[MC-CLOSE] Ignoring close event from cancelled launch.')
      return
    }
    const durationMs = closedGame?.startedAt ? Date.now() - closedGame.startedAt : 0
    const closedInstanceId = closedGame?.instanceId || launchedInstanceId
    const closedInstanceName = closedGame?.instanceName || launchedInstanceName
    const closedLogStream = closedGame?.logStream || runLogStream
    const wasUserStopRequested = Boolean(closedGame?.stopRequestedAt || wasCancelledLaunch)
    if (closedGame?.telemetryActive) {
      void queueGameSessionEvent(closedGame, 'end', {
        endReason: getGameSessionEndReason(wasUserStopRequested),
        exitCode: normalizedCode
      })
    }
    if (closedGame?.badgePresenceActive) {
      void queuePlayerBadgePresence(closedGame, 'end')
    }
    runningGames.delete(closedInstanceId)
    activeLaunches.delete(closedInstanceId)
    configureDiscordForActiveGames()
    sendOnlineHeartbeat().catch(() => undefined)
    sendGameState({
      status: 'stopped',
      instanceId: closedInstanceId,
      instanceName: closedInstanceName,
      durationMs,
      code: normalizedCode,
      cancelled: wasCancelledLaunch || undefined
    })
    if (normalizedCode !== 0 && !wasUserStopRequested) {
      let error = lastKnownError || `Minecraft exited with code ${normalizedCode}`
      if (launchProcessOutputTail) {
        error += `\n\n===== Current launch stdout/stderr =====\n${truncateRemoteText(buildDiagnosticExcerpt(launchProcessOutputTail, 12, 80), 12000)}`
      }
      let combinedLogPath: string | null = null
      try {
        if (runLogInstance && launchGameProcessStarted) {
          const combined = buildInstanceCrashLog(runLogInstance, launchSessionState.startedAt)
          combinedLogPath = combined.path
          error = `${error}\n\nCombined log file: ${combined.path}\n\n${combined.diagnosticExcerpt}`
        }
      } catch (err) {
        log.warn('Could not build combined instance crash log.', err)
      }
      const diagnosis = getMinecraftCrashDiagnosis(error)
      const failure = classifyMinecraftProcessFailure(error, diagnosis, {
        managedComponentActive: launchManagedComponentActive,
        managedJavaRuntimeActive: true
      })
      mainWindow?.webContents.send('launch-error', error)
      if (failure.reportPolicy === 'automatic') {
        const reportTitle = failure.code === 'namlauncher-runtime-failure'
          ? 'NamLauncher selected an incompatible Java runtime'
          : 'NamLauncher game component failed'
        publishLauncherError(error, 'minecraft-exit', reportTitle, {
          playerName: closedGame?.playerName || null,
          accountType: closedGame?.accountType || null,
          diagnosis,
          failureClassification: failure
        }).catch(() => undefined)
      } else if (isLocalMinecraftLaunchFailure(failure, launchLocalGameIssueSent, launchGameProcessStarted)) {
        if (!launchLocalGameIssueSent) {
          sendMinecraftGameIssue({
            id: crypto.randomUUID(),
            instanceId: closedInstanceId,
            instanceName: closedInstanceName,
            exitCode: typeof normalizedCode === 'number' ? normalizedCode : null,
            occurredAt: new Date().toISOString(),
            logPath: combinedLogPath,
            logs: truncateRemoteText(error, 20000),
            classification: failure,
            diagnosis
          })
          launchLocalGameIssueSent = true
        }
        log.warn(`[MC-ISSUE] Kept ${failure.category}/${failure.code} local; no launcher error report was submitted.`)
      } else if (!isExpectedLaunchUserFacingError(error)) {
        publishLauncherError(error, 'launch-minecraft', 'Minecraft could not be launched', {
          playerName: launchPlayerName || null,
          accountType: launchAccountType
        }).catch(() => undefined)
      }
      log.warn(`Minecraft process exited with code ${normalizedCode}. See instance latest.log for game output.`)
    }
    closeRunLog(closedLogStream, `Minecraft closed with code ${normalizedCode}`, runLogInstance || undefined)
    tray?.setToolTip(hasActiveMinecraft()
      ? `NamLauncher\n${getActiveMinecraftCount()} Minecraft instance${getActiveMinecraftCount() === 1 ? '' : 's'} active`
      : `NamLauncher\nVersion ${app.getVersion()}`)
    refreshTrayMenu()
    if (!hasActiveMinecraft()) restoreLauncherAfterGame()
  })

  launcher.on('error', (error) => {
    if (isLaunchCancelled()) return
    const text = truncateRemoteText(redactSensitiveText(error instanceof Error ? error.stack || error.message : error), 20000)
    writeRunLog(runLogStream, `[ERROR] ${text}`, runLogInstance || undefined)
    mainWindow?.webContents.send('launch-error', text)
    const diagnosis = getMinecraftCrashDiagnosis(text)
    const failure = classifyMinecraftProcessFailure(text, diagnosis, {
      managedComponentActive: launchManagedComponentActive,
      managedJavaRuntimeActive: true
    })
    const expectedUserFacingError = isExpectedLaunchUserFacingError(text)
    if (!expectedUserFacingError && failure.reportPolicy === 'automatic') {
      const reportTitle = failure.code === 'namlauncher-runtime-failure'
        ? 'NamLauncher selected an incompatible Java runtime'
        : 'NamLauncher game component failed'
      publishLauncherError(text, 'minecraft-launcher-core', reportTitle, {
        playerName: launchPlayerName || null,
        accountType: launchAccountType,
        diagnosis,
        failureClassification: failure
      }).catch(() => undefined)
    } else if (!expectedUserFacingError && isLocalMinecraftLaunchFailure(failure, launchLocalGameIssueSent, launchGameProcessStarted)) {
      if (!launchLocalGameIssueSent) {
        sendMinecraftGameIssue({
          id: crypto.randomUUID(),
          instanceId: launchedInstanceId,
          instanceName: launchedInstanceName,
          exitCode: null,
          occurredAt: new Date().toISOString(),
          logPath: null,
          logs: text,
          classification: failure,
          diagnosis
        })
        launchLocalGameIssueSent = true
      }
      log.warn(`[MC-ISSUE] Kept ${failure.category}/${failure.code} local from launcher error event; no launcher report was submitted.`)
    } else if (!expectedUserFacingError) {
      publishLauncherError(text, 'launch-minecraft', 'Minecraft could not be launched', {
        playerName: launchPlayerName || null,
        accountType: launchAccountType
      }).catch(() => undefined)
    }
  })

  try {
    assertLaunchActive()
    let authorization = await resolveAccountForLaunch(request)
    const offlineSkinLaunch = await prepareOfflineSkinLaunch(authorization, request.accountId)
    authorization = offlineSkinLaunch.authorization
    launchPlayerName = String(authorization?.name || '')
    assertLaunchActive()
    sendGameState({
      status: 'launching',
      instanceId: instance.id,
      instanceName: instance.name
    })
    const { instanceRoot, gameDirectory } = ensureInstanceRoot(instance)
    const settings = readLauncherSettings()
    const selectedAccountType = readAccounts().find((account) => account.id === request.accountId)?.type || 'unknown'
    launchAccountType = selectedAccountType
    const baseJavaArgs = getLaunchJavaArgs(settings, instance.version)
    const performancePolicy = resolvePerformancePolicy({
      totalMemoryGb: os.totalmem() / (1024 ** 3),
      requestedMemoryGb: request.memoryGb,
      automaticMemory: settings.automaticMemory,
      profile: settings.performanceProfile,
      minecraftVersion: instance.version,
      loader: instance.loader
    })

    ensureDir(instanceRoot)
    ensureDir(gameDirectory)
    try {
      provisionThaiResourcePack(instance)
    } catch (error) {
      log.warn(`Could not refresh the managed Thai font resource pack for ${instance.name}.`, getCompactErrorLog(error))
      try {
        disableManagedThaiResourcePacksInOptions(gameDirectory)
      } catch (disableError) {
        log.warn(`Could not disable the unusable managed Thai font resource pack for ${instance.name}.`, getCompactErrorLog(disableError))
      }
    }
    try {
      await provisionPartnerServers(instance)
    } catch (error) {
      log.warn(`Could not provision partner servers for ${instance.name}.`, getCompactErrorLog(error))
    }
    const quickPlayOption = await validateQuickPlayRequest(request, instance)
    if (request.quickPlay && !quickPlayOption) {
      log.info(`Minecraft ${instance.version} does not support this quick play target; opening the instance normally.`)
    }
    runLogStream = createInstanceRunLog(instance, instanceRoot)
    launchSessionState.logStream = runLogStream
    log.info(`Minecraft game log will be read from: ${path.join(gameDirectory, 'logs', 'latest.log')}`)

    sendProgress({ type: 'java-setup', task: 0, total: 100, instanceId: instance.id })
    let javaPath = await ensureJavaExists(userDataPath, instance.version, (progress, detail, phase) => {
      if (isLaunchCancelled()) return
      const type = phase === 'extract' || phase === 'finalize' || phase === 'cleanup'
        ? 'java-extract'
        : 'java-download'
      sendProgress({ type, task: progress, total: 100, detail, instanceId: instance.id })
    }, launchSessionState.abortController.signal)

    assertLaunchActive()
    const loader = await prepareLoader(instanceRoot, instance, javaPath, launchSessionState.abortController.signal)
    assertLaunchActive()
    try {
      const bridgeResult = provisionBrandingBridge({
        instanceRoot,
        gameDirectory,
        target: {
          loader: instance.loader,
          minecraftVersion: instance.version,
          fabricLoaderVersion: loader.resolvedLoaderVersion || instance.loaderVersion || ''
        },
        bundleRoots: [
          path.join(process.resourcesPath, 'game-bridge'),
          path.join(app.getAppPath(), 'build', 'game-bridge')
        ]
      })
      if (bridgeResult.status === 'unavailable') {
        throw new Error('The required NamLauncher game companion is unavailable or failed its integrity check.')
      } else if (bridgeResult.status === 'collision') {
        throw new Error(`A different file is blocking the required NamLauncher game companion: ${bridgeResult.filename}`)
      } else if (bridgeResult.status === 'installed' || bridgeResult.status === 'removed') {
        log.info(`NamLauncher branding bridge ${bridgeResult.status} for the selected instance.`)
      }
      if (bridgeResult.supportStatus === 'legacy-frozen'
        && !notifiedLegacyCompanionVersions.has(instance.version)) {
        notifiedLegacyCompanionVersions.add(instance.version)
        log.info(`Minecraft ${instance.version} uses the frozen legacy NamLauncher game companion.`)
        const notice = {
          type: 'info' as const,
          title: 'ส่วนเสริม NamLauncher รุ่นเก่า',
          message: `Minecraft ${instance.version} จะใช้ส่วนเสริม NamLauncher รุ่นเดิม`,
          detail: 'ตั้งแต่ NamLauncher 1.1.17 เป็นต้นไป ตัวเสริมในเกมจะได้รับฟีเจอร์ใหม่เฉพาะ Minecraft 1.21.11 และ 26.2 รุ่นเก่ายังคงเปิดเล่นได้ตามปกติ แต่จะไม่ได้รับการอัปเดตตัวเสริมใหม่',
          buttons: ['เข้าใจแล้ว'],
          defaultId: 0,
          noLink: true
        }
        if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, notice)
        else await dialog.showMessageBox(notice)
      }
      launchManagedComponentActive = bridgeResult.status === 'installed' || bridgeResult.status === 'current'
    } catch (error) {
      log.error('Could not restore the required NamLauncher game companion before launch.', getCompactErrorLog(error))
      throw new Error(
        'NamLauncher could not restore its required system mod. Repair or reinstall NamLauncher, then start the game again.'
      )
    }
    try {
      writePlayerBadgeConfig({
        gameDirectory,
        enabled: settings.playerBadgeEnabled,
        playerUuid: authorization?.uuid,
        lookupEndpoint: `${STATS_API_BASE}/api/player-badges/lookup`
      })
    } catch (error) {
      log.warn('Could not safely prepare the optional NamLauncher player badge configuration; continuing without badges.', getCompactErrorLog(error))
    }
    assertLaunchActive()
    const setupJavaPath = javaPath
    javaPath = getMinecraftLaunchJavaPath(javaPath)
    const requestedLoaderArgs = Array.isArray((loader as any).javaArgs) ? (loader as any).javaArgs : []
    const loaderArgumentPolicy = applyCustomJavaArgumentPolicy(requestedLoaderArgs, process.platform)
    const loaderJavaArgs = loaderArgumentPolicy.javaArgs
    if (loaderArgumentPolicy.removedArguments.length > 0) {
      log.warn(
        'Ignored instance Java arguments that could override the launcher memory budget or force non-adaptive client memory behavior: '
        + loaderArgumentPolicy.removedArguments.join(', ')
      )
    }
    const performanceJavaArgs = settings.customJavaArgsEnabled
      ? []
      : performancePolicy.javaArgs
    const javaArgs = [
      ...baseJavaArgs,
      ...performanceJavaArgs,
      ...loaderJavaArgs,
      ...offlineSkinLaunch.javaArgs
    ]
    const launchVersion: { number: string; type: string; custom?: string } = {
      number: instance.version,
      type: 'release'
    }

    if (loader.customVersionId) {
      launchVersion.custom = loader.customVersionId
    }

    const launchOptions: any = {
      clientPackage: null,
      authorization,
      root: instanceRoot,
      javaPath,
      version: launchVersion,
      memory: {
        max: performancePolicy.memoryMax,
        min: performancePolicy.memoryMin
      },
      forge: loader.forgePath || null,
      customArgs: javaArgs,
      ...(quickPlayOption ? { quickPlay: quickPlayOption } : {}),
      overrides: {
        gameDirectory,
        cwd: gameDirectory,
        detached: true,
        url: {
          mavenForge: `${FORGE_MAVEN_BASE}/`
        }
      }
    }

    log.info(
      `Launching Minecraft ${instance.version} ${instance.loader} ${loader.resolvedLoaderVersion || ''} at ${instanceRoot} using Java: ${javaPath}`
    )
    log.info(
      `Performance profile ${performancePolicy.profile}: ${performancePolicy.memoryGb}G play-session budget, `
      + `${performancePolicy.memoryMin}-${performancePolicy.memoryMax} heap, `
      + `${performancePolicy.nativeMemoryReserveMb}M native reserve, ${performancePolicy.launcherMemoryReserveMb}M launcher reserve `
      + `(recommended ${performancePolicy.recommendedMemoryGb}G, safe max ${performancePolicy.safeMaximumGb}G).`
    )
    if (settings.customJavaArgsEnabled && performancePolicy.javaArgs.length > 0) {
      log.info('Custom Java arguments are enabled; automatic profile JVM flags were skipped to avoid conflicting collectors or duplicate options.')
    }
    log.info('Playing game: Minecraft')
    log.info(`Executable: ${javaPath}`)
    writeRunLog(runLogStream, `Java: ${javaPath}`, instance)
    if (setupJavaPath !== javaPath) {
      writeRunLog(runLogStream, `Java setup executable: ${setupJavaPath}`, instance)
    }
    writeRunLog(
      runLogStream,
      `Java arguments prepared: ${javaArgs.length} (${settings.customJavaArgsEnabled ? 'includes custom arguments; values omitted' : 'managed launcher profile'})`,
      instance
    )

    assertLaunchActive()
    const childProcess = await launcher.launch(launchOptions)
    if (!childProcess) {
      assertLaunchActive()
      throw new Error(lastKnownError || 'Minecraft launch returned no process. Check the instance latest.log for details.')
    }
    releaseChildProcessFromLauncher(childProcess)
    launchSessionState.childProcess = childProcess
    launchGameProcessStarted = Boolean(childProcess.pid)
    if (isLaunchCancelled()) {
      try {
        childProcess.kill()
      } catch (err) {
        log.warn('Failed to kill cancelled Minecraft process:', err)
      }
      throw new Error(LAUNCH_CANCELLED_MESSAGE)
    }

    const knownServers = PARTNER_SERVERS.map((server) => ({
      canonicalKey: normalizeMinecraftServerEndpoint(server.address).canonicalKey,
      name: server.name
    }))
    const playerTextureId = getDiscordPlayerTextureIdForLaunch(request.accountId)
    const runningGame: RunningGame = {
      process: childProcess,
      instanceId: instance.id,
      instanceName: instance.name,
      minecraftVersion: instance.version,
      playerName: String(authorization?.name || 'Minecraft Player'),
      playerUuid: String(authorization?.uuid || ''),
      gameDirectory,
      playerTextureId,
      gamePid: Number(childProcess.pid) || process.pid,
      startedAt: Date.now(),
      loader: instance.loader,
      accountType: selectedAccountType,
      telemetrySessionId: crypto.randomUUID(),
      telemetryActive: false,
      telemetryStartAcknowledged: false,
      currentServer: null,
      knownServers,
      badgePresenceId: crypto.randomUUID(),
      badgePresenceActive: false,
      badgePresenceStartAcknowledged: false,
      logStream: runLogStream
    }
    runningGames.set(instance.id, runningGame)
    void readMinecraftServersDat(path.join(gameDirectory, 'servers.dat'))
      .then(({ servers }) => {
        runningGame.knownServers = servers.map((server) => ({
          canonicalKey: server.canonicalKey,
          name: server.name
        }))
      })
      .catch(() => undefined)
    void startGameSessionTelemetry(runningGame, settings)
    void startPlayerBadgePresence(runningGame, settings)
    void reportRestrictedModSignals(runningGame, settings)
    refreshTrayMenu()
    if (activeLaunches.get(instance.id)?.id === launchSessionId) activeLaunches.delete(instance.id)
    launchSession = null

    configureDiscordForActiveGames(settings)
    if (launcherRestingInTray) {
      log.info('NamLauncher Discord RPC remains paused in the system tray while Minecraft runs.')
    } else if (settings.discordRpcEnabled) {
      log.info(`NamLauncher custom Discord RPC active with application id ${MINECRAFT_OFFICIAL_APPLICATION_ID} for pid ${runningGame.gamePid}`)
    } else {
      log.info(`NamLauncher Discord RPC disabled; using native Minecraft detection with application id ${MINECRAFT_OFFICIAL_APPLICATION_ID} for pid ${runningGame.gamePid}`)
    }
    sendOnlineHeartbeat().catch(() => undefined)

    sendGameState({
      status: 'running',
      instanceId: instance.id,
      instanceName: instance.name,
      startedAt: runningGame.startedAt
    })
    minimizeLauncherForGame(settings)

    return {
      success: true,
      instanceRoot,
      gameDirectory,
      javaPath,
      loaderVersion: loader.resolvedLoaderVersion || instance.loaderVersion
    }
  } catch (err) {
    const text = truncateRemoteText(redactSensitiveText(err instanceof Error ? err.stack || err.message : err), 20000)
    if (text.includes(LAUNCH_CANCELLED_MESSAGE)) {
      log.info(`Launch process cancelled${launchedInstanceName ? ` for ${launchedInstanceName}` : ''}.`)
      closeRunLog(runLogStream, LAUNCH_CANCELLED_MESSAGE, runLogInstance || undefined)
      runLogStream = null
      if (activeLaunches.get(launchedInstanceId)?.id === launchSessionId) {
        activeLaunches.delete(launchedInstanceId)
      }
      sendGameState({
        status: 'stopped',
        instanceId: launchedInstanceId || null,
        instanceName: launchedInstanceName || null,
        cancelled: true
      })
      return { success: false, cancelled: true }
    }

    closeRunLog(runLogStream, `Launch failed: ${text}`, runLogInstance || undefined)
    const diagnosis = getMinecraftCrashDiagnosis(text)
    const failure = classifyMinecraftProcessFailure(text, diagnosis, {
      managedComponentActive: launchManagedComponentActive,
      managedJavaRuntimeActive: true
    })
    // This catch also covers our post-spawn setup. A running game alone does
    // not turn an exception in launcher code into a local Minecraft issue.
    if (isLocalMinecraftLaunchFailure(failure, launchLocalGameIssueSent)) {
      if (!launchLocalGameIssueSent) {
        sendMinecraftGameIssue({
          id: crypto.randomUUID(),
          instanceId: launchedInstanceId,
          instanceName: launchedInstanceName,
          exitCode: null,
          occurredAt: new Date().toISOString(),
          logPath: null,
          logs: text,
          classification: failure,
          diagnosis
        })
        launchLocalGameIssueSent = true
      }
      log.warn(`[MC-ISSUE] Kept ${failure.category}/${failure.code} local from launch rejection; no launcher report was submitted.`)
    } else if (!isExpectedLaunchUserFacingError(text)) {
      log.error('Launch process failed:', text)
      publishLauncherError(text, 'launch-minecraft', 'Minecraft could not be launched', {
        playerName: launchPlayerName || null,
        accountType: launchAccountType,
        diagnosis,
        failureClassification: failure.reportPolicy === 'automatic' ? failure : undefined
      }).catch(() => undefined)
    } else {
      log.info('Minecraft launch was stopped by an expected user-facing condition.')
    }
    if (activeLaunches.get(launchedInstanceId)?.id === launchSessionId) {
      activeLaunches.delete(launchedInstanceId)
    }
    sendGameState({
      status: 'stopped',
      instanceId: launchedInstanceId,
      instanceName: launchedInstanceName,
      failed: true
    })
    throw err
  } finally {
    if (launchProgressTimer) clearTimeout(launchProgressTimer)
    launchProgressTimer = null
    pendingLaunchProgress = null
    if (activeLaunches.get(launchedInstanceId)?.id === launchSessionId) {
      activeLaunches.delete(launchedInstanceId)
    }
    refreshTrayMenu()
  }
})

trustedIpcHandle('login-microsoft', async () => {
  try {
    log.info('Starting Microsoft login...')
    const result = await msmc.fastLaunch(
      'electron',
      (update) => {
        log.info(`[MSMC-UPDATE] ${update.type}: ${redactSensitiveText(update.data || '')}`)
      },
      'select_account',
      {
        width: 520,
        height: 680,
        resizable: false,
        parent: mainWindow || undefined,
        modal: Boolean(mainWindow),
        title: 'Microsoft Login'
      }
    )

    if (msmc.errorCheck(result)) {
      throw new Error(getMicrosoftLoginFailureMessage(result))
    }

    const auth = msmc.getMCLC().getAuth(result)
    if (!getMicrosoftRefreshToken(auth)) {
      throw new Error('Microsoft login did not return a refresh token. Please try signing in again.')
    }
    const account = upsertAccount(auth, 'msa')
    log.info(`Microsoft login successful for user: ${account.name}`)
    return account
  } catch (err) {
    const detail = redactSensitiveText(err instanceof Error ? err.stack || err.message : err)
    log.error('Microsoft login failed:', detail)
    throw err
  }
})

trustedIpcHandle('login-offline', async (_event, username: string) => {
  const cleanName = String(username || '').trim()
  if (!isValidOfflineUsername(cleanName)) {
    throw new Error(OFFLINE_USERNAME_ERROR_MESSAGE)
  }

  log.info(`Offline login request for user: ${cleanName}`)
  const auth = createOfflineAuth(cleanName)
  return upsertAccount(auth, 'offline')
})

ipcMain.on('window-control', (_event, action) => {
  if (action === 'minimize') minimizeLauncherToTaskbar()
  if (action === 'maximize') {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  }
  if (action === 'quit') requestAppQuit()
  if (action === 'close') closeLauncherWindow()
})

ipcMain.on('open-logs', () => {
  shell.showItemInFolder(logPath)
})

ipcMain.on('open-external', (_event, url: string) => {
  openExternalUrl(url).catch(() => undefined)
})

ipcMain.on('launcher-error-observed', (_event, payload: { context?: unknown; message?: unknown; stack?: unknown }) => {
  const context = String(payload?.context || 'renderer').slice(0, 120)
  const error = String(payload?.stack || payload?.message || 'Unknown renderer error').slice(0, 100_000)
  if (isExpectedLaunchUserFacingError(error)) return
  if (context === 'ipc:launch-minecraft') {
    log.warn('[LAUNCHER-ERROR] Refused duplicate renderer report for a centrally handled Minecraft launch failure.')
    return
  }
  publishLauncherError(error, context).catch(() => undefined)
})

trustedIpcHandle('copy-error-report', async (_event, report: unknown) => {
  const rawReport = String(report || '')
  if (Buffer.byteLength(rawReport, 'utf8') > 10 * 1024 * 1024) {
    throw new Error('The error report is too large to copy safely.')
  }
  const safeReport = sanitizeBugReport(rawReport)
  if (!safeReport.trim()) throw new Error('There is no error report to copy.')
  clipboard.writeText(safeReport)
  return { success: true }
})

trustedIpcHandle('submit-error-report', async (_event, request: LauncherErrorSubmitRequest = {}) => {
  return confirmLauncherErrorReport(request || {})
})
