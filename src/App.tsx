// Author/creator: nattapat2871 (https://nattapat2871.me)
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { LibrarySourceSelect } from './components/LibrarySourceSelect'
import { InstanceSelect } from './components/InstanceSelect'
import {
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  FolderOpen,
  HardDrive,
  Home,
  ImageIcon,
  Info,
  Languages,
  LayoutGrid,
  Library,
  Loader2,
  LogOut,
  MessageCircle,
  Minus,
  MonitorDown,
  MoreVertical,
  Package,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Shirt,
  Square,
  Trash2,
  AlertTriangle,
  Upload,
  User,
  Users,
  WifiOff,
  Wrench,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { AnimatePresence, m as motion, useReducedMotion } from 'framer-motion'
import { getAllVersions, getLatestVersion } from './lib/mojang'
import type { SkinLibraryData } from './components/SkinPage'
import type {
  InstancePlaceQuickPlay,
  InstancePlacesApi,
  MinecraftServerPlace
} from './components/WorldsServersPanel'
import { MinecraftServerMotd, type MinecraftServerPing } from './components/MinecraftServerMotd'
import LibraryPagination from './components/LibraryPagination'
import ModpackInstallActivityCard, {
  type ModpackInstallActivity
} from './components/ModpackInstallActivityCard'
import LoaderIcon from './components/LoaderIcon'
import { clampLibraryPage, getLibraryTotalPages } from './libraryPagination'
import { filterInstanceContent } from './instanceContentSearch'
import {
  getInstanceDetailNavigation,
  getInstanceModsLibraryNavigation,
  resolveSelectedInstanceId
} from './instanceSelection'
import { uiText, type LauncherLanguage } from './appText'
import { storage } from './storageKeys'
import { resolveHomeModpackArtwork } from './homeModpackArtwork'
import { PARTNER_SERVERS, type PartnerServerDefinition } from '../shared/partnerServers'
import type { MinecraftCrashDiagnosis } from '../shared/minecraftCrashDiagnosis'
import type { MinecraftGameIssue } from '../shared/minecraftFailureClassification'
import type {
  LauncherUpdateBlockReason,
  LauncherUpdateInstallResult
} from '../shared/launcherUpdate'
import { classifyLauncherUpdateFailureMessage } from '../shared/launcherUpdate'
import type { StartupUpdateResult } from '../shared/startupUpdate'
import {
  OFFLINE_USERNAME_HTML_PATTERN,
  OFFLINE_USERNAME_MAX_LENGTH,
  OFFLINE_USERNAME_MIN_LENGTH,
  isValidOfflineUsername,
  sanitizeOfflineUsernameInput
} from '../shared/offlineUsername'
import {
  DEFAULT_LIBRARY_SEARCH_FILTERS,
  LIBRARY_LOADERS,
  LIBRARY_SEARCH_QUERY_MAX_LENGTH,
  countActiveLibraryFilters,
  isLibraryInstanceCompatibilityAvailable,
  isLibraryLoaderFilterAvailable,
  normalizeLibrarySearchQuery,
  normalizeLibraryTotalHits,
  resolveLibrarySearchFilters,
  type LibraryEnvironment,
  type LibraryProjectType,
  type LibrarySearchFilters,
  type LibrarySort
} from '../shared/librarySearchFilters'

const loadSkinPageModule = () => import('./components/SkinPage')
const SkinPage = lazy(loadSkinPageModule)
const loadWorldsServersPanelModule = () => import('./components/WorldsServersPanel')
const WorldsServersPanel = lazy(loadWorldsServersPanelModule)

type Account = {
  id: string
  uuid: string
  name: string
  type: 'msa' | 'offline'
  createdAt: string
  updatedAt: string
}

type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'quilt' | 'neoforge'
type InstanceContentKind = 'mods' | 'resourcepacks' | 'shaderpacks' | 'screenshots'
type LibrarySource = 'modrinth' | 'curseforge'
type CurseForgeManualProjectType = 'mod' | 'resourcepack' | 'shader'
type InstanceSettingsTab = 'general' | 'installation'
type PerformanceProfile = 'automatic' | 'low-spec' | 'balanced' | 'max-fps'
type RunningServerInfo = { label: string; kind: 'domain' | 'private_ip' | 'public_ip' | 'local' }

type Instance = {
  id: string
  name: string
  version: string
  loader: LoaderType
  loaderVersion: string
  createdAt: string
  iconUrl?: string | null
  playtimeSeconds?: number
  lastPlayedAt?: string
}

type InstanceContentItem = {
  id: string
  kind: InstanceContentKind
  name: string
  fileName: string
  enabledFileName: string
  filePath: string
  enabled: boolean
  size: number
  updatedAt: string
  iconUrl?: string | null
  projectId?: string | null
  versionNumber?: string | null
  source: 'modrinth' | 'curseforge' | 'local'
}

type InstanceContentCache = Record<string, Partial<Record<InstanceContentKind, InstanceContentItem[]>>>

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
  language: LauncherLanguage
}

const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  discordRpcEnabled: true,
  anonymousStatsEnabled: true,
  gameplayTelemetryEnabled: true,
  playerBadgeEnabled: true,
  restrictedModAuditEnabled: true,
  customJavaArgsEnabled: false,
  customJavaArgs: '',
  autoMinimizeOnLaunch: false,
  closeToTrayEnabled: true,
  automaticMemory: false,
  performanceProfile: 'automatic',
  language: 'th'
}

type DiscordStatus = {
  enabled: boolean
  state: 'disabled' | 'suspended' | 'connecting' | 'connected' | 'error' | 'native'
  connected: boolean
  lastActivity?: string | null
  lastActivityAt?: string | null
  applicationId?: string | null
  lastError?: string | null
  reconnectAttempts?: number
}

type LauncherDiscordAccountState = {
  connected: boolean
  persistent: boolean
  offline?: boolean
  profile: null | {
    id: string
    username: string
    displayName: string
    avatarUrl: string
    expiresAt?: string | null
  }
}

type ContentStatus = {
  state: 'install' | 'installed' | 'update' | 'unavailable' | 'unsupported'
  reason?: string
  installedVersion?: string | null
  installedVersionId?: string | null
  latestVersion?: string | null
  latestVersionId?: string | null
}

type ContentUpdateItem = {
  projectId: string
  title: string
  projectType: 'mod' | 'resourcepack' | 'shader'
  iconUrl?: string | null
  installedVersion: string
  installedVersionId: string
  latestVersion: string
  latestVersionId: string
  provider?: 'modrinth' | 'curseforge'
}

type InstanceUpdateSummary = {
  updates: ContentUpdateItem[]
  checkedAt: string
}

type GameLogEntry = {
  line: string
  at?: string
  instanceId?: string | null
  instanceName?: string | null
}

type GameLogResult = {
  content: string
  path: string
  exists: boolean
  truncated?: boolean
}

type ModrinthVersionOption = {
  id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  date_published?: string | null
}

type LauncherUpdateInfo = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  channel: string
  downloadUrl: string
  installerSha256?: string | null
  mandatory?: boolean
  notes?: string[]
  error?: string
}

type LauncherUpdateProgress = {
  state: 'checking' | 'downloading' | 'opening-installer' | 'installer-opened' | 'blocked' | 'failed'
  percent?: number
  detail?: string
}

// Font Awesome Free Brands: Discord (CC BY 4.0, https://fontawesome.com/license/free).
const DiscordLogo = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 576 512"
    aria-hidden="true"
    focusable="false"
    className={className}
    fill="currentColor"
  >
    <path d="M492.5 69.8c-.2-.3-.4-.6-.8-.7-38.1-17.5-78.4-30-119.7-37.1-.4-.1-.8 0-1.1 .1s-.6 .4-.8 .8c-5.5 9.9-10.5 20.2-14.9 30.6-44.6-6.8-89.9-6.8-134.4 0-4.5-10.5-9.5-20.7-15.1-30.6-.2-.3-.5-.6-.8-.8s-.7-.2-1.1-.2c-41.3 7.1-81.6 19.6-119.7 37.1-.3 .1-.6 .4-.8 .7-76.2 113.8-97.1 224.9-86.9 334.5 0 .3 .1 .5 .2 .8s.3 .4 .5 .6c44.4 32.9 94 58 146.8 74.2 .4 .1 .8 .1 1.1 0s.7-.4 .9-.7c11.3-15.4 21.4-31.8 30-48.8 .1-.2 .2-.5 .2-.8s0-.5-.1-.8-.2-.5-.4-.6-.4-.3-.7-.4c-15.8-6.1-31.2-13.4-45.9-21.9-.3-.2-.5-.4-.7-.6s-.3-.6-.3-.9 0-.6 .2-.9 .3-.5 .6-.7c3.1-2.3 6.2-4.7 9.1-7.1 .3-.2 .6-.4 .9-.4s.7 0 1 .1c96.2 43.9 200.4 43.9 295.5 0 .3-.1 .7-.2 1-.2s.7 .2 .9 .4c2.9 2.4 6 4.9 9.1 7.2 .2 .2 .4 .4 .6 .7s.2 .6 .2 .9-.1 .6-.3 .9-.4 .5-.6 .6c-14.7 8.6-30 15.9-45.9 21.8-.2 .1-.5 .2-.7 .4s-.3 .4-.4 .7-.1 .5-.1 .8 .1 .5 .2 .8c8.8 17 18.8 33.3 30 48.8 .2 .3 .6 .6 .9 .7s.8 .1 1.1 0c52.9-16.2 102.6-41.3 147.1-74.2 .2-.2 .4-.4 .5-.6s.2-.5 .2-.8c12.3-126.8-20.5-236.9-86.9-334.5zm-302 267.7c-29 0-52.8-26.6-52.8-59.2s23.4-59.2 52.8-59.2c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.4 59.2-52.8 59.2zm195.4 0c-29 0-52.8-26.6-52.8-59.2s23.4-59.2 52.8-59.2c29.7 0 53.3 26.8 52.8 59.2 0 32.7-23.2 59.2-52.8 59.2z" />
  </svg>
)

type LauncherStats = {
  downloads: number
  online_players: number
  heartbeat_window_seconds?: number
  download_url?: string | null
  launcher_version?: string | null
  error?: string
}

type LauncherErrorReport = {
  id: string
  title: string
  context: string
  message: string
  logs: string
  occurredAt: string
  launcherVersion?: string
  platform?: string
  arch?: string
  electronVersion?: string
  playerName?: string
  accountType?: string | null
  diagnosis?: MinecraftCrashDiagnosis | null
  system?: {
    os?: string | null
    cpu?: string | null
    cpu_cores?: number | null
    ram_gb?: number | null
    gpu?: string[]
    storage?: Array<{ model?: string | null; mediaType?: string | null; size?: string | null }>
    platform?: string | null
    arch?: string | null
  }
}

type LauncherDataLocation = {
  currentPath: string
  currentRoot?: string
  defaultPath: string
  packagedPath: string
  configuredPath?: string | null
  configPath?: string
  folderName?: string
  rootFolderName?: string
  launcherFolderName?: string
  nextRoot?: string
  nextPath?: string
  canceled?: boolean
  changed?: boolean
  restartRequired?: boolean
  copiedEntries?: string[]
  skippedEntries?: string[]
  failedEntries?: string[]
}

type DataLocationStatus = 'loading' | 'ready' | 'error'

type LegalSection = {
  title: string
  body: string
}

type LegalDocument = {
  version: string
  updatedAt: string
  language: LauncherLanguage
  title: string
  intro: string
  acceptance: string
  terms: LegalSection[]
  privacy: LegalSection[]
  references: Array<{ label: string; url: string }>
  source: 'remote' | 'bundled'
}

type SetupLogEntry = {
  id: string
  text: string
  progress: number
  at: string
}

type ModpackInstallResult = {
  success: boolean
  canceled?: boolean
  cancelled?: boolean
  instance?: Instance
  version?: string
  installedFiles?: number
  skippedFiles?: number
  overrideFiles?: number
  incompatibleOptionalFiles?: string[]
  blockedFiles?: string[]
  manualDownloads?: ManualCurseForgeDownloadItem[]
  manualDownloadDirectory?: string
}

type ManualCurseForgeDownloadItem = {
  id: string
  title: string
  filename: string
  displayName?: string
  projectId: number
  fileId: number
  projectType: CurseForgeManualProjectType
  websiteUrl: string
  fileUrl: string
  iconUrl?: string | null
  targetDirectory?: string
  hashes?: Record<string, string>
  fileLength?: number
}

type ConfirmDialogState = {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}

type AccountSessionExpiredNotice = {
  accountId?: string
  accountName: string
  message?: string
}

type AccountSessionExpiredPayload = AccountSessionExpiredNotice & {
  accounts?: Account[]
}

type RecentInstancePlace = {
  instanceId: string
  instanceName: string
  type: InstancePlaceQuickPlay['type']
  label: string
  address?: string
  folderName?: string
  playedAt: string
}

type HomeServerStatusEntry = Readonly<{
  phase: 'loading' | 'online' | 'offline'
  ping?: MinecraftServerPing
}>

type HomeServerStatusCacheEntry = Readonly<{
  status: HomeServerStatusEntry
  expiresAt: number
}>

const readRecentInstancePlaces = (): RecentInstancePlace[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storage.recentPlaces) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 12).flatMap((item): RecentInstancePlace[] => {
      if (!item || typeof item !== 'object') return []
      const instanceId = String(item.instanceId || '').trim().slice(0, 256)
      const instanceName = String(item.instanceName || '').trim().slice(0, 256)
      const type = item.type === 'server' || item.type === 'world' ? item.type : null
      const label = String(item.label || '').trim().slice(0, 256)
      const playedAt = String(item.playedAt || '')
      if (!instanceId || !type || !label || !Number.isFinite(new Date(playedAt).getTime())) return []
      if (type === 'server') {
        const address = String(item.address || '').trim().slice(0, 512)
        return address ? [{ instanceId, instanceName, type, label, address, playedAt }] : []
      }
      const folderName = String(item.folderName || '').trim().slice(0, 255)
      return folderName && !/[\\/]/.test(folderName)
        ? [{ instanceId, instanceName, type, label, folderName, playedAt }]
        : []
    })
  } catch {
    return []
  }
}

const INSTANCE_CONTENT_KINDS: InstanceContentKind[] = ['mods', 'resourcepacks', 'shaderpacks', 'screenshots']
const MINISAND_PARTNER_URL = 'https://minisand.online/'
const NAMLAUNCHER_DISCORD_URL = 'https://namlauncher.nattapat2871.me/discord'
const HOME_SERVER_STATUS_DELAY_MS = 220
const HOME_SERVER_STATUS_CACHE_TTL_MS = 60_000
const HOME_SERVER_STATUS_CACHE_LIMIT = 24
const HOME_SERVER_STATUS_MAX_RECENT = 4
const HOME_SERVER_STATUS_CONCURRENCY = 2
const SIDEBAR_MIN_WIDTH = 260
const SIDEBAR_DEFAULT_WIDTH = 300
const SIDEBAR_MAX_WIDTH = 380
const DATA_LOCATION_TIMEOUT_MS = 12_000

const getMinecraftVersionId = (version: any) => String(version?.id || version?.version || version || '').trim()

const uniqueStrings = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))

const normalizeHomeServerAddress = (address: string) => address.trim().toLocaleLowerCase('en-US')

const getHomeServerStatusKey = (instanceId: string, address: string) => (
  `${instanceId}:${normalizeHomeServerAddress(address)}`
)

const getRecentPlayablePlaces = (
  recentPlaces: readonly RecentInstancePlace[],
  instances: readonly Instance[]
) => recentPlaces.flatMap((place) => {
  const instance = instances.find((candidate) => candidate.id === place.instanceId)
  if (!instance) return []
  const quickPlay: InstancePlaceQuickPlay | null = place.type === 'server' && place.address
    ? { type: 'server', address: place.address }
    : place.type === 'world' && place.folderName
      ? { type: 'world', folderName: place.folderName }
      : null
  return quickPlay ? [{ place, instance, quickPlay }] : []
}).slice(0, HOME_SERVER_STATUS_MAX_RECENT)

type ScreenshotPan = {
  x: number
  y: number
}

type ScreenshotDragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
} | null

type ExportInstanceMrpackResult = {
  success: boolean
  canceled?: boolean
  filePath?: string
  modrinthFiles?: number
  overrideFiles?: number
  totalFiles?: number
}

declare global {
  interface Window {
    electron: {
      getAccounts: () => Promise<Account[]>
      setActiveAccountContext: (accountId: string | null) => Promise<{ activeAccountId: string | null }>
      removeAccount: (accountId: string) => Promise<Account[]>
      getSkinLibrary: (accountId: string) => Promise<SkinLibraryData>
      refreshSkinLibrary: (accountId: string) => Promise<SkinLibraryData>
      saveSkinPreset: (request: any) => Promise<SkinLibraryData>
      saveDefaultSkinPreset: (request: { accountId: string; defaultSkinId: string }) => Promise<SkinLibraryData>
      importSkinByName: (request: { accountId: string; playerName: string }) => Promise<SkinLibraryData>
      importOfflineSkinByName: (request: { accountId: string; playerName: string }) => Promise<SkinLibraryData>
      activateSkinPreset: (request: { accountId: string; skinId: string }) => Promise<SkinLibraryData>
      deleteSkinPreset: (request: { accountId: string; skinId: string }) => Promise<SkinLibraryData>
      resetActiveSkin: (request: { accountId: string }) => Promise<SkinLibraryData>
      getLoaderVersions: (loader: string, mcVersion: string) => Promise<Array<{ id: string; type: string }>>
      getLoaderCompatibility: (loader: string, mcVersion: string) => Promise<{
        supported: boolean
        requestedGameVersion: string
        recommendedGameVersion: string | null
      }>
      getGameState: () => Promise<any>
      hydrateInstances: (instances: Instance[]) => Promise<Instance[]>
      updateInstance: (request: { instance: Instance; updates: Partial<Instance> }) => Promise<Instance>
      provisionInstance: (instance: Instance) => Promise<{
        success: boolean
        resourcePack: { filename: string; enabled: boolean; sha256: string }
      }>
      cacheImageUrl: (url: string) => Promise<string>
      rendererReady: () => Promise<boolean>
      getInstanceUpdateSummary: (instance: Instance) => Promise<InstanceUpdateSummary>
      getLauncherVersion: () => Promise<string>
      checkLauncherUpdate: () => Promise<LauncherUpdateInfo>
      runStartupLauncherUpdate: () => Promise<StartupUpdateResult>
      installLauncherUpdate: () => Promise<LauncherUpdateInstallResult>
      getLauncherStats: () => Promise<LauncherStats>
      getLegalDocument: (language: LauncherLanguage) => Promise<LegalDocument>
      getLauncherDataLocation: () => Promise<LauncherDataLocation>
      chooseLauncherDataLocation: (options?: { initialSetup?: boolean; restartAfterMove?: boolean }) => Promise<LauncherDataLocation>
      getDiscordSettings: () => Promise<LauncherSettings>
      getDiscordStatus: () => Promise<DiscordStatus>
      setDiscordSettings: (settings: LauncherSettings) => Promise<LauncherSettings>
      getLauncherDiscordAccount: () => Promise<LauncherDiscordAccountState>
      connectLauncherDiscordAccount: () => Promise<LauncherDiscordAccountState>
      disconnectLauncherDiscordAccount: () => Promise<LauncherDiscordAccountState>
      getInstanceContent: (options: { instance: Instance; kind: InstanceContentKind }) => Promise<InstanceContentItem[]>
      getInstancePlaces: InstancePlacesApi['getInstancePlaces']
      getLanReadiness: InstancePlacesApi['getLanReadiness']
      discoverLanServers: InstancePlacesApi['discoverLanServers']
      onLanSessionDetected?: InstancePlacesApi['onLanSessionDetected']
      pingInstanceServers: InstancePlacesApi['pingInstanceServers']
      addInstanceServer: InstancePlacesApi['addInstanceServer']
      removeInstanceServer: InstancePlacesApi['removeInstanceServer']
      getInstanceRunLog: (instance: Instance) => Promise<GameLogResult>
      toggleInstanceContent: (options: { instance: Instance; kind: InstanceContentKind; fileName: string; contentId: string; enabled: boolean }) => Promise<any>
      deleteInstanceContent: (options: { instance: Instance; kind: InstanceContentKind; fileName: string; contentId: string }) => Promise<any>
      importInstanceContentFiles: (options: { instance: Instance; kind: InstanceContentKind; filePaths: string[] }) => Promise<{
        success: boolean
        kind: InstanceContentKind
        imported: Array<{ sourcePath: string; filePath: string; fileName: string }>
        skipped: Array<{ sourcePath: string; reason: string }>
        rejected: Array<{ sourcePath: string; reason: string }>
        content: InstanceContentItem[]
      }>
      revealInstanceContentFile: (options: { instance: Instance; kind: InstanceContentKind; fileName: string; contentId: string }) => Promise<{ success: boolean }>
      getDroppedFilePaths: (files: File[]) => string[]
      openInstanceFolder: (instance: Instance) => Promise<{ success: boolean }>
      deleteInstance: (instance: Instance) => Promise<{ success: boolean; deleted: boolean; instanceRoot: string }>
      openManualDownloadFolder: () => Promise<{ success: boolean; path?: string }>
      copyToClipboard: (value: string) => Promise<{ success: boolean }>
      importCurseForgeManualDownload: (options: { instance: Instance; item: ManualCurseForgeDownloadItem }) => Promise<{
        success: boolean
        imported: boolean
        alreadyInstalled?: boolean
        path?: string
        filename?: string
        downloadDirectory?: string
      }>
      getModrinthContentStatus: (options: { instance?: Instance | null; projects: any[] }) => Promise<Record<string, ContentStatus>>
      getCurseForgeConfig: () => Promise<{ configured: boolean; source: string }>
      getHomeModpacks: () => Promise<{ hits: any[]; total_hits: number; stale?: boolean }>
      searchModrinth: (options: {
        query: string
        projectType: string
        offset: number
        limit: number
        index: LibrarySort
        gameVersion: string
        loader: string
        environment: LibraryEnvironment
        openSourceOnly: boolean
      }) => Promise<{ hits: any[]; total_hits: number; canceled?: boolean }>
      searchCurseForge: (options: {
        query: string
        projectType: string
        offset: number
        limit: number
        instance?: Instance | null
        sort: Exclude<LibrarySort, 'relevance'>
        gameVersion: string
        loader: string
      }) => Promise<{ hits: any[]; total_hits: number; canceled?: boolean }>
      getCurseForgeContentStatus: (options: { instance?: Instance | null; projects: any[] }) => Promise<Record<string, ContentStatus>>
      getCurseForgeModpackVersions: (options: { project: any }) => Promise<ModrinthVersionOption[]>
      getCurseForgeProjectVersions: (options: { instance: Instance; project: any }) => Promise<ModrinthVersionOption[]>
      installCurseForgeModpack: (options: { project: any; fileId?: string; taskId?: string; playerName?: string; accountType?: string }) => Promise<ModpackInstallResult>
      installCurseForgeContent: (options: { instance: Instance; project: any; fileId?: string; playerName?: string; accountType?: string }) => Promise<{
        success: boolean
        projectType: string
        version: string
        installDirectory: string
        installed: Array<{ filename: string; path: string; skipped: boolean; dependency: boolean; versionNumber?: string }>
      }>
      getModrinthProjectVersions: (options: { instance?: Instance; project: any; projectType: string }) => Promise<ModrinthVersionOption[]>
      installModrinthContent: (options: { instance: Instance; project: any; projectType: string; versionId?: string; playerName?: string; accountType?: string }) => Promise<{
        success: boolean
        projectType: string
        version: string
        installDirectory: string
        installed: Array<{ filename: string; path: string; skipped: boolean; dependency: boolean; versionNumber?: string }>
      }>
      installModrinthModpack: (options: { project: any; projectType: string; versionId?: string; taskId?: string; playerName?: string; accountType?: string }) => Promise<ModpackInstallResult>
      installLocalMrpack: (options?: { taskId?: string }) => Promise<ModpackInstallResult>
      cancelInstallTask: (taskId: string) => Promise<{ success: boolean; canceled?: boolean; cancelled?: boolean }>
      exportInstanceMrpack: (instance: Instance) => Promise<ExportInstanceMrpackResult>
      launchMinecraft: (options: any) => Promise<any>
      stopMinecraft: (instance?: Instance) => Promise<any>
      loginMicrosoft: () => Promise<Account>
      loginOffline: (username: string) => Promise<Account>
      onLaunchProgress: (callback: (progress: any) => void) => () => void
      onLaunchError: (callback: (error: string) => void) => () => void
      onLauncherErrorReport: (callback: (report: LauncherErrorReport) => void) => () => void
      onMinecraftGameIssue: (callback: (issue: MinecraftGameIssue) => void) => () => void
      onLauncherUpdate: (callback: (update: LauncherUpdateInfo) => void) => () => void
      onLauncherUpdateProgress: (callback: (progress: LauncherUpdateProgress) => void) => () => void
      onAccountSessionExpired: (callback: (payload: AccountSessionExpiredPayload) => void) => () => void
      copyErrorReport: (report: string) => Promise<{ success: boolean }>
      submitErrorReport: (request: { reportId: string; activeAccountId?: string | null; playerName?: string | null }) => Promise<{ success: boolean; duplicate?: boolean; reportId?: string; discordDispatched?: boolean; discordQueued?: boolean; confirmed?: boolean; confirmationDuplicate?: boolean; confirmationCount?: number }>
      onGameState: (callback: (state: any) => void) => () => void
      onGameLog: (callback: (entry: GameLogEntry) => void) => () => void
      windowControl: (action: string) => void
      openLogs: () => void
      openExternal: (url: string) => void
    }
  }
}

const navItems = [
  { id: 'home', label: 'Home', labelKey: 'nav.home', icon: Home },
  { id: 'instances', label: 'Instances', labelKey: 'nav.instances', icon: LayoutGrid },
  { id: 'skins', label: 'Skins', labelKey: 'nav.skins', icon: Shirt },
  { id: 'library', label: 'Library', labelKey: 'nav.library', icon: Library },
  { id: 'settings', label: 'Settings', labelKey: 'nav.settings', icon: Settings }
] as const

type ViewId = typeof navItems[number]['id']

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

const isCurseForgeManualDownloadRequired = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '')
  return /disabled third-party downloads|does not allow third-party downloads/i.test(message)
}

const isDirectImageSource = (source: string) => (
  source.startsWith('data:') || source === './minisand-logo.png' || source.startsWith('/') || source.startsWith('file:')
)

const CachedImage = ({
  src,
  alt = '',
  className,
  fallback = null,
  referrerPolicy = 'no-referrer',
  loading,
  decoding = 'async',
  onImageError
}: {
  src?: string | null
  alt?: string
  className?: string
  fallback?: React.ReactNode
  referrerPolicy?: React.HTMLAttributeReferrerPolicy
  loading?: React.ImgHTMLAttributes<HTMLImageElement>['loading']
  decoding?: React.ImgHTMLAttributes<HTMLImageElement>['decoding']
  onImageError?: () => void
}) => {
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const source = src || ''
    return isDirectImageSource(source) ? source : ''
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const source = src || ''
    setFailed(false)

    if (!source) {
      setResolvedSrc('')
      return () => {
        cancelled = true
      }
    }

    if (isDirectImageSource(source)) {
      setResolvedSrc(source)
      return () => {
        cancelled = true
      }
    }

    // Remote images stay hidden until the sandboxed main process validates,
    // bounds, and converts them to a safe raster data URL.
    setResolvedSrc('')
    window.electron.cacheImageUrl(source)
      .then((cached) => {
        if (cancelled) return
        if (cached) setResolvedSrc(cached)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [src])

  if (!src || failed || !resolvedSrc) return <>{fallback}</>

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy={referrerPolicy}
      loading={loading}
      decoding={decoding}
      onError={() => {
        setFailed(true)
        onImageError?.()
      }}
      className={className}
    />
  )
}

const formatPlaytime = (seconds = 0) => {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const DEFAULT_SKIN_ASSET_REVISION = '15b0c1e447cc2fff34ca54d735aaa596a0aab2b0'
const DEFAULT_STEVE_TEXTURE_URL = `https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/${DEFAULT_SKIN_ASSET_REVISION}/assets/minecraft/textures/entity/player/wide/steve.png`

const formatDate = (value?: string | null) => {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const formatRelativeDate = (value: string, language: LauncherLanguage) => {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return formatDate(value)

  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000)
  const absoluteSeconds = Math.abs(elapsedSeconds)
  const formatter = new Intl.RelativeTimeFormat(language === 'th' ? 'th-TH' : 'en-US', { numeric: 'auto' })

  if (absoluteSeconds < 60) return formatter.format(elapsedSeconds, 'second')
  if (absoluteSeconds < 60 * 60) return formatter.format(Math.round(elapsedSeconds / 60), 'minute')
  if (absoluteSeconds < 60 * 60 * 24) return formatter.format(Math.round(elapsedSeconds / (60 * 60)), 'hour')
  if (absoluteSeconds < 60 * 60 * 24 * 30) return formatter.format(Math.round(elapsedSeconds / (60 * 60 * 24)), 'day')
  return formatter.format(Math.round(elapsedSeconds / (60 * 60 * 24 * 30)), 'month')
}

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Could not read image file.'))
  reader.readAsDataURL(file)
})

const resizeImageDataUrl = (dataUrl: string, maxSize = 512) => new Promise<string>((resolve) => {
  const image = new Image()
  image.onload = () => {
    const longestSide = Math.max(image.width, image.height)
    const scale = longestSide > maxSize ? maxSize / longestSide : 1
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      resolve(dataUrl)
      return
    }

    context.drawImage(image, 0, 0, width, height)
    resolve(canvas.toDataURL('image/webp', 0.86))
  }
  image.onerror = () => resolve(dataUrl)
  image.src = dataUrl
})

const readInstanceIconFile = async (file: File) => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Instance icon image is too large.')
  }

  const dataUrl = await readFileAsDataUrl(file)
  return resizeImageDataUrl(dataUrl)
}

const SwitchControl = ({
  checked,
  onChange,
  disabled = false,
  busy = false,
  title
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  busy?: boolean
  title?: string
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={title}
    disabled={disabled || busy}
    onClick={onChange}
    className={classNames(
      'relative grid h-10 w-16 shrink-0 place-items-center overflow-hidden rounded-full border p-1 outline-none transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1526] disabled:cursor-wait disabled:opacity-60',
      checked
        ? 'border-blue-300/40 bg-blue-500 shadow-lg shadow-blue-950/30'
        : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
    )}
    data-tooltip={title}
  >
    <span className="relative h-7 w-full rounded-full">
      <span
        className={classNames(
          'absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-900 shadow-md transition-transform duration-150 ease-out',
          checked ? 'translate-x-7' : 'translate-x-0'
        )}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <span className={classNames('h-2 w-2 rounded-full transition-colors duration-150', checked ? 'bg-blue-500' : 'bg-slate-400')} />
        )}
      </span>
    </span>
  </button>
)

const getContentDisplayName = (item: InstanceContentItem) => {
  const version = item.versionNumber?.trim()
  const name = item.name.trim()
  if (!version || name.toLowerCase().includes(version.toLowerCase())) return name

  const withoutStaleVersion = name.replace(
    /\s+(?:v(?:ersion)?\s*)?\d+(?:\.\d+)+(?:[-+][0-9a-z.-]+)?$/i,
    ''
  ).trim()
  return `${withoutStaleVersion || name} ${version}`
}

const InstanceIcon = ({
  instance,
  running = false,
  size = 'md'
}: {
  instance: Instance
  running?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) => {
  const sizeClass = size === 'xs'
    ? 'h-6 w-6 rounded-md'
    : size === 'sm'
      ? 'h-9 w-9 rounded-md'
      : size === 'lg'
      ? 'h-16 w-16 rounded-lg'
      : 'h-12 w-12 rounded-lg'
  const iconSize = size === 'xs' ? 13 : size === 'sm' ? 17 : size === 'lg' ? 24 : 21

  return (
    <div className={classNames(
      'relative flex shrink-0 items-center justify-center overflow-hidden border bg-slate-900 text-blue-300 transition-[border-color,box-shadow] duration-150',
      running ? 'border-blue-300/60 shadow-[0_0_18px_rgba(96,165,250,0.28)]' : 'border-slate-700',
      sizeClass
    )}>
      {instance.iconUrl ? (
        <CachedImage
          src={instance.iconUrl}
          alt=""
          className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
          fallback={<Package size={iconSize} />}
        />
      ) : (
        <Package size={iconSize} />
      )}
      {running && (
        <span className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border border-slate-950 bg-blue-300 shadow-[0_0_10px_rgba(96,165,250,0.9)]" />
      )}
    </div>
  )
}

const AccountHead = ({
  account,
  skinTextureSrc,
  sizeClass
}: {
  account: Account
  skinTextureSrc?: string | null
  sizeClass: string
}) => {
  const source = skinTextureSrc || (account.type === 'offline' ? DEFAULT_STEVE_TEXTURE_URL : '')
  const [resolvedSrc, setResolvedSrc] = useState(() => (isDirectImageSource(source) ? source : ''))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)

    if (!source) {
      setResolvedSrc('')
      return () => {
        cancelled = true
      }
    }

    if (isDirectImageSource(source)) {
      setResolvedSrc(source)
      return () => {
        cancelled = true
      }
    }

    setResolvedSrc('')
    window.electron.cacheImageUrl(source)
      .then((cached) => {
        if (cancelled) return
        if (cached) setResolvedSrc(cached)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [source])

  if (!resolvedSrc || failed) {
    return (
      <div className={classNames('flex items-center justify-center rounded-md bg-slate-800 text-slate-500', sizeClass)}>
        <User size={18} />
      </div>
    )
  }

  const skinLayerClass = 'pointer-events-none absolute left-0 top-0 max-w-none select-none'
  return (
    <div className={classNames('relative shrink-0 overflow-hidden rounded-md bg-slate-800 outline outline-1 -outline-offset-1 outline-white/10', sizeClass)}>
      <img
        src={resolvedSrc}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={skinLayerClass}
        style={{ width: '800%', left: '-100%', top: '-100%', imageRendering: 'pixelated' }}
      />
      <img
        src={resolvedSrc}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={skinLayerClass}
        style={{ width: '800%', left: '-500%', top: '-100%', imageRendering: 'pixelated' }}
      />
    </div>
  )
}

const normalizeStoredInstances = (items: any[]): Instance[] => {
  return items
    .filter(Boolean)
    .map((item) => ({
      id: String(item.id || crypto.randomUUID?.() || Date.now()),
      name: String(item.name || 'Minecraft Instance'),
      version: String(item.version || '1.20.1'),
      loader: item.loader === 'fabric' || item.loader === 'forge' || item.loader === 'quilt' || item.loader === 'neoforge'
        ? item.loader
        : 'vanilla',
      loaderVersion: String(item.loaderVersion || ''),
      createdAt: String(item.createdAt || new Date().toISOString()),
      iconUrl: typeof item.iconUrl === 'string' ? item.iconUrl : null,
      playtimeSeconds: Number(item.playtimeSeconds || 0),
      lastPlayedAt: item.lastPlayedAt
    }))
}

const MicrosoftMark = ({ className = '' }: { className?: string }) => (
  <span className={classNames('grid grid-cols-2 gap-0.5', className)} aria-hidden="true">
    <span className="bg-[#f25022]" />
    <span className="bg-[#7fba00]" />
    <span className="bg-[#00a4ef]" />
    <span className="bg-[#ffb900]" />
  </span>
)

const isMicrosoftSessionExpiredMessage = (value: unknown) => /Microsoft session .*?(expired|missing its refresh token|invalid|incomplete)|Your Microsoft session expired/i.test(String(value || ''))

const LIBRARY_SEARCH_DEBOUNCE_MS = 150
const LIBRARY_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const LIBRARY_SEARCH_CACHE_LIMIT = 40

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewId>('home')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountSkinTextures, setAccountSkinTextures] = useState<Record<string, string>>({})
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginStep, setLoginStep] = useState<'select' | 'offline'>('select')
  const [offlineName, setOfflineName] = useState('')
  const [offlineNameInputRejected, setOfflineNameInputRejected] = useState(false)
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<AccountSessionExpiredNotice | null>(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [recentPlaces, setRecentPlaces] = useState<RecentInstancePlace[]>(readRecentInstancePlaces)
  const [homeServerStatuses, setHomeServerStatuses] = useState<Record<string, HomeServerStatusEntry>>({})
  const [homeServerStatusesRefreshing, setHomeServerStatusesRefreshing] = useState(false)
  const [homeServerStatusRefresh, setHomeServerStatusRefresh] = useState(0)
  const homeServerStatusCacheRef = useRef<Map<string, HomeServerStatusCacheEntry>>(new Map())
  const homeServerStatusRequestIdRef = useRef(0)
  const homeServerPingInFlightRef = useRef<Map<string, Promise<MinecraftServerPing[]>>>(new Map())
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storage.sidebarWidth))
    if (!Number.isFinite(saved) || saved <= 0) return SIDEBAR_DEFAULT_WIDTH
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved))
  })
  const [latestVersion, setLatestVersion] = useState('1.20.1')
  const [versions, setVersions] = useState<any[]>([])
  const [minecraftVersionsLoading, setMinecraftVersionsLoading] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<Array<{ id: string; type: string }>>([])
  const [showInstanceModal, setShowInstanceModal] = useState(false)
  const [deletingInstanceId, setDeletingInstanceId] = useState<string | null>(null)
  const [newInstance, setNewInstance] = useState({
    name: 'New Instance',
    version: '',
    loader: 'vanilla' as LoaderType,
    loaderVersion: '',
    iconUrl: ''
  })
  const [showInstanceSettings, setShowInstanceSettings] = useState(false)
  const [instanceSettingsTab, setInstanceSettingsTab] = useState<InstanceSettingsTab>('general')
  const [instanceSettingsTargetId, setInstanceSettingsTargetId] = useState<string | null>(null)
  const [instanceSettingsDraft, setInstanceSettingsDraft] = useState({
    name: '',
    version: '',
    loader: 'vanilla' as LoaderType,
    loaderVersion: '',
    iconUrl: ''
  })
  const [instanceSettingsLoaderVersions, setInstanceSettingsLoaderVersions] = useState<Array<{ id: string; type: string }>>([])
  const [instanceSettingsLoaderVersionsLoading, setInstanceSettingsLoaderVersionsLoading] = useState(false)
  const [savingInstanceSettings, setSavingInstanceSettings] = useState(false)
  const [instanceSettingsEditingInstallation, setInstanceSettingsEditingInstallation] = useState(false)
  const [instanceActionMenuOpen, setInstanceActionMenuOpen] = useState(false)
  const instanceActionMenuRef = useRef<HTMLDivElement | null>(null)

  const [mods, setMods] = useState<any[]>([])
  const [modQuery, setModQuery] = useState('')
  const [libraryType, setLibraryType] = useState<LibraryProjectType>('mod')
  const [librarySource, setLibrarySource] = useState<LibrarySource>('modrinth')
  const [libraryFilters, setLibraryFilters] = useState<LibrarySearchFilters>(() => ({
    ...DEFAULT_LIBRARY_SEARCH_FILTERS
  }))
  const [libraryPage, setLibraryPage] = useState(0)
  const [totalHits, setTotalHits] = useState(0)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [homeModpacks, setHomeModpacks] = useState<any[]>([])
  const [homeModpacksLoading, setHomeModpacksLoading] = useState(false)
  const [homeModpacksError, setHomeModpacksError] = useState(false)
  const [homeModpacksLoaded, setHomeModpacksLoaded] = useState(false)
  const [homeModpacksRetry, setHomeModpacksRetry] = useState(0)
  const homeModpackRequestIdRef = useRef(0)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const discordAccountSectionRef = useRef<HTMLDivElement | null>(null)
  const pendingDiscordAccountFocusRef = useRef(false)
  const [curseForgeConfigured, setCurseForgeConfigured] = useState(false)
  const librarySectionRef = useRef<HTMLElement | null>(null)
  const libraryHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const pendingLibraryHeadingFocusRef = useRef(false)
  const pendingLibraryPageFocusRef = useRef<number | null>(null)
  const [installingProjectId, setInstallingProjectId] = useState<string | null>(null)
  const [activeInstallTaskId, setActiveInstallTaskId] = useState<string | null>(null)
  const cancelledInstallTasksRef = useRef<Set<string>>(new Set())
  const [contentStatuses, setContentStatuses] = useState<Record<string, ContentStatus>>({})
  const [, setContentStatusLoading] = useState(false)
  const librarySearchCacheRef = useRef<Map<string, { hits: any[]; total_hits: number; storedAt: number }>>(new Map())
  const installedContentStatusOverridesRef = useRef<Record<string, ContentStatus>>({})
  const [instanceUpdateSummaries, setInstanceUpdateSummaries] = useState<Record<string, InstanceUpdateSummary>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingInstanceId, setUpdatingInstanceId] = useState<string | null>(null)
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null)
  const [updatingProjectIds, setUpdatingProjectIds] = useState<string[]>([])
  const updatingProjectIdsRef = useRef<Set<string>>(new Set())
  const activeContentUpdatesRef = useRef(0)
  const [showModpackModal, setShowModpackModal] = useState(false)
  const [modpackProject, setModpackProject] = useState<any | null>(null)
  const [modpackVersions, setModpackVersions] = useState<ModrinthVersionOption[]>([])
  const [modpackVersionsLoading, setModpackVersionsLoading] = useState(false)
  const [selectedModpackVersionId, setSelectedModpackVersionId] = useState('')
  const [libraryProjectDetails, setLibraryProjectDetails] = useState<any | null>(null)
  const [libraryProjectVersions, setLibraryProjectVersions] = useState<ModrinthVersionOption[]>([])
  const [libraryProjectVersionsLoading, setLibraryProjectVersionsLoading] = useState(false)
  const [libraryProjectVersionError, setLibraryProjectVersionError] = useState('')
  const [selectedLibraryVersionId, setSelectedLibraryVersionId] = useState('')
  const libraryProjectDialogRef = useRef<HTMLDivElement | null>(null)
  const libraryProjectTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [modpackInstallActivity, setModpackInstallActivity] = useState<ModpackInstallActivity | null>(null)
  const modpackInstallMinimizedRef = useRef(false)
  const [manualDownloadItems, setManualDownloadItems] = useState<ManualCurseForgeDownloadItem[]>([])
  const [manualDownloadInstance, setManualDownloadInstance] = useState<Instance | null>(null)
  const [manualDownloadDirectory, setManualDownloadDirectory] = useState('')
  const [manualDownloadStatuses, setManualDownloadStatuses] = useState<Record<string, 'pending' | 'checking' | 'complete' | 'failed'>>({})
  const [manualDownloadMessage, setManualDownloadMessage] = useState('')
  const manualDownloadStatusesRef = useRef<Record<string, 'pending' | 'checking' | 'complete' | 'failed'>>({})
  const manualDownloadInFlightRef = useRef<Set<string>>(new Set())
  const manualDownloadCompletionAnnouncedRef = useRef(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [confirmDialogBusy, setConfirmDialogBusy] = useState(false)
  const [confirmDialogError, setConfirmDialogError] = useState('')
  const [importingMrpack, setImportingMrpack] = useState(false)
  const [exportingInstanceId, setExportingInstanceId] = useState<string | null>(null)

  const [contentTab, setContentTab] = useState<InstanceContentKind>('mods')
  const [instanceContent, setInstanceContent] = useState<InstanceContentItem[]>([])
  const [instanceContentCache, setInstanceContentCache] = useState<InstanceContentCache>({})
  const instanceContentCacheRef = useRef<InstanceContentCache>({})
  const currentContentTargetIdRef = useRef<string | null>(null)
  const currentContentTabRef = useRef<InstanceContentKind>('mods')
  const [instanceContentQuery, setInstanceContentQuery] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [busyContentId, setBusyContentId] = useState<string | null>(null)
  const [contentDropActive, setContentDropActive] = useState(false)
  const [contentImporting, setContentImporting] = useState(false)
  const [selectedScreenshot, setSelectedScreenshot] = useState<InstanceContentItem | null>(null)
  const [screenshotZoom, setScreenshotZoom] = useState(1)
  const [screenshotPan, setScreenshotPan] = useState<ScreenshotPan>({ x: 0, y: 0 })
  const [screenshotDragging, setScreenshotDragging] = useState(false)
  const screenshotDragRef = useRef<ScreenshotDragState>(null)
  const screenshotPanFrameRef = useRef<number | null>(null)
  const screenshotPanPendingRef = useRef<ScreenshotPan | null>(null)
  const [instancePanelView, setInstancePanelView] = useState<'content' | 'places' | 'logs'>('content')
  const instanceHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const pendingInstanceHeadingFocusRef = useRef(false)
  const [gameLogLines, setGameLogLines] = useState<string[]>([])
  const [gameLogPath, setGameLogPath] = useState('')
  const [gameLogLoading, setGameLogLoading] = useState(false)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const [memoryGb, setMemoryGb] = useState(4)
  const [discordSettings, setDiscordSettings] = useState<LauncherSettings>(() => ({ ...DEFAULT_LAUNCHER_SETTINGS }))
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null)
  const [launcherDiscordAccount, setLauncherDiscordAccount] = useState<LauncherDiscordAccountState | null>(null)
  const [launcherDiscordAccountBusy, setLauncherDiscordAccountBusy] = useState(false)
  const [launcherDiscordAccountError, setLauncherDiscordAccountError] = useState('')
  const [checkingLauncherUpdate, setCheckingLauncherUpdate] = useState(false)
  const [dataLocation, setDataLocation] = useState<LauncherDataLocation | null>(null)
  const [dataLocationStatus, setDataLocationStatus] = useState<DataLocationStatus>('loading')
  const [dataLocationError, setDataLocationError] = useState('')
  const dataLocationRequestIdRef = useRef(0)
  const [movingDataLocation, setMovingDataLocation] = useState(false)
  const [microsoftLoginLoading, setMicrosoftLoginLoading] = useState(false)

  const [launchingInstanceIds, setLaunchingInstanceIds] = useState<string[]>([])
  const [launcherErrorReport, setLauncherErrorReport] = useState<LauncherErrorReport | null>(null)
  const [minecraftGameIssue, setMinecraftGameIssue] = useState<MinecraftGameIssue | null>(null)
  const [gameIssueCopyResult, setGameIssueCopyResult] = useState<{
    id: string
    state: 'copying' | 'copied' | 'failed'
  } | null>(null)
  const [errorCopyState, setErrorCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [errorSubmitState, setErrorSubmitState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [errorSubmitDetail, setErrorSubmitDetail] = useState('')
  const submittedErrorReportsRef = useRef<Set<string>>(new Set())
  const [runningInstances, setRunningInstances] = useState<Record<string, number>>({})
  const [runningServers, setRunningServers] = useState<Record<string, RunningServerInfo>>({})
  const [runningElapsedByInstance, setRunningElapsedByInstance] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('Ready')
  const [activityDetail, setActivityDetail] = useState('')
  const [launcherVersion, setLauncherVersion] = useState('')
  const [launcherUpdate, setLauncherUpdate] = useState<LauncherUpdateInfo | null>(null)
  const [dismissedLauncherUpdateVersion, setDismissedLauncherUpdateVersion] = useState('')
  const [launcherUpdateInstallState, setLauncherUpdateInstallState] = useState<'idle' | 'installing' | 'opened' | 'blocked' | 'failed'>('idle')
  const [launcherUpdateProgress, setLauncherUpdateProgress] = useState<LauncherUpdateProgress | null>(null)
  const [launcherUpdateBlockReason, setLauncherUpdateBlockReason] = useState<LauncherUpdateBlockReason | null>(null)
  const [startupAutoUpdating, setStartupAutoUpdating] = useState(true)
  const [launcherStats, setLauncherStats] = useState<LauncherStats | null>(null)
  const [bootReady, setBootReady] = useState(false)
  const [bootProgress, setBootProgress] = useState(8)
  const [bootText, setBootText] = useState('Starting NamLauncher')
  const [bootLog, setBootLog] = useState<SetupLogEntry[]>([])
  const bootLogSequenceRef = useRef(0)
  const [showFirstRunSetup, setShowFirstRunSetup] = useState(false)
  const [showLegalReview, setShowLegalReview] = useState(false)
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null)
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [offlineWarningAccepted, setOfflineWarningAccepted] = useState(false)
  const [windowHidden, setWindowHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const reduceMotion = useReducedMotion()

  const language = discordSettings.language || 'th'
  const t = (key: string) => uiText[language]?.[key] || uiText.en[key] || key
  const tf = (key: string, values: Record<string, string | number>) => {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      t(key)
    )
  }

  useEffect(() => {
    if (modpackInstallActivity?.phase !== 'success') return

    const completedTaskId = modpackInstallActivity.taskId
    const timeoutId = window.setTimeout(() => {
      setModpackInstallActivity((current) => (
        current?.taskId === completedTaskId && current.phase === 'success' ? null : current
      ))
    }, 2800)

    return () => window.clearTimeout(timeoutId)
  }, [modpackInstallActivity?.phase, modpackInstallActivity?.taskId])

  const getAccountTypeLabel = (type: Account['type']) => (
    type === 'msa' ? t('account.type.microsoft') : t('account.type.offline')
  )
  const getAccountTypeDetail = (type: Account['type']) => (
    type === 'msa' ? t('account.detail.microsoft') : t('account.detail.offline')
  )
  const getContentTabLabel = (kind: InstanceContentKind) => t(`content.tab.${kind}`)
  const getContentFolderLabel = (kind: InstanceContentKind) => (
    kind === 'resourcepacks' ? 'resourcepacks'
      : kind === 'shaderpacks' ? 'shaderpacks'
        : kind === 'screenshots' ? 'screenshots'
          : 'mods'
  )
  const loadLauncherDataLocation = useCallback(async () => {
    const requestId = dataLocationRequestIdRef.current + 1
    dataLocationRequestIdRef.current = requestId
    setDataLocationStatus('loading')
    setDataLocationError('')

    let timeoutId: number | null = null
    try {
      const location = await new Promise<LauncherDataLocation>((resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Timed out while reading the launcher data folder'))
        }, DATA_LOCATION_TIMEOUT_MS)
        window.electron.getLauncherDataLocation().then(resolve, reject)
      })

      if (requestId !== dataLocationRequestIdRef.current) return null
      setDataLocation(location)
      setDataLocationStatus('ready')
      return location
    } catch (error) {
      if (requestId !== dataLocationRequestIdRef.current) return null
      console.error('[NamLauncher] Could not read the launcher data folder', error)
      setDataLocationError(error instanceof Error ? error.message : String(error || 'Unknown error'))
      setDataLocationStatus('error')
      return null
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [])
  const showMicrosoftSessionExpired = useCallback((payload: AccountSessionExpiredPayload) => {
    const accountId = String(payload.accountId || '')
    const accountName = String(payload.accountName || t('auth.microsoft.title'))

    if (Array.isArray(payload.accounts)) {
      setAccounts(payload.accounts)
    } else if (accountId) {
      setAccounts((prev) => prev.filter((account) => account.id !== accountId))
    }

    if (accountId) {
      setActiveAccountId((current) => current === accountId ? null : current)
    } else {
      setActiveAccountId(null)
    }

    setSessionExpiredNotice({
      accountId,
      accountName,
      message: typeof payload.message === 'string' ? payload.message : ''
    })
    setShowAccountMenu(false)
    setLoginStep('select')
    setShowLoginModal(true)
    setStatusText(t('auth.sessionExpired.status'))
  }, [language])
  const pageMotionProps = reduceMotion
    ? {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.1 }
    }
    : {
      initial: { opacity: 0, y: 12, scale: 0.992 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: -8, scale: 0.992 },
      transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }
    }
  const settingsCardVariants = reduceMotion
    ? {
      hidden: { opacity: 1 },
      show: { opacity: 1 }
    }
    : {
      hidden: { opacity: 0, y: 14, scale: 0.992 },
      show: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
        }
      }
    }
  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null

  useEffect(() => {
    let cancelled = false
    const validAccountIds = new Set(accounts.map((account) => account.id))
    setAccountSkinTextures((current) => Object.fromEntries(
      Object.entries(current).filter(([accountId]) => validAccountIds.has(accountId))
    ))

    const updateTexture = (accountId: string, library: SkinLibraryData) => {
      if (cancelled) return
      const texture = library.effectiveSkin?.textureDataUrl || ''
      if (!texture) return
      setAccountSkinTextures((current) => (
        current[accountId] === texture ? current : { ...current, [accountId]: texture }
      ))
    }

    for (const account of accounts) {
      void window.electron.getSkinLibrary(account.id)
        .then((cached) => {
          updateTexture(account.id, cached)
          if (account.type !== 'msa' || cancelled) return null
          return window.electron.refreshSkinLibrary(account.id)
        })
        .then((refreshed) => {
          if (refreshed) updateTexture(account.id, refreshed)
        })
        .catch(() => {
          // Account avatars are best-effort and must never block launcher startup.
        })
    }

    return () => {
      cancelled = true
    }
  }, [accounts])

  useEffect(() => {
    if (!showAccountMenu) return
    let cancelled = false

    for (const account of accounts) {
      if (account.type !== 'msa') continue
      void window.electron.refreshSkinLibrary(account.id)
        .then((library) => {
          if (cancelled) return
          const texture = library.effectiveSkin?.textureDataUrl || ''
          if (!texture) return
          setAccountSkinTextures((current) => (
            current[account.id] === texture ? current : { ...current, [account.id]: texture }
          ))
        })
        .catch(() => {
          // Keep the last cached head when Mojang is temporarily unavailable.
        })
    }

    return () => {
      cancelled = true
    }
  }, [showAccountMenu, accounts])

  const resolvedSelectedInstanceId = resolveSelectedInstanceId(instances, selectedInstanceId)
  const selectedInstance = instances.find((instance) => instance.id === resolvedSelectedInstanceId) || null
  const currentTarget = selectedInstance
  const libraryCompatibilityAvailable = isLibraryInstanceCompatibilityAvailable(libraryType, currentTarget)
  const libraryLoaderFilterAvailable = isLibraryLoaderFilterAvailable(librarySource, libraryType)
  const effectiveLibraryFilters: LibrarySearchFilters = {
    ...libraryFilters,
    sort: librarySource === 'curseforge' && libraryFilters.sort === 'relevance'
      ? 'downloads'
      : libraryFilters.sort,
    loader: libraryLoaderFilterAvailable ? libraryFilters.loader : '',
    environment: librarySource === 'modrinth' && libraryType === 'mod'
      ? libraryFilters.environment
      : 'all',
    openSourceOnly: librarySource === 'modrinth' && libraryFilters.openSourceOnly,
    compatibleOnly: libraryCompatibilityAvailable && libraryFilters.compatibleOnly
  }
  const resolvedLibraryFilters = resolveLibrarySearchFilters(effectiveLibraryFilters, currentTarget)
  const activeLibraryFilterCount = countActiveLibraryFilters(effectiveLibraryFilters)
  const instanceSettingsTarget = instances.find((instance) => instance.id === instanceSettingsTargetId) || currentTarget
  currentContentTargetIdRef.current = currentTarget?.id || null
  currentContentTabRef.current = contentTab
  const targetPlaytime = currentTarget?.playtimeSeconds || 0
  const runningInstanceIds = Object.keys(runningInstances)
  const gameRunning = runningInstanceIds.length > 0
  const launching = launchingInstanceIds.length > 0
  const currentRunningThisTarget = Boolean(currentTarget && runningInstances[currentTarget.id])
  const currentLaunchingThisTarget = Boolean(currentTarget && launchingInstanceIds.includes(currentTarget.id))
  const currentBusyThisTarget = currentRunningThisTarget || currentLaunchingThisTarget
  const sidebarNarrow = sidebarWidth < 312
  const sidebarCompact = sidebarWidth < 284
  const getProjectKey = (project: any) => String(project?.project_id || project?.id || project?.slug || '')
  const isInstanceBusy = (instanceId?: string | null) => Boolean(
    instanceId && (runningInstances[instanceId] || launchingInstanceIds.includes(instanceId))
  )
  const isModContentType = (contentType?: string | null) => contentType === 'mod' || contentType === 'mods'
  const shouldBlockContentMutation = (instanceId?: string | null, contentType?: string | null) => {
    return isInstanceBusy(instanceId) && isModContentType(contentType)
  }
  const shouldBlockCurrentTargetContent = (contentType?: string | null) => {
    return shouldBlockContentMutation(currentTarget?.id, contentType)
  }

  useEffect(() => {
    if (libraryLoaderFilterAvailable) return
    setLibraryFilters((current) => current.loader ? { ...current, loader: '' } : current)
  }, [libraryLoaderFilterAvailable])

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    if (activeView !== 'settings') pendingDiscordAccountFocusRef.current = false
  }, [activeView])

  useEffect(() => {
    const target = activeView === 'instances' && pendingInstanceHeadingFocusRef.current
      ? { heading: instanceHeadingRef, pending: pendingInstanceHeadingFocusRef }
      : activeView === 'library' && pendingLibraryHeadingFocusRef.current
        ? { heading: libraryHeadingRef, pending: pendingLibraryHeadingFocusRef }
        : null
    if (!target) return

    let frame = 0
    let attempts = 0
    const focusHeading = () => {
      if (target.heading.current) {
        target.pending.current = false
        target.heading.current.focus({ preventScroll: true })
        return
      }

      attempts += 1
      if (attempts >= 40) {
        target.pending.current = false
        return
      }
      frame = window.requestAnimationFrame(focusHeading)
    }

    frame = window.requestAnimationFrame(focusHeading)
    return () => window.cancelAnimationFrame(frame)
  }, [activeView, currentTarget?.id])

  const focusLauncherInput = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.fixed.inset-0 [data-launcher-autofocus="true"]')
        || document.querySelector<HTMLElement>('[data-launcher-autofocus="true"]')
      if (!target || target.matches(':disabled')) return
      if (document.activeElement === target) return

      const style = window.getComputedStyle(target)
      if (style.display === 'none' || style.visibility === 'hidden') return

      target.focus({ preventScroll: true })
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && typeof target.select === 'function') {
        target.select()
      }
    })
  }

  const clampSidebarWidth = (value: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))

  const startSidebarResize = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    document.body.classList.add('nam-sidebar-resizing')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }

    const stopResize = () => {
      document.body.classList.remove('nam-sidebar-resizing')
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
  }

  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 32 : 12
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MAX_WIDTH)
    }
  }

  const ensureMinecraftVersionList = async () => {
    if (versions.length > 1 || minecraftVersionsLoading) return
    setMinecraftVersionsLoading(true)
    try {
      const items = await getAllVersions()
      setVersions(items)
      const firstVersion = getMinecraftVersionId(items[0])
      if (firstVersion) {
        setNewInstance((prev) => prev.version ? prev : { ...prev, version: firstVersion })
      }
    } catch {
      setStatusText(t('boot.versionListSkipped'))
    } finally {
      setMinecraftVersionsLoading(false)
    }
  }

  const resetInstanceSettingsDraft = (target: Instance) => {
    setInstanceSettingsDraft({
      name: target.name,
      version: target.version,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
      iconUrl: target.iconUrl || ''
    })
  }

  const updateInstanceContentCache = (
    instanceId: string,
    kind: InstanceContentKind,
    items: InstanceContentItem[]
  ) => {
    if (kind === 'screenshots') return
    instanceContentCacheRef.current = {
      ...instanceContentCacheRef.current,
      [instanceId]: {
        ...instanceContentCacheRef.current[instanceId],
        [kind]: items
      }
    }
    setInstanceContentCache(instanceContentCacheRef.current)
  }

  const refreshInstanceContent = (
    kind: InstanceContentKind = contentTab,
    target: Instance | null = currentTarget,
    options: { silent?: boolean; force?: boolean } = {}
  ) => {
    if (!target) {
      setInstanceContent([])
      setContentLoading(false)
      return Promise.resolve([])
    }

    const cached = instanceContentCacheRef.current[target.id]?.[kind]
    const isVisibleTarget = () => (
      currentContentTargetIdRef.current === target.id
      && currentContentTabRef.current === kind
    )

    if (cached && !options.force && isVisibleTarget()) {
      setInstanceContent(cached)
      setContentLoading(false)
    } else if (!options.silent && !cached && isVisibleTarget()) {
      setInstanceContent([])
      setContentLoading(true)
    }

    return window.electron.getInstanceContent({ instance: target, kind })
      .then((items) => {
        updateInstanceContentCache(target.id, kind, items)
        if (isVisibleTarget()) {
          setInstanceContent(items)
        }
        return items
      })
      .catch(() => {
        if (isVisibleTarget() && !cached) setInstanceContent([])
        return cached || []
      })
      .finally(() => {
        if (isVisibleTarget()) setContentLoading(false)
      })
  }

  const openInstanceLogs = async (target: Instance | null = currentTarget) => {
    if (!target) return

    setInstancePanelView('logs')
    setGameLogLoading(true)

    try {
      const result = await window.electron.getInstanceRunLog(target)
      const lines = String(result.content || '')
        .split(/\r?\n/)
        .filter(Boolean)

      setGameLogPath(result.path || '')
      setGameLogLines([
        ...(result.truncated ? ['[NamLauncher] Showing the latest part of the game latest.log'] : []),
        ...lines.slice(-700)
      ])
    } catch {
      setGameLogLines(['[NamLauncher] Could not read the game latest.log'])
      setGameLogPath('')
    } finally {
      setGameLogLoading(false)
    }
  }

  const refreshUpdateSummaries = async (targets: Instance[] = instances) => {
    if (targets.length === 0) {
      setInstanceUpdateSummaries({})
      return
    }

    setCheckingUpdates(true)
    try {
      const entries = await Promise.all(targets.map(async (target) => {
        const summary = await window.electron.getInstanceUpdateSummary(target)
        return [target.id, summary] as const
      }))

      setInstanceUpdateSummaries((prev) => ({
        ...prev,
        ...Object.fromEntries(entries)
      }))
    } catch {
      setStatusText(t('status.updateCheckFailed'))
    } finally {
      setCheckingUpdates(false)
    }
  }

  const refreshDiscordStatus = async () => {
    try {
      setDiscordStatus(await window.electron.getDiscordStatus())
    } catch {
      setDiscordStatus(null)
    }
  }

  const applyGameState = (state: any) => {
    if (Array.isArray(state.running)) {
      setRunningInstances(Object.fromEntries(
        state.running
          .filter((game: any) => game?.instanceId)
          .map((game: any) => [String(game.instanceId), Number(game.startedAt) || Date.now()])
      ))
      const nextServers = Object.fromEntries(
        state.running
          .filter((game: any) => game?.instanceId && game?.server?.label)
          .map((game: any) => [String(game.instanceId), {
            label: String(game.server.label),
            kind: String(game.server.kind || 'domain')
          }])
      ) as Record<string, RunningServerInfo>
      setRunningServers(nextServers)
      const activeServer = Object.values(nextServers)[0]
      setActivityDetail(activeServer ? tf('status.playingServer', { server: activeServer.label }) : '')
    }
    if (Array.isArray(state.launching)) {
      setLaunchingInstanceIds(state.launching
        .map((launch: any) => String(launch?.instanceId || ''))
        .filter(Boolean))
    }

    if (state.status === 'running') {
      if (!Array.isArray(state.running) && state.instanceId) {
        setRunningInstances((prev) => ({
          ...prev,
          [state.instanceId]: Number(state.startedAt) || Date.now()
        }))
      }
      if (!Array.isArray(state.launching) && state.instanceId) {
        setLaunchingInstanceIds((prev) => prev.filter((id) => id !== state.instanceId))
      }
      setStatusText(t('status.gameRunning'))
      setProgress(100)
      return
    }

    if (state.status === 'launching') {
      if (!Array.isArray(state.launching) && state.instanceId) {
        setLaunchingInstanceIds((prev) => prev.includes(state.instanceId) ? prev : [...prev, state.instanceId])
      }
      setStatusText(t('status.launchStarting'))
      return
    }

    if (state.status === 'stopped') {
      if (!Array.isArray(state.running) && state.instanceId) {
        setRunningInstances((prev) => {
          const next = { ...prev }
          delete next[state.instanceId]
          return next
        })
      }
      if (!Array.isArray(state.launching) && state.instanceId) {
        setLaunchingInstanceIds((prev) => prev.filter((id) => id !== state.instanceId))
      }
      setRunningElapsedByInstance((prev) => {
        if (!state.instanceId) return prev
        const next = { ...prev }
        delete next[state.instanceId]
        return next
      })
      if (!Array.isArray(state.running) && state.instanceId) {
        setRunningServers((prev) => {
          const next = { ...prev }
          delete next[state.instanceId]
          return next
        })
      }
      const stillActive = (Array.isArray(state.running) && state.running.length > 0)
        || (Array.isArray(state.launching) && state.launching.length > 0)
      setStatusText(stillActive ? t('status.gameRunning') : t('status.ready'))
      if (!stillActive) setProgress(0)
    }
  }

  useEffect(() => {
    let cancelled = false
    const bootStartedAt = Date.now()
    const advanceBoot = (value: number, text: string) => {
      if (cancelled) return
      const eventId = `${bootStartedAt}-${++bootLogSequenceRef.current}`
      const eventTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setBootProgress((current) => Math.max(current, value))
      setBootText(text)
      setBootLog((current) => {
        const progressValue = Math.min(Math.max(Math.round(value), 0), 100)
        const previous = current[current.length - 1]
        if (previous?.text === text) return current
        return [
          ...current.slice(-8),
          {
            id: eventId,
            text,
            progress: progressValue,
            at: eventTime
          }
        ]
      })
    }
    const withBootTimeout = <T,>(task: Promise<T>, ms = 12000) => new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Boot task timed out')), ms)
      task.then(
        (value) => {
          window.clearTimeout(timeout)
          resolve(value)
        },
        (error) => {
          window.clearTimeout(timeout)
          reject(error)
        }
      )
    })

    const syncLegalDocument = async (legalLanguage: LauncherLanguage) => {
      const document = await withBootTimeout(window.electron.getLegalDocument(legalLanguage), 10000)
      if (cancelled) return

      let acceptedVersion = ''
      try {
        const savedAcceptance = JSON.parse(localStorage.getItem(storage.legalAcceptance) || '{}')
        acceptedVersion = typeof savedAcceptance?.version === 'string' ? savedAcceptance.version : ''
      } catch {
        acceptedVersion = ''
      }

      setLegalDocument(document)
      setLegalAccepted(false)
      setShowFirstRunSetup(acceptedVersion !== document.version)
    }

    advanceBoot(14, t('boot.loadingLocalData'))
    const dataLocationTask = loadLauncherDataLocation().then(() => {
      advanceBoot(96, t('boot.dataFolderReady'))
    })

    const savedInstances = localStorage.getItem(storage.instances)
    let loadedInstances: Instance[] = []
    if (savedInstances) {
      try {
        loadedInstances = normalizeStoredInstances(JSON.parse(savedInstances))
        setInstances(loadedInstances)
      } catch {
        setInstances([])
      }
    }

    const hydrateTask = loadedInstances.length > 0
      ? withBootTimeout(window.electron.hydrateInstances(loadedInstances))
        .then((hydratedInstances) => {
          setInstances((prev) => prev.map((instance) => {
            const hydrated = hydratedInstances.find((item) => item.id === instance.id)
            return hydrated ? { ...instance, iconUrl: hydrated.iconUrl || instance.iconUrl || null } : instance
          }))
          advanceBoot(34, t('boot.instancesReady'))
        })
        .catch(() => undefined)
      : Promise.resolve().then(() => advanceBoot(34, t('boot.instanceListReady')))

    setSelectedInstanceId(localStorage.getItem(storage.selectedInstance))
    setActiveAccountId(localStorage.getItem(storage.activeAccount))
    localStorage.removeItem('namlauncher_quick_server')
    localStorage.removeItem('namlauncher_quick_server_enabled')

    const savedMemory = Number(localStorage.getItem(storage.memoryGb))
    if (savedMemory) setMemoryGb(Math.min(Math.max(savedMemory, 1), 32))
    advanceBoot(24, t('boot.settings'))

    const accountsTask = withBootTimeout(window.electron.getAccounts()).then((loadedAccounts) => {
      setAccounts(loadedAccounts)
      const savedAccount = localStorage.getItem(storage.activeAccount)
      if (loadedAccounts.length > 0) {
        setActiveAccountId(
          savedAccount && loadedAccounts.some((account) => account.id === savedAccount)
            ? savedAccount
            : loadedAccounts[0].id
        )
      }
      advanceBoot(48, t('boot.accountsReady'))
    }).catch(() => {
      setStatusText(t('boot.accountsFailed'))
      advanceBoot(48, t('boot.accountsSkipped'))
    })

    const latestVersionTask = withBootTimeout(getLatestVersion()).then((version) => {
      setLatestVersion(version)
      setNewInstance((prev) => ({ ...prev, version }))
      advanceBoot(62, t('boot.minecraftVersionReady'))
    }).catch(() => advanceBoot(62, t('boot.savedMinecraftVersion')))
    const allVersionsTask = withBootTimeout(getAllVersions()).then((items) => {
      setVersions(items)
      advanceBoot(74, t('boot.versionListReady'))
    }).catch(() => advanceBoot(74, t('boot.versionListSkipped')))
    const gameStateTask = withBootTimeout(window.electron.getGameState()).then((state) => {
      applyGameState(state)
      advanceBoot(86, t('boot.gameStateSynced'))
    }).catch(() => advanceBoot(86, t('boot.gameStateReady')))
    const privacyTask = withBootTimeout(window.electron.getDiscordSettings()).then(async (settings) => {
      setDiscordSettings({ ...DEFAULT_LAUNCHER_SETTINGS, ...settings })
      refreshDiscordStatus().catch(() => undefined)
      window.electron.getLauncherDiscordAccount()
        .then(setLauncherDiscordAccount)
        .catch(() => setLauncherDiscordAccount({ connected: false, persistent: false, profile: null }))
      await syncLegalDocument(settings.language || 'th')
      advanceBoot(94, t('boot.privacyReady'))
    }).catch(async () => {
      await syncLegalDocument('th').catch(() => undefined)
      advanceBoot(94, t('boot.privacyReady'))
    })
    const launcherVersionTask = withBootTimeout(window.electron.getLauncherVersion(), 2000).then((version) => {
      setLauncherVersion(version)
    }).catch(() => undefined)
    // The main-process controller is single-flight and has bounded network
    // deadlines. Do not time out the UI while an installer is being prepared.
    const launcherUpdateTask = window.electron.runStartupLauncherUpdate().then((result) => {
      setLauncherUpdate(result.update)
      if (result.outcome === 'fallback' && result.update.updateAvailable) {
        setLauncherUpdateInstallState('failed')
        setLauncherUpdateProgress({ state: 'failed', percent: 0, detail: t(`update.auto.fallback.${result.reason || 'install-failed'}`) })
      }
      advanceBoot(98, result.update.updateAvailable ? t('boot.updateFound') : t('boot.versionReady'))
    }).catch(() => {
      advanceBoot(98, t('boot.versionReady'))
    }).finally(() => setStartupAutoUpdating(false))

    Promise.allSettled([
      hydrateTask,
      accountsTask,
      latestVersionTask,
      allVersionsTask,
      gameStateTask,
      privacyTask,
      launcherVersionTask,
      launcherUpdateTask
    ]).finally(() => {
      advanceBoot(100, t('status.ready'))
      const elapsed = Date.now() - bootStartedAt
      const readyDelay = Math.max(280, 1800 - elapsed)
      window.setTimeout(() => {
        if (!cancelled) setBootReady(true)
      }, readyDelay)
    })

    void dataLocationTask

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(storage.instances, JSON.stringify(instances))
  }, [instances])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    localStorage.setItem(storage.sidebarWidth, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!bootReady || windowHidden) return

    let cancelled = false
    const loadStats = async () => {
      try {
        const stats = await window.electron.getLauncherStats()
        if (!cancelled) setLauncherStats(stats)
      } catch {
        if (!cancelled) setLauncherStats(null)
      }
    }

    loadStats()
    const timer = window.setInterval(loadStats, 5 * 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bootReady, windowHidden])

  useEffect(() => {
    const syncVisibility = () => setWindowHidden(document.hidden)
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [])

  useEffect(() => {
    if (showLoginModal || showInstanceModal) {
      focusLauncherInput()
    }
  }, [showLoginModal, showInstanceModal, loginStep])

  useEffect(() => {
    const nextSelectedInstanceId = resolveSelectedInstanceId(instances, selectedInstanceId)
    if (nextSelectedInstanceId !== selectedInstanceId) {
      setSelectedInstanceId(nextSelectedInstanceId)
    }

    setInstanceUpdateSummaries((prev) => Object.fromEntries(
      Object.entries(prev).filter(([instanceId]) => instances.some((instance) => instance.id === instanceId))
    ))
    const validInstanceIds = new Set(instances.map((instance) => instance.id))
    const nextCache = Object.fromEntries(
      Object.entries(instanceContentCacheRef.current).filter(([instanceId]) => validInstanceIds.has(instanceId))
    ) as InstanceContentCache
    instanceContentCacheRef.current = nextCache
    setInstanceContentCache(nextCache)
  }, [instances, selectedInstanceId])

  useEffect(() => {
    if (!bootReady || activeView !== 'instances' || !currentTarget || gameRunning) return

    const timer = window.setTimeout(() => {
      refreshUpdateSummaries([currentTarget])
    }, 700)

    return () => window.clearTimeout(timer)
  }, [bootReady, activeView, currentTarget?.id, currentTarget?.version, currentTarget?.loader, currentTarget?.loaderVersion, gameRunning])

  useEffect(() => {
    if (selectedInstanceId) localStorage.setItem(storage.selectedInstance, selectedInstanceId)
    else localStorage.removeItem(storage.selectedInstance)
  }, [selectedInstanceId])

  useEffect(() => {
    if (activeAccountId) localStorage.setItem(storage.activeAccount, activeAccountId)
    else localStorage.removeItem(storage.activeAccount)
    window.electron.setActiveAccountContext(activeAccountId).catch(() => undefined)
  }, [activeAccountId])

  useEffect(() => {
    if (!showAccountMenu) return

    const closeAccountMenu = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && accountMenuRef.current?.contains(target)) return
      setShowAccountMenu(false)
    }

    document.addEventListener('pointerdown', closeAccountMenu)
    return () => document.removeEventListener('pointerdown', closeAccountMenu)
  }, [showAccountMenu])

  useEffect(() => {
    if (!instanceActionMenuOpen) return

    const closeInstanceActionMenu = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && instanceActionMenuRef.current?.contains(target)) return
      setInstanceActionMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeInstanceActionMenu)
    return () => document.removeEventListener('pointerdown', closeInstanceActionMenu)
  }, [instanceActionMenuOpen])

  useEffect(() => {
    if (!showInstanceSettings) return
    if (instanceSettingsTab !== 'installation' && !instanceSettingsEditingInstallation) return
    void ensureMinecraftVersionList()
  }, [showInstanceSettings, instanceSettingsTab, instanceSettingsEditingInstallation])

  useEffect(() => {
    if (!showInstanceSettings) return
    if (instanceSettingsDraft.loader === 'vanilla') {
      setInstanceSettingsLoaderVersions([])
      setInstanceSettingsLoaderVersionsLoading(false)
      setInstanceSettingsDraft((prev) => prev.loaderVersion ? { ...prev, loaderVersion: '' } : prev)
      return
    }
    if (!instanceSettingsDraft.version.trim()) {
      setInstanceSettingsLoaderVersions([])
      setInstanceSettingsLoaderVersionsLoading(false)
      return
    }

    let cancelled = false
    setInstanceSettingsLoaderVersionsLoading(true)
    window.electron.getLoaderVersions(instanceSettingsDraft.loader, instanceSettingsDraft.version)
      .then((items) => {
        if (cancelled) return
        setInstanceSettingsLoaderVersions(items)
        setInstanceSettingsDraft((prev) => {
          if (prev.loader !== instanceSettingsDraft.loader || prev.version !== instanceSettingsDraft.version) return prev
          if (items.some((item) => item.id === prev.loaderVersion)) return prev
          return { ...prev, loaderVersion: items[0]?.id || '' }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setInstanceSettingsLoaderVersions([])
          setStatusText(tf('status.loaderVersionsFailed', {
            loader: instanceSettingsDraft.loader,
            error: t('status.unknownError')
          }))
        }
      })
      .finally(() => {
        if (!cancelled) setInstanceSettingsLoaderVersionsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [showInstanceSettings, instanceSettingsDraft.loader, instanceSettingsDraft.version])

  useEffect(() => {
    if (!selectedScreenshot) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeScreenshotViewer()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [selectedScreenshot?.id])

  useEffect(() => {
    if (!libraryProjectDetails) return
    const dialog = libraryProjectDialogRef.current
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>('[data-dialog-autofocus="true"]')?.focus()
    })

    const handleLibraryProjectDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLibraryProjectDetails()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleLibraryProjectDialogKey)
    return () => document.removeEventListener('keydown', handleLibraryProjectDialogKey)
  }, [libraryProjectDetails])

  useEffect(() => {
    localStorage.setItem(storage.memoryGb, String(memoryGb))
  }, [memoryGb])

  useEffect(() => {
    if (windowHidden) return
    refreshDiscordStatus().catch(() => undefined)
    const intervalMs = gameRunning ? 60_000 : 30_000
    const timer = window.setInterval(() => {
      refreshDiscordStatus().catch(() => undefined)
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [discordSettings.discordRpcEnabled, gameRunning, windowHidden])

  useEffect(() => {
    let cancelled = false
    const requestedLoader = newInstance.loader
    const requestedVersion = newInstance.version.trim()

    if (requestedLoader === 'vanilla' || !requestedVersion) {
      setLoaderVersions([])
      setNewInstance((prev) => ({ ...prev, loaderVersion: '' }))
      return () => {
        cancelled = true
      }
    }

    setLoaderVersions([])
    setNewInstance((prev) => ({ ...prev, loaderVersion: '' }))

    const loadLoaderVersions = async () => {
      try {
        const compatibility = await window.electron.getLoaderCompatibility(requestedLoader, requestedVersion)
        if (cancelled) return
        if (!compatibility.supported) {
          const recommendedVersion = compatibility.recommendedGameVersion
          if (recommendedVersion) {
            setNewInstance((prev) => (
              prev.loader === requestedLoader && prev.version === requestedVersion
                ? { ...prev, version: recommendedVersion, loaderVersion: '' }
                : prev
            ))
            setStatusText(`Quilt is not available for Minecraft ${requestedVersion}; switched to ${recommendedVersion}`)
          } else {
            setStatusText(`Quilt is not available for Minecraft ${requestedVersion}`)
          }
          return
        }

        const items = await window.electron.getLoaderVersions(requestedLoader, requestedVersion)
        if (cancelled) return
        setLoaderVersions(items)
        setNewInstance((prev) => (
          prev.loader === requestedLoader && prev.version === requestedVersion
            ? { ...prev, loaderVersion: items[0]?.id || '' }
            : prev
        ))
      } catch {
        if (cancelled) return
        setLoaderVersions([])
        setNewInstance((prev) => ({ ...prev, loaderVersion: '' }))
        setStatusText(tf('status.loaderVersionsFailed', {
          loader: requestedLoader,
          error: t('status.unknownError')
        }))
      }
    }

    loadLoaderVersions().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [newInstance.loader, newInstance.version])

  useEffect(() => {
    if (!bootReady || activeView !== 'instances' || instancePanelView !== 'content') return
    if (!currentTarget) {
      setInstanceContent([])
      setContentLoading(false)
      return
    }

    const cached = instanceContentCacheRef.current[currentTarget.id]?.[contentTab]
    if (cached) {
      setInstanceContent(cached)
      setContentLoading(false)
      return
    }

    refreshInstanceContent(contentTab, currentTarget)
  }, [bootReady, activeView, instancePanelView, contentTab, currentTarget?.id, currentTarget?.version, currentTarget?.loader, currentTarget?.loaderVersion])

  useEffect(() => {
    if (contentTab !== 'screenshots') return
    if (activeView === 'instances' && instancePanelView === 'content') return
    setInstanceContent([])
    setSelectedScreenshot(null)
  }, [activeView, instancePanelView, contentTab])

  useEffect(() => {
    manualDownloadStatusesRef.current = manualDownloadStatuses
  }, [manualDownloadStatuses])

  useEffect(() => {
    if (!manualDownloadInstance || manualDownloadItems.length === 0) return

    let cancelled = false
    const checkDownloads = () => {
      manualDownloadItems.forEach((item) => {
        const currentStatus = manualDownloadStatusesRef.current[item.id]
        if (currentStatus === 'complete' || currentStatus === 'checking' || manualDownloadInFlightRef.current.has(item.id)) return

        manualDownloadInFlightRef.current.add(item.id)
        setManualDownloadStatuses((prev) => ({ ...prev, [item.id]: 'checking' }))
        window.electron.importCurseForgeManualDownload({ instance: manualDownloadInstance, item })
          .then((result) => {
            if (cancelled) return
            if (result.imported) {
              setManualDownloadStatuses((prev) => ({ ...prev, [item.id]: 'complete' }))
              setManualDownloadMessage(tf('manualDownload.imported', { file: result.filename || item.filename }))
              const targetTab: InstanceContentKind = item.projectType === 'resourcepack'
                ? 'resourcepacks'
                : item.projectType === 'shader'
                  ? 'shaderpacks'
                  : 'mods'
              refreshInstanceContent(targetTab, manualDownloadInstance).catch(() => undefined)
            } else {
              setManualDownloadStatuses((prev) => ({ ...prev, [item.id]: 'pending' }))
            }
          })
          .catch(() => {
            if (!cancelled) {
              setManualDownloadStatuses((prev) => ({ ...prev, [item.id]: 'failed' }))
              setManualDownloadMessage(tf('manualDownload.importFailed', { file: item.filename }))
            }
          })
          .finally(() => {
            manualDownloadInFlightRef.current.delete(item.id)
          })
      })
    }

    checkDownloads()
    const interval = window.setInterval(checkDownloads, 2500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [manualDownloadInstance?.id, manualDownloadItems])

  useEffect(() => {
    if (!manualDownloadInstance || manualDownloadItems.length === 0) {
      manualDownloadCompletionAnnouncedRef.current = false
      return
    }

    const complete = manualDownloadItems.every((item) => manualDownloadStatuses[item.id] === 'complete')
    if (!complete) {
      manualDownloadCompletionAnnouncedRef.current = false
      return
    }
    if (manualDownloadCompletionAnnouncedRef.current) return
    manualDownloadCompletionAnnouncedRef.current = true

    setProgress(100)
    setStatusText(tf('manualDownload.ready.status', { instance: manualDownloadInstance.name }))
    setActivityDetail(t('manualDownload.ready.detail'))
    setManualDownloadMessage(t('manualDownload.ready.message'))
    refreshInstanceContent('mods', manualDownloadInstance).catch(() => undefined)
    refreshInstanceContent('resourcepacks', manualDownloadInstance).catch(() => undefined)
    refreshInstanceContent('shaderpacks', manualDownloadInstance).catch(() => undefined)
    refreshUpdateSummaries([manualDownloadInstance]).catch(() => undefined)
  }, [manualDownloadInstance?.id, manualDownloadItems, manualDownloadStatuses])

  useEffect(() => {
    setInstancePanelView('content')
    setInstanceContentQuery('')
    setGameLogLines([])
    setGameLogPath('')
    setGameLogLoading(false)
  }, [currentTarget?.id])

  useEffect(() => {
    const cleanup = window.electron.onGameLog((entry) => {
      if (!entry?.line || !currentTarget) return
      if (instancePanelView !== 'logs' || windowHidden) return
      if (entry.instanceId && entry.instanceId !== currentTarget.id) return

      setGameLogLines((prev) => [...prev, entry.line].slice(-800))
    })

    return cleanup
  }, [currentTarget?.id, instancePanelView, windowHidden])

  useEffect(() => {
    if (instancePanelView !== 'logs') return
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [instancePanelView, gameLogLines.length])

  useEffect(() => {
    if (
      !bootReady
      || activeView !== 'home'
      || windowHidden
      || showFirstRunSetup
      || showLegalReview
    ) {
      homeServerStatusRequestIdRef.current += 1
      return
    }

    const seen = new Set<string>()
    const targets: Array<{ key: string; address: string; instance: Instance }> = []
    for (const { instance, quickPlay } of getRecentPlayablePlaces(recentPlaces, instances)) {
      if (quickPlay.type !== 'server') continue
      const key = getHomeServerStatusKey(instance.id, quickPlay.address)
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ key, address: quickPlay.address, instance })
      if (targets.length >= HOME_SERVER_STATUS_MAX_RECENT) break
    }

    if (targets.length === 0) {
      setHomeServerStatuses({})
      setHomeServerStatusesRefreshing(false)
      return
    }

    const requestId = homeServerStatusRequestIdRef.current + 1
    homeServerStatusRequestIdRef.current = requestId
    const cache = homeServerStatusCacheRef.current
    const now = Date.now()

    const initialStatuses: Record<string, HomeServerStatusEntry> = {}
    const pendingTargets = targets.filter((target) => {
      const cached = cache.get(target.key)
      initialStatuses[target.key] = cached?.status || { phase: 'loading' }
      return !cached || cached.expiresAt <= now
    })
    setHomeServerStatuses(initialStatuses)
    setHomeServerStatusesRefreshing(pendingTargets.length > 0)

    let cancelled = false
    let timer = 0
    const isCurrent = () => !cancelled && requestId === homeServerStatusRequestIdRef.current
    const storeCachedStatus = (key: string, status: HomeServerStatusEntry) => {
      cache.delete(key)
      cache.set(key, { status, expiresAt: Date.now() + HOME_SERVER_STATUS_CACHE_TTL_MS })
      while (cache.size > HOME_SERVER_STATUS_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value
        if (typeof oldestKey !== 'string') break
        cache.delete(oldestKey)
      }
    }

    if (pendingTargets.length > 0) {
      timer = window.setTimeout(() => {
        const grouped = new Map<string, { instance: Instance; targets: typeof pendingTargets }>()
        for (const target of pendingTargets) {
          const current = grouped.get(target.instance.id)
          if (current) current.targets.push(target)
          else grouped.set(target.instance.id, { instance: target.instance, targets: [target] })
        }
        const groups = [...grouped.values()]
        let nextGroupIndex = 0

        const pingNextGroup = async () => {
          while (nextGroupIndex < groups.length) {
            const groupIndex = nextGroupIndex
            nextGroupIndex += 1
            const group = groups[groupIndex]
            const addresses = group.targets.map((target) => target.address)
            const inFlightKey = `${group.instance.id}:${addresses.map(normalizeHomeServerAddress).sort().join(',')}`
            let pingRequest = homeServerPingInFlightRef.current.get(inFlightKey)
            if (!pingRequest) {
              const startedRequest = window.electron.pingInstanceServers(group.instance, addresses)
              pingRequest = startedRequest.finally(() => {
                if (homeServerPingInFlightRef.current.get(inFlightKey) === pingRequest) {
                  homeServerPingInFlightRef.current.delete(inFlightKey)
                }
              })
              homeServerPingInFlightRef.current.set(inFlightKey, pingRequest)
            }

            let pings: MinecraftServerPing[] = []
            try {
              pings = await pingRequest
            } catch {
              // A failed scoped request is represented as offline without exposing backend details.
            }
            const pingsByAddress = new Map<string, MinecraftServerPing>()
            for (const ping of pings) {
              pingsByAddress.set(normalizeHomeServerAddress(ping.address), ping)
              for (const requestedAddress of ping.requestedAddresses || []) {
                pingsByAddress.set(normalizeHomeServerAddress(requestedAddress), ping)
              }
            }
            const completedStatuses: Record<string, HomeServerStatusEntry> = {}
            for (const target of group.targets) {
              const ping = pingsByAddress.get(normalizeHomeServerAddress(target.address))
              const status: HomeServerStatusEntry = ping?.online
                ? { phase: 'online', ping }
                : { phase: 'offline', ...(ping ? { ping } : {}) }
              completedStatuses[target.key] = status
              storeCachedStatus(target.key, status)
            }
            if (isCurrent()) {
              setHomeServerStatuses((current) => ({ ...current, ...completedStatuses }))
            }
          }
        }

        void Promise.all(Array.from(
          { length: Math.min(HOME_SERVER_STATUS_CONCURRENCY, groups.length) },
          () => pingNextGroup()
        )).finally(() => {
          if (isCurrent()) setHomeServerStatusesRefreshing(false)
        })
      }, HOME_SERVER_STATUS_DELAY_MS)
    }

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      if (homeServerStatusRequestIdRef.current === requestId) {
        homeServerStatusRequestIdRef.current += 1
      }
    }
  }, [
    activeView,
    bootReady,
    homeServerStatusRefresh,
    instances,
    recentPlaces,
    showFirstRunSetup,
    showLegalReview,
    windowHidden
  ])

  useEffect(() => {
    // Author/creator: nattapat2871 (https://nattapat2871.me)
    if (!bootReady || activeView !== 'home' || homeModpacksLoaded) return

    let cancelled = false
    const requestId = homeModpackRequestIdRef.current + 1
    homeModpackRequestIdRef.current = requestId
    setHomeModpacksLoading(true)
    setHomeModpacksError(false)

    const timer = window.setTimeout(() => {
      window.electron.getHomeModpacks().then((result) => {
        if (cancelled || requestId !== homeModpackRequestIdRef.current) return
        setHomeModpacks(Array.isArray(result?.hits) ? result.hits : [])
        setHomeModpacksLoaded(true)
      }).catch(() => {
        if (cancelled || requestId !== homeModpackRequestIdRef.current) return
        setHomeModpacks([])
        setHomeModpacksError(true)
      }).finally(() => {
        if (!cancelled && requestId === homeModpackRequestIdRef.current) {
          setHomeModpacksLoading(false)
        }
      })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bootReady, activeView, homeModpacksLoaded, homeModpacksRetry])

  useEffect(() => {
    if (activeView !== 'library') return
    window.electron.getCurseForgeConfig()
      .then((config) => setCurseForgeConfigured(config.configured))
      .catch(() => setCurseForgeConfigured(false))
  }, [activeView])

  useEffect(() => {
    if (!bootReady) return
    window.electron.rendererReady().catch(() => undefined)
  }, [bootReady])

  useEffect(() => {
    let cancelled = false
    if (activeView !== 'library') return () => {
      cancelled = true
    }

    const query = normalizeLibrarySearchQuery(modQuery)
    const instanceKey = librarySource === 'curseforge'
      ? [
        currentTarget?.id || 'no-instance',
        currentTarget?.version || '',
        currentTarget?.loader || '',
        currentTarget?.loaderVersion || ''
      ].join('|')
      : 'modrinth'
    const cacheKey = JSON.stringify({
      source: librarySource,
      type: libraryType,
      query,
      page: libraryPage,
      instance: instanceKey,
      filters: resolvedLibraryFilters
    })
    const cached = librarySearchCacheRef.current.get(cacheKey)
    const hasFreshCache = Boolean(cached && Date.now() - cached.storedAt < LIBRARY_SEARCH_CACHE_TTL_MS)

    if (hasFreshCache && cached) {
      setMods(cached.hits)
      setTotalHits(cached.total_hits)
      setLibraryError('')
      setLibraryLoading(false)
    }

    const delay = setTimeout(() => {
      if (activeView !== 'library' || cancelled) return
      if (librarySource === 'curseforge' && !curseForgeConfigured) {
        setMods([])
        setTotalHits(0)
        setLibraryLoading(false)
        return
      }

      setLibraryLoading(!hasFreshCache)
      setLibraryError('')
      const searchTask = librarySource === 'curseforge'
        ? window.electron.searchCurseForge({
          query,
          projectType: libraryType,
          offset: libraryPage * 10,
          limit: 10,
          instance: currentTarget,
          sort: resolvedLibraryFilters.sort === 'relevance' ? 'downloads' : resolvedLibraryFilters.sort,
          gameVersion: resolvedLibraryFilters.gameVersion,
          loader: resolvedLibraryFilters.loader
        })
        : window.electron.searchModrinth({
          query,
          projectType: libraryType,
          offset: libraryPage * 10,
          limit: 10,
          index: resolvedLibraryFilters.sort,
          gameVersion: resolvedLibraryFilters.gameVersion,
          loader: resolvedLibraryFilters.loader,
          environment: resolvedLibraryFilters.environment,
          openSourceOnly: resolvedLibraryFilters.openSourceOnly
        })

      searchTask.then((result) => {
        // Author/creator: nattapat2871 (https://nattapat2871.me)
        if (cancelled || result?.canceled) return
        const hits = Array.isArray(result?.hits) ? result.hits : []
        const total = normalizeLibraryTotalHits(result?.total_hits, hits.length)
        setMods(hits)
        setTotalHits(total)
        librarySearchCacheRef.current.set(cacheKey, { hits, total_hits: total, storedAt: Date.now() })
        while (librarySearchCacheRef.current.size > LIBRARY_SEARCH_CACHE_LIMIT) {
          const oldestKey = librarySearchCacheRef.current.keys().next().value
          if (!oldestKey) break
          librarySearchCacheRef.current.delete(oldestKey)
        }
      }).catch(() => {
        if (cancelled) return
        if (!hasFreshCache) {
          setMods([])
          setTotalHits(0)
          setLibraryError(tf('library.searchFailed', { source: librarySource === 'curseforge' ? 'CurseForge' : 'Modrinth' }))
        }
      }).finally(() => {
        if (!cancelled) setLibraryLoading(false)
      })
    }, hasFreshCache ? 0 : LIBRARY_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(delay)
    }
  }, [
    activeView,
    modQuery,
    libraryType,
    libraryPage,
    librarySource,
    curseForgeConfigured,
    currentTarget?.id,
    currentTarget?.version,
    currentTarget?.loader,
    currentTarget?.loaderVersion,
    resolvedLibraryFilters.sort,
    resolvedLibraryFilters.gameVersion,
    resolvedLibraryFilters.loader,
    resolvedLibraryFilters.environment,
    resolvedLibraryFilters.openSourceOnly
  ])

  useEffect(() => {
    if (activeView !== 'library' || libraryLoading || libraryError) return
    const boundedPage = clampLibraryPage(libraryPage, getLibraryTotalPages(totalHits))
    if (boundedPage !== libraryPage) {
      if (pendingLibraryPageFocusRef.current === libraryPage) {
        pendingLibraryPageFocusRef.current = boundedPage
      }
      setLibraryPage(boundedPage)
    }
  }, [activeView, libraryError, libraryLoading, libraryPage, totalHits])

  useEffect(() => {
    const pendingPage = pendingLibraryPageFocusRef.current
    if (pendingPage === null) return
    if (activeView !== 'library' || libraryError || pendingPage !== libraryPage) {
      pendingLibraryPageFocusRef.current = null
      return
    }
    if (libraryLoading) return

    const frame = window.requestAnimationFrame(() => {
      pendingLibraryPageFocusRef.current = null
      libraryHeadingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeView, libraryError, libraryLoading, libraryPage])

  useEffect(() => {
    installedContentStatusOverridesRef.current = {}
  }, [currentTarget?.id, libraryType, librarySource])

  useEffect(() => {
    if (activeView !== 'library' || mods.length === 0 || (!currentTarget && libraryType !== 'modpack')) {
      setContentStatuses({})
      setContentStatusLoading(false)
      return
    }

    let cancelled = false
    setContentStatusLoading(true)

    const statusTask = librarySource === 'curseforge'
      ? window.electron.getCurseForgeContentStatus({ instance: currentTarget, projects: mods })
      : window.electron.getModrinthContentStatus({ instance: currentTarget, projects: mods })

    statusTask
      .then((statuses) => {
        if (!cancelled) {
          setContentStatuses({ ...statuses, ...installedContentStatusOverridesRef.current })
        }
      })
      .catch(() => {
        if (!cancelled) setContentStatuses({ ...installedContentStatusOverridesRef.current })
      })
      .finally(() => {
        if (!cancelled) setContentStatusLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeView, mods, libraryType, librarySource, currentTarget?.id, currentTarget?.version, currentTarget?.loader, currentTarget?.loaderVersion])

  useEffect(() => {
    const cleanupLauncherError = window.electron.onLauncherErrorReport((report) => {
      setLauncherErrorReport(report)
      setErrorCopyState('idle')
      setErrorSubmitState(submittedErrorReportsRef.current.has(report.id) ? 'sent' : 'idle')
      setErrorSubmitDetail('')
    })

    return cleanupLauncherError
  }, [])

  useEffect(() => {
    const cleanupProgress = window.electron.onLaunchProgress((p) => {
      const launchProgressTypes = new Set([
        'java-setup',
        'java-download',
        'java-extract',
        'auth-refresh',
        'loader-install',
        'loader-download',
        'assets',
        'server-connect',
        'multiplayer-auth-warning',
        'launch-cancelled'
      ])
      if (p.instanceId && p.instanceId !== currentTarget?.id && launchProgressTypes.has(p.type)) return

      setActivityDetail(typeof p.detail === 'string' ? p.detail : '')
      if (p.type === 'java-setup') {
        setStatusText(t('status.javaPreparing'))
        setProgress(4)
      } else if (p.type === 'java-download') {
        setStatusText(p.detail || t('status.javaDownloading'))
        setProgress(p.task)
      } else if (p.type === 'java-extract') {
        setStatusText(p.detail || t('status.javaExtracting'))
        setProgress(p.task)
      } else if (p.type === 'auth-refresh') {
        setStatusText(t('status.sessionRefreshing'))
        setProgress(p.task)
      } else if (p.type === 'loader-install') {
        setStatusText(tf('status.loaderInstalling', { loader: p.detail || t('instance.loader') }))
        setProgress(p.task)
      } else if (p.type === 'loader-download') {
        setStatusText(t('status.loaderDownloading'))
        setProgress(p.task)
      } else if (p.type === 'content-install') {
        const installProgress = Math.min(Math.max(Number(p.task) || 0, 0), 100)
        setModpackInstallActivity((current) => (
          current?.phase === 'installing'
            ? {
                ...current,
                progress: installProgress,
                detail: typeof p.detail === 'string' && p.detail.trim() ? p.detail : current.detail
              }
            : current
        ))
        setStatusText(p.task >= 100
          ? t('content.install.installed')
          : p.detail
            ? tf('content.install.installing', { file: p.detail })
            : t('content.install.generic'))
        setProgress(installProgress)
      } else if (p.type === 'content-cancelled') {
        setModpackInstallActivity((current) => current?.phase === 'installing' ? null : current)
        setStatusText(t('content.install.canceled'))
        setActivityDetail('')
        setProgress(0)
      } else if (p.type === 'content-export') {
        setStatusText(p.task >= 100 ? t('status.exportComplete') : p.detail ? tf('status.exportingDetail', { detail: p.detail }) : t('status.exportPreparing'))
        setProgress(p.task)
      } else if (p.type === 'content-download') {
        setStatusText(p.detail ? `${t('status.contentDownloading')}: ${p.detail}` : t('status.contentDownloading'))
        setProgress(p.task)
      } else if (p.type === 'assets') {
        setStatusText(t('status.assetsDownloading'))
        setProgress(Math.round((p.task / p.total) * 100))
      } else if (p.type === 'server-connect') {
        // ไม่แสดงข้อความ Connecting to server แล้ว
      } else if (p.type === 'multiplayer-auth-warning') {
        setStatusText(t('status.serverAuthWarning'))
      } else if (p.type === 'launch-cancelled') {
        setStatusText(t('status.stopRequested'))
        setActivityDetail(p.detail || '')
        setProgress(0)
      } else if (p.total) {
        setStatusText(t('status.filesPreparing'))
        setProgress(Math.round((p.task / p.total) * 100))
      }
    })

    const cleanupError = window.electron.onLaunchError((error) => {
      setStatusText(t('status.launchFailed'))
      setActivityDetail('')
      if (isMicrosoftSessionExpiredMessage(error) && activeAccount?.type === 'msa') {
        showMicrosoftSessionExpired({
          accountId: activeAccount.id,
          accountName: activeAccount.name,
          message: error
        })
      }
    })

    const cleanupMinecraftGameIssue = window.electron.onMinecraftGameIssue((issue) => {
      setMinecraftGameIssue(issue)
      setStatusText(t('status.launchFailed'))
      setActivityDetail('')
    })

    const cleanupLauncherUpdate = window.electron.onLauncherUpdate((update) => {
      setLauncherUpdate(update)
      if (!update.updateAvailable) {
        setDismissedLauncherUpdateVersion('')
        setLauncherUpdateInstallState('idle')
        setLauncherUpdateProgress(null)
        setLauncherUpdateBlockReason(null)
      }
    })

    const cleanupLauncherUpdateProgress = window.electron.onLauncherUpdateProgress((updateProgress) => {
      setLauncherUpdateProgress(updateProgress)
      if (updateProgress.state === 'downloading') {
        setLauncherUpdateBlockReason(null)
        setLauncherUpdateInstallState('installing')
        setStatusText(t('settings.update.prompt.downloading'))
        setProgress(Math.min(Math.max(Math.round(updateProgress.percent || 0), 0), 100))
        setActivityDetail(updateProgress.detail || '')
      } else if (updateProgress.state === 'opening-installer') {
        setLauncherUpdateInstallState('installing')
        setStatusText(t('settings.update.prompt.opening'))
        setProgress(100)
        setActivityDetail(updateProgress.detail || '')
      } else if (updateProgress.state === 'installer-opened') {
        setLauncherUpdateInstallState('opened')
        setStatusText(t('settings.update.prompt.opened'))
        setProgress(100)
        setActivityDetail(updateProgress.detail || '')
      }
    })

    const cleanupAccountSessionExpired = window.electron.onAccountSessionExpired((payload) => {
      showMicrosoftSessionExpired(payload)
    })

    const cleanupGameState = window.electron.onGameState((state) => {
      if (state.status === 'stopped') {
        if (state.instanceId && state.durationMs) {
          setInstances((prev) => prev.map((instance) => instance.id === state.instanceId
            ? {
                ...instance,
                playtimeSeconds: (instance.playtimeSeconds || 0) + Math.max(0, Math.round(state.durationMs / 1000)),
                lastPlayedAt: new Date().toISOString()
              }
            : instance
          ))
        }

        refreshInstanceContent(contentTab, currentTarget).catch(() => undefined)
      }

      applyGameState(state)
    })

    return () => {
      cleanupProgress()
      cleanupError()
      cleanupMinecraftGameIssue()
      cleanupLauncherUpdate()
      cleanupLauncherUpdateProgress()
      cleanupAccountSessionExpired()
      cleanupGameState()
    }
  }, [activeAccount?.id, activeAccount?.name, activeAccount?.type, contentTab, currentTarget, showMicrosoftSessionExpired])

  useEffect(() => {
    if (!gameRunning || windowHidden) return
    const updateElapsed = () => {
      setRunningElapsedByInstance(Object.fromEntries(
        Object.entries(runningInstances).map(([instanceId, startedAt]) => [
          instanceId,
          Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
        ])
      ))
    }
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [gameRunning, runningInstances, windowHidden])

  const acceptLegalTerms = () => {
    if (!legalDocument || !legalAccepted) return
    localStorage.setItem(storage.legalAcceptance, JSON.stringify({
      version: legalDocument.version,
      acceptedAt: new Date().toISOString()
    }))
    setShowFirstRunSetup(false)
    setStatusText(t('status.ready'))
  }

  const openLegalReview = async () => {
    setShowLegalReview(true)
    try {
      const document = await window.electron.getLegalDocument(language)
      setLegalDocument(document)
    } catch {
      setStatusText(t('status.legalRefreshFailed'))
    }
  }

  const openOfflineLogin = () => {
    setOfflineWarningAccepted(false)
    setOfflineNameInputRejected(false)
    setShowLoginModal(true)
    setLoginStep('offline')
  }

  const handleOfflineNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextName = sanitizeOfflineUsernameInput(event.target.value)
    setOfflineName(nextName)
    setOfflineNameInputRejected(nextName !== event.target.value)
  }

  const handleLogin = async (type: 'microsoft' | 'offline') => {
    if (type === 'offline') {
      openOfflineLogin()
      return
    }

    if (microsoftLoginLoading) return
    setMicrosoftLoginLoading(true)
    setShowAccountMenu(false)
    setStatusText(t('auth.microsoft.loading'))

    try {
      const account = await window.electron.loginMicrosoft()
      setAccounts((prev) => {
        const index = prev.findIndex((item) => item.id === account.id)
        if (index < 0) return [...prev, account]
        const next = [...prev]
        next[index] = account
        return next
      })
      setActiveAccountId(account.id)
      setSessionExpiredNotice(null)
      setShowAccountMenu(false)
      setShowLoginModal(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '')
      const xboxProfileRequired = /Xbox Live rejected this Microsoft account|has an Xbox profile|allowed to use Xbox services|finish profile or family-safety setup/i.test(message)
      setStatusText(t(xboxProfileRequired ? 'auth.microsoft.xboxProfileRequired' : 'auth.microsoft.failed'))
    } finally {
      setMicrosoftLoginLoading(false)
    }
  }

  const confirmOfflineLogin = async () => {
    const username = offlineName.trim()
    if (!isValidOfflineUsername(username)) {
      setOfflineNameInputRejected(true)
      return
    }
    if (!offlineWarningAccepted) {
      setStatusText(t('status.offlineConfirmFirst'))
      return
    }

    try {
      const account = await window.electron.loginOffline(username)
      setAccounts((prev) => {
        const index = prev.findIndex((item) => item.id === account.id)
        if (index < 0) return [...prev, account]
        const next = [...prev]
        next[index] = account
        return next
      })
      setActiveAccountId(account.id)
      setSessionExpiredNotice(null)
      setShowAccountMenu(false)
      setOfflineName('')
      setOfflineNameInputRejected(false)
      setLoginStep('select')
      setShowLoginModal(false)
    } catch {
      setStatusText(t('status.offlineLoginFailed'))
    }
  }

  const removeAccountNow = async (accountId: string) => {
    const nextAccounts = await window.electron.removeAccount(accountId)
    setAccounts(nextAccounts)
    if (activeAccountId === accountId) setActiveAccountId(nextAccounts[0]?.id || null)
    if (nextAccounts.length === 0) setShowAccountMenu(false)
  }

  const removeAccount = (account: Account) => {
    setConfirmDialog({
      title: t('account.remove.title'),
      body: tf('account.remove.body', { name: account.name }),
      confirmLabel: t('account.remove.confirm'),
      cancelLabel: t('account.remove.cancel'),
      danger: true,
      onConfirm: () => removeAccountNow(account.id)
    })
  }

  const rememberRecentPlace = (target: Instance, quickPlay: InstancePlaceQuickPlay, placeLabel?: string) => {
    const recent: RecentInstancePlace = {
      instanceId: target.id,
      instanceName: target.name,
      type: quickPlay.type,
      label: placeLabel || (quickPlay.type === 'server' ? quickPlay.address : quickPlay.folderName),
      ...(quickPlay.type === 'server' ? { address: quickPlay.address } : { folderName: quickPlay.folderName }),
      playedAt: new Date().toISOString()
    }
    const recentTarget = recent.type === 'server' ? recent.address : recent.folderName
    const identity = `${recent.instanceId}:${recent.type}:${String(recentTarget || '').toLocaleLowerCase()}`
    setRecentPlaces((existing) => {
      const next = [recent, ...existing.filter((item) => (
        `${String(item?.instanceId || '')}:${String(item?.type || '')}:${String(item?.type === 'server' ? item.address : item.folderName).toLocaleLowerCase()}` !== identity
      ))].slice(0, 12)
      localStorage.setItem(storage.recentPlaces, JSON.stringify(next))
      return next
    })
  }

  const handleLaunchOrStop = async (
    target: Instance | null = currentTarget,
    quickPlay?: InstancePlaceQuickPlay,
    quickPlayLabel?: string
  ) => {
    if (target && isInstanceBusy(target.id)) {
      await window.electron.stopMinecraft(target)
      setStatusText(t('status.stopRequested'))
      return
    }

    if (launcherUpdate?.updateAvailable) {
      setDismissedLauncherUpdateVersion('')
      setStatusText(t('settings.update.prompt.title'))
      return
    }

    if (!target) {
      setShowInstanceModal(true)
      setStatusText(t('status.createInstanceFirst'))
      return
    }

    if (!activeAccount) {
      setShowLoginModal(true)
      return
    }

    setLaunchingInstanceIds((prev) => prev.includes(target.id) ? prev : [...prev, target.id])
    setProgress(0)
    setStatusText(t('status.launchStarting'))

    try {
      const result = await window.electron.launchMinecraft({
        accountId: activeAccount.id,
        instance: target,
        memoryGb,
        ...(quickPlay ? { quickPlay } : {})
      })
      if (result?.alreadyLaunching) {
        setStatusText(t('status.launchStarting'))
        return
      }
      if (result?.alreadyRunning) {
        setLaunchingInstanceIds((prev) => prev.filter((id) => id !== target.id))
        setProgress(100)
        setStatusText(t('status.ready'))
        return
      }
      if (result?.cancelled) {
        setLaunchingInstanceIds((prev) => prev.filter((id) => id !== target.id))
        setProgress(0)
        setStatusText(t('status.ready'))
        return
      }
      if (quickPlay) rememberRecentPlace(target, quickPlay, quickPlayLabel)
    } catch (error: any) {
      setLaunchingInstanceIds((prev) => prev.filter((id) => id !== target.id))
      setProgress(0)
      const message = error.message || t('status.launchFailed')
      setStatusText(t('status.launchFailed'))
      if (isMicrosoftSessionExpiredMessage(message) && activeAccount?.type === 'msa') {
        showMicrosoftSessionExpired({
          accountId: activeAccount.id,
          accountName: activeAccount.name,
          message
        })
      }
    }
  }

  const handleInstanceIconUpload = async (file?: File | null) => {
    if (!file) return

    try {
      const iconUrl = await readInstanceIconFile(file)
      setNewInstance((prev) => ({ ...prev, iconUrl }))
      setStatusText(t('status.iconAttached'))
    } catch {
      setStatusText(t('status.iconLoadFailed'))
    }
  }

  const openInstanceSettings = (instance: Instance, tab: InstanceSettingsTab = 'general') => {
    setInstanceSettingsTargetId(instance.id)
    setInstanceSettingsTab(tab)
    resetInstanceSettingsDraft(instance)
    setInstanceSettingsEditingInstallation(false)
    setInstanceActionMenuOpen(false)
    setShowInstanceSettings(true)
    void ensureMinecraftVersionList()
  }

  const handleInstanceSettingsIconUpload = async (file?: File | null) => {
    if (!file) return

    try {
      const iconUrl = await readInstanceIconFile(file)
      setInstanceSettingsDraft((prev) => ({ ...prev, iconUrl }))
      setStatusText(t('status.iconAttached'))
    } catch {
      setStatusText(t('status.iconLoadFailed'))
    }
  }

  const saveInstanceSettings = async () => {
    const target = instanceSettingsTarget
    if (!target) return
    if (checkingUpdates || updatingInstanceId === target.id) {
      setStatusText(t('instance.settings.updates.finishFirst'))
      return
    }
    const name = instanceSettingsDraft.name.trim()
    if (!name) {
      setStatusText(t('instance.settings.nameRequired'))
      return
    }
    if (isInstanceBusy(target.id)) {
      setStatusText(t('instance.delete.busy'))
      return
    }
    const version = instanceSettingsDraft.version.trim()
    const loaderVersion = instanceSettingsDraft.loaderVersion.trim()
    if (!version) {
      setStatusText(t('instance.settings.versionRequired'))
      return
    }
    if (instanceSettingsDraft.loader !== 'vanilla' && !loaderVersion) {
      setStatusText(t('instance.settings.loaderVersionRequired'))
      return
    }

    const updates = {
      name,
      version,
      loader: instanceSettingsDraft.loader,
      loaderVersion: instanceSettingsDraft.loader === 'vanilla' ? '' : loaderVersion,
      iconUrl: instanceSettingsDraft.iconUrl || null
    }

    setSavingInstanceSettings(true)
    try {
      const updated = await window.electron.updateInstance({ instance: target, updates })
      setInstances((prev) => prev.map((instance) => instance.id === target.id ? { ...instance, ...updated } : instance))
      setInstanceSettingsTargetId(updated.id)
      setSelectedInstanceId(updated.id)
      setStatusText(t('instance.settings.saved'))
      setInstanceSettingsEditingInstallation(false)
      refreshUpdateSummaries([{ ...target, ...updated }]).catch(() => undefined)
      refreshInstanceContent(contentTab, { ...target, ...updated }, { silent: true, force: true }).catch(() => undefined)
    } catch {
      setStatusText(t('instance.settings.saveFailed'))
    } finally {
      setSavingInstanceSettings(false)
    }
  }

  const createInstance = async () => {
    if (!newInstance.name.trim()) return
    if (!newInstance.version) return
    if (newInstance.loader !== 'vanilla' && !newInstance.loaderVersion) return

    const instance: Instance = {
      id: crypto.randomUUID?.() || String(Date.now()),
      name: newInstance.name.trim(),
      version: newInstance.version,
      loader: newInstance.loader,
      loaderVersion: newInstance.loaderVersion,
      createdAt: new Date().toISOString(),
      iconUrl: newInstance.iconUrl || null,
      playtimeSeconds: 0
    }

    try {
      await window.electron.provisionInstance(instance)
      setInstances((prev) => [...prev, instance])
      setSelectedInstanceId(instance.id)
      setShowInstanceModal(false)
      setNewInstance((prev) => ({ ...prev, name: 'New Instance', iconUrl: '' }))
      setStatusText(t('status.instancePrepared'))
    } catch {
      setStatusText(t('status.instancePrepareFailed'))
    }
  }

  const deleteInstanceFiles = async (
    instance: Instance,
    statusDeleting = t('instance.delete.deleting'),
    statusDeleted = t('instance.delete.deleted')
  ) => {
    if (isInstanceBusy(instance.id)) {
      setStatusText(t('instance.delete.busy'))
      return
    }

    setDeletingInstanceId(instance.id)
    setStatusText(statusDeleting)

    try {
      await window.electron.deleteInstance(instance)
      setInstances((prev) => prev.filter((item) => item.id !== instance.id))
      if (selectedInstanceId === instance.id) {
        setSelectedInstanceId(null)
        setInstanceContent([])
      }
      setStatusText(statusDeleted)
    } catch {
      setStatusText(t('status.instanceDeleteFailed'))
    } finally {
      setDeletingInstanceId(null)
    }
  }

  const deleteInstance = (instance: Instance) => {
    if (isInstanceBusy(instance.id)) {
      setStatusText(t('instance.delete.busy'))
      return
    }
    setConfirmDialog({
      title: t('instance.delete.title'),
      body: tf('instance.delete.body', { name: instance.name }),
      confirmLabel: t('instance.delete.confirm'),
      cancelLabel: t('instance.delete.cancel'),
      danger: true,
      onConfirm: () => deleteInstanceFiles(instance)
    })
  }

  const exportInstanceMrpack = async (instance: Instance) => {
    if (isInstanceBusy(instance.id)) {
      setStatusText(t('status.exportStopGame'))
      return
    }

    setExportingInstanceId(instance.id)
    setProgress(8)
    setStatusText(t('status.exportPreparing'))
    setActivityDetail(instance.name)

    try {
      const result = await window.electron.exportInstanceMrpack(instance)
      if (result.canceled) {
        setStatusText(t('status.exportCanceled'))
        return
      }

      const total = result.totalFiles ?? 0
      const modrinth = result.modrinthFiles ?? 0
      const overrides = result.overrideFiles ?? 0
      setStatusText(tf('status.exportDone', { name: instance.name }))
      setActivityDetail(`${total} files / ${modrinth} Modrinth / ${overrides} local`)
    } catch {
      setStatusText(t('status.exportFailed'))
      setActivityDetail('')
    } finally {
      setExportingInstanceId(null)
      setProgress(0)
    }
  }

  const canInstallLibraryType = (type: string) => {
    if (type === 'modpack') return true
    if (!currentTarget) return false
    if (type === 'mod') return currentTarget.loader !== 'vanilla'
    return true
  }

  const closeLibraryProjectDetails = () => {
    const trigger = libraryProjectTriggerRef.current
    setLibraryProjectDetails(null)
    setLibraryProjectVersions([])
    setSelectedLibraryVersionId('')
    setLibraryProjectVersionError('')
    setLibraryProjectVersionsLoading(false)
    libraryProjectTriggerRef.current = null
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
  }

  const openModpackInstaller = async (project: any) => {
    const projectId = getProjectKey(project)
    if (!projectId) return

    if (modpackInstallActivity?.phase === 'installing') {
      modpackInstallMinimizedRef.current = false
      setShowModpackModal(true)
      setModpackInstallActivity((current) => current ? { ...current, minimized: false } : current)
      setStatusText(t('modpack.install.alreadyRunning'))
      return
    }

    setModpackInstallActivity(null)
    setModpackProject(project)
    setShowModpackModal(true)
    setModpackVersions([])
    setSelectedModpackVersionId('')
    setModpackVersionsLoading(true)
    setStatusText(t('modpack.install.loadingVersionsStatus'))

    try {
      const loadedVersions = project.provider === 'curseforge'
        ? await window.electron.getCurseForgeModpackVersions({ project })
        : await window.electron.getModrinthProjectVersions({
          project,
          projectType: 'modpack'
        })
      setModpackVersions(loadedVersions)
      setSelectedModpackVersionId(loadedVersions[0]?.id || '')
      setStatusText(loadedVersions.length > 0 ? t('modpack.install.chooseVersion') : t('modpack.install.noVersions'))
    } catch {
      setStatusText(t('modpack.install.versionError'))
    } finally {
      setModpackVersionsLoading(false)
    }
  }

  const applyInstalledModpackResult = async (
    result: ModpackInstallResult,
    label = t('library.button.installed'),
    options: { shouldOpenInstance?: () => boolean } = {}
  ) => {
    if (!result.instance) throw new Error('Modpack installer did not return an instance.')

    setInstances((prev) => (
      prev.some((item) => item.id === result.instance!.id)
        ? prev.map((item) => item.id === result.instance!.id ? result.instance! : item)
        : [...prev, result.instance!]
    ))
    await refreshInstanceContent('mods', result.instance)
    if (options.shouldOpenInstance?.() ?? true) {
      setSelectedInstanceId(result.instance.id)
      setContentTab('mods')
      setActiveView('instances')
    }
    setProgress(100)
    const manualDownloads = result.manualDownloads || []
    if (manualDownloads.length > 0) {
      setManualDownloadInstance(result.instance)
      setManualDownloadItems(manualDownloads)
      setManualDownloadDirectory(result.manualDownloadDirectory || '')
      setManualDownloadStatuses(Object.fromEntries(manualDownloads.map((item) => [item.id, 'pending'])))
      setManualDownloadMessage('')
      manualDownloadCompletionAnnouncedRef.current = false
    }
    const incompatibleOptionalFiles = result.incompatibleOptionalFiles || []
    setActivityDetail(manualDownloads.length > 0
      ? tf('manualDownload.needBrowser', { count: manualDownloads.length })
      : incompatibleOptionalFiles.length > 0
        ? tf('modpack.install.skippedIncompatible', {
            count: incompatibleOptionalFiles.length,
            version: result.instance.version,
            files: incompatibleOptionalFiles.map((file) => file.split(/[\\/]/).pop() || file).join(', ')
          })
      : result.blockedFiles?.length
        ? `Skipped ${result.blockedFiles.length} CurseForge file${result.blockedFiles.length > 1 ? 's' : ''} blocked by author distribution settings`
      : '')
    setStatusText(`${label} ${result.instance.name}${result.version ? ` ${result.version}` : ''}`)
    refreshUpdateSummaries([result.instance])
  }

  const openManualDownload = (item: ManualCurseForgeDownloadItem) => {
    window.electron.openExternal(item.fileUrl || item.websiteUrl)
  }

  const copyManualDownloadLink = async (item: ManualCurseForgeDownloadItem) => {
    try {
      await window.electron.copyToClipboard(item.fileUrl || item.websiteUrl)
      setManualDownloadMessage(tf('manualDownload.copied', { title: item.title }))
    } catch {
      setManualDownloadMessage(t('manualDownload.copyFailed'))
    }
  }

  const openAllManualDownloads = () => {
    manualDownloadItems
      .filter((item) => manualDownloadStatuses[item.id] !== 'complete')
      .forEach((item) => window.electron.openExternal(item.fileUrl || item.websiteUrl))
  }

  const closeManualDownloads = () => {
    setManualDownloadItems([])
    setManualDownloadInstance(null)
    setManualDownloadStatuses({})
    setManualDownloadMessage('')
    manualDownloadCompletionAnnouncedRef.current = false
  }

  const cancelManualDownloadsAndDeleteInstance = () => {
    if (!manualDownloadInstance) {
      closeManualDownloads()
      return
    }
    const instance = manualDownloadInstance
    setConfirmDialog({
      title: t('manualDownload.cancel.title'),
      body: tf('manualDownload.cancel.body', { name: instance.name }),
      confirmLabel: t('manualDownload.cancel.confirm'),
      cancelLabel: t('manualDownload.cancel.keep'),
      danger: true,
      onConfirm: async () => {
        closeManualDownloads()
        await deleteInstanceFiles(
          instance,
          t('manualDownload.cancel.deleting'),
          t('manualDownload.cancel.deleted')
        )
      }
    })
  }

  const dismissConfirmDialog = () => {
    if (confirmDialogBusy) return
    setConfirmDialogError('')
    setConfirmDialog(null)
  }

  const confirmDialogConfirm = async () => {
    if (!confirmDialog || confirmDialogBusy) return
    setConfirmDialogBusy(true)
    setConfirmDialogError('')
    try {
      await confirmDialog.onConfirm()
      setConfirmDialog(null)
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : t('confirm.actionFailed')
      setConfirmDialogError(message)
      setStatusText(message)
    } finally {
      setConfirmDialogBusy(false)
    }
  }

  const createInstallTaskId = (prefix: string) => {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    return `${prefix}-${id}`
  }

  const isUserCancelledInstall = (taskId: string) => cancelledInstallTasksRef.current.has(taskId)

  const closeModpackInstaller = () => {
    modpackInstallMinimizedRef.current = false
    setShowModpackModal(false)
    setModpackProject(null)
    setModpackVersions([])
    setSelectedModpackVersionId('')
    setModpackInstallActivity((current) => current?.phase === 'installing' ? current : null)
  }

  const openLibraryProjectDetails = async (project: any, trigger: HTMLButtonElement) => {
    const projectType = project.project_type || libraryType
    if (projectType === 'modpack') {
      await openModpackInstaller(project)
      return
    }
    if (!currentTarget) {
      setStatusText(t('status.createOrSelectInstance'))
      return false
    }

    libraryProjectTriggerRef.current = trigger
    setLibraryProjectDetails(project)
    setLibraryProjectVersions([])
    setSelectedLibraryVersionId('')
    setLibraryProjectVersionError('')
    setLibraryProjectVersionsLoading(true)
    try {
      const versions = project.provider === 'curseforge'
        ? await window.electron.getCurseForgeProjectVersions({ instance: currentTarget, project })
        : await window.electron.getModrinthProjectVersions({
          instance: currentTarget,
          project,
          projectType
        })
      setLibraryProjectVersions(versions)
      setSelectedLibraryVersionId(versions[0]?.id || '')
    } catch (error) {
      setLibraryProjectVersionError(error instanceof Error ? error.message : t('library.detail.loadFailed'))
    } finally {
      setLibraryProjectVersionsLoading(false)
    }
  }

  const minimizeActiveModpackInstall = () => {
    if (modpackInstallActivity?.phase !== 'installing') return
    modpackInstallMinimizedRef.current = true
    setShowModpackModal(false)
    setModpackInstallActivity((current) => (
      current?.phase === 'installing' ? { ...current, minimized: true } : current
    ))
  }

  const restoreModpackInstall = () => {
    if (!modpackInstallActivity || modpackInstallActivity.phase === 'success' || !modpackProject) return
    modpackInstallMinimizedRef.current = false
    setModpackInstallActivity((current) => current ? { ...current, minimized: false } : current)
    setShowModpackModal(true)
  }

  const dismissModpackInstallActivity = () => {
    if (modpackInstallActivity?.phase === 'installing') return
    closeModpackInstaller()
  }

  const cancelActiveInstall = (taskId = activeInstallTaskId) => {
    if (!taskId) return
    modpackInstallMinimizedRef.current = false
    cancelledInstallTasksRef.current.add(taskId)
    setShowModpackModal(false)
    setShowInstanceModal(false)
    setModpackProject(null)
    setModpackVersions([])
    setSelectedModpackVersionId('')
    setModpackInstallActivity((current) => current?.taskId === taskId ? null : current)
    setInstallingProjectId(null)
    setActiveInstallTaskId(null)
    setProgress(0)
    setStatusText(t('content.install.canceled'))
    setActivityDetail('')
    window.electron.cancelInstallTask(taskId).catch(() => undefined)
  }

  const installSelectedModpack = async () => {
    if (!modpackProject || !selectedModpackVersionId) return

    const projectId = getProjectKey(modpackProject)
    if (activeInstallTaskId || (installingProjectId && installingProjectId !== projectId)) {
      setStatusText(t('content.install.anotherRunning'))
      return
    }
    const taskId = createInstallTaskId('modpack')
    const projectTitle = String(modpackProject.title || modpackProject.name || t('modpack.install.title'))
    const projectIconUrl = typeof modpackProject.icon_url === 'string' ? modpackProject.icon_url : undefined
    modpackInstallMinimizedRef.current = false
    cancelledInstallTasksRef.current.delete(taskId)
    setInstallingProjectId(projectId)
    setActiveInstallTaskId(taskId)
    setModpackInstallActivity({
      taskId,
      projectId,
      title: projectTitle,
      iconUrl: projectIconUrl,
      phase: 'installing',
      progress: 0,
      detail: selectedModpackVersion?.version_number || t('modpack.install.preparingSelected'),
      minimized: false
    })
    setProgress(0)
    setStatusText(t('modpack.install.status'))
    setActivityDetail(t('modpack.install.preparingSelected'))

    try {
      const result = modpackProject.provider === 'curseforge'
        ? await window.electron.installCurseForgeModpack({
          project: modpackProject,
          fileId: selectedModpackVersionId,
          taskId,
          playerName: activeAccount?.name,
          accountType: activeAccount?.type
        })
        : await window.electron.installModrinthModpack({
          project: modpackProject,
          projectType: 'modpack',
          versionId: selectedModpackVersionId,
          taskId,
          playerName: activeAccount?.name,
          accountType: activeAccount?.type
        })
      if (result.canceled || result.cancelled || isUserCancelledInstall(taskId)) {
        setStatusText(t('content.install.canceled'))
        setActivityDetail('')
        setProgress(0)
        return
      }

      await applyInstalledModpackResult(result, t('library.button.installed'), {
        shouldOpenInstance: () => !modpackInstallMinimizedRef.current
      })
      setModpackInstallActivity((current) => (
        current?.taskId === taskId
          ? {
              ...current,
              phase: 'success',
              progress: 100,
              detail: result.manualDownloads?.length
                ? tf('manualDownload.needBrowser', { count: result.manualDownloads.length })
                : tf('modpack.install.completedDetail', { name: result.instance?.name || projectTitle }),
              minimized: true
            }
          : current
      ))
      setShowModpackModal(false)
      setModpackProject(null)
      setModpackVersions([])
      setSelectedModpackVersionId('')
    } catch {
      if (isUserCancelledInstall(taskId)) {
        setModpackInstallActivity((current) => current?.taskId === taskId ? null : current)
        setStatusText(t('content.install.canceled'))
        setActivityDetail('')
      } else {
        setModpackInstallActivity((current) => (
          current?.taskId === taskId
            ? { ...current, phase: 'error', detail: t('modpack.install.failedDetail') }
            : current
        ))
        setStatusText(t('status.installFailed'))
        setActivityDetail('')
      }
      setProgress(0)
    } finally {
      setInstallingProjectId(null)
      setActiveInstallTaskId((current) => current === taskId ? null : current)
      cancelledInstallTasksRef.current.delete(taskId)
    }
  }

  const importLocalMrpack = async () => {
    if (importingMrpack) return
    if (activeInstallTaskId || installingProjectId) {
      setStatusText(t('content.install.anotherRunning'))
      return
    }

    const taskId = createInstallTaskId('mrpack')
    cancelledInstallTasksRef.current.delete(taskId)
    setImportingMrpack(true)
    setActiveInstallTaskId(taskId)
    setProgress(0)
      setStatusText(t('status.chooseMrpack'))
    setActivityDetail('Waiting for file selection')

    try {
      const result = await window.electron.installLocalMrpack({ taskId })
      if (result.canceled || result.cancelled || isUserCancelledInstall(taskId)) {
        setStatusText(t('status.importCanceled'))
        setActivityDetail('')
        return
      }

      setStatusText(t('status.localMrpackInstalling'))
      await applyInstalledModpackResult(result, t('status.imported'))
      setShowInstanceModal(false)
    } catch {
      if (isUserCancelledInstall(taskId)) {
        setStatusText(t('status.importCanceled'))
        setActivityDetail('')
      } else {
        setStatusText(t('status.importFailed'))
        setActivityDetail('')
      }
      setProgress(0)
    } finally {
      setImportingMrpack(false)
      setActiveInstallTaskId((current) => current === taskId ? null : current)
      cancelledInstallTasksRef.current.delete(taskId)
    }
  }

  const selectLibrarySource = (source: LibrarySource) => {
    setLibrarySource(source)
    if (source === 'curseforge') {
      setLibraryFilters((current) => ({
        ...current,
        sort: current.sort === 'relevance' ? 'downloads' : current.sort
      }))
    }
    setLibraryPage(0)
    setMods([])
    setTotalHits(0)
    setLibraryError('')
  }

  const updateLibraryFilters = (updates: Partial<LibrarySearchFilters>) => {
    setLibraryFilters((current) => ({ ...current, ...updates }))
    setLibraryPage(0)
    setLibraryError('')
  }

  const resetLibraryFilters = () => {
    setLibraryFilters({
      ...DEFAULT_LIBRARY_SEARCH_FILTERS,
      compatibleOnly: false
    })
    setLibraryPage(0)
    setLibraryError('')
  }

  const installLibraryProject = async (project: any, selectedVersionId = ''): Promise<boolean> => {
    const projectId = getProjectKey(project)
    const projectType = project.project_type || libraryType
    const status = contentStatuses[projectId]

    if (projectType === 'modpack') {
      openModpackInstaller(project)
      return false
    }

    if (modpackInstallActivity?.phase === 'installing') {
      setStatusText(t('modpack.install.alreadyRunning'))
      return false
    }

    if (!currentTarget) {
      setStatusText(t('status.createOrSelectInstance'))
      return false
    }

    if (shouldBlockCurrentTargetContent(projectType)) {
      setStatusText(t('content.toggle.busy'))
      return false
    }

    if (status?.state === 'installed') {
      setStatusText(t('status.contentAlreadyInstalled'))
      return false
    }

    if (!projectId || !canInstallLibraryType(projectType)) {
      setStatusText(projectType === 'mod'
        ? t('library.install.needLoader')
        : t('library.install.unsupported')
      )
      return false
    }

    setInstallingProjectId(projectId)
    setProgress(0)
    setStatusText(t('content.install.generic'))

    try {
      const result = project.provider === 'curseforge'
        ? await window.electron.installCurseForgeContent({
          instance: currentTarget,
          project,
          fileId: selectedVersionId || undefined,
          playerName: activeAccount?.name,
          accountType: activeAccount?.type
        })
        : await window.electron.installModrinthContent({
          instance: currentTarget,
          project,
          projectType,
          versionId: selectedVersionId || undefined,
          playerName: activeAccount?.name,
          accountType: activeAccount?.type
        })
      const installedCount = result.installed.filter((item) => !item.skipped).length
      const skippedCount = result.installed.length - installedCount
      setStatusText(skippedCount > 0 && installedCount === 0 ? t('status.contentAlreadyInstalled') : tf('library.status.installedVersion', { version: result.version }))
      setProgress(100)
      const installedVersion = result.version || status?.latestVersion || status?.installedVersion || null
      const installedVersionId = selectedVersionId || status?.latestVersionId || status?.installedVersionId || null
      const installedStatus: ContentStatus = {
        state: status?.latestVersionId && installedVersionId !== status.latestVersionId ? 'update' : 'installed',
        installedVersion,
        installedVersionId,
        latestVersion: status?.latestVersion || installedVersion,
        latestVersionId: status?.latestVersionId || status?.installedVersionId || null
      }
      installedContentStatusOverridesRef.current = {
        ...installedContentStatusOverridesRef.current,
        [projectId]: installedStatus
      }
      setContentStatuses((prev) => ({ ...prev, [projectId]: installedStatus }))

      const statusTask = project.provider === 'curseforge'
        ? window.electron.getCurseForgeContentStatus({ instance: currentTarget, projects: mods })
        : window.electron.getModrinthContentStatus({ instance: currentTarget, projects: mods })
      statusTask
        .then((statuses) => setContentStatuses({ ...statuses, ...installedContentStatusOverridesRef.current }))
        .catch(() => undefined)
      refreshUpdateSummaries([currentTarget])

      const installedContentTab = projectType === 'resourcepack'
        ? 'resourcepacks'
        : projectType === 'shader'
          ? 'shaderpacks'
          : 'mods'
      if (installedContentTab === contentTab) {
        refreshInstanceContent(installedContentTab, currentTarget)
      }
      return true
    } catch {
      setStatusText(t('status.installFailed'))
      setProgress(0)
      return false
    } finally {
      setInstallingProjectId(null)
    }
  }

  const setProjectUpdateBusy = (projectId: string, busy: boolean) => {
    const next = new Set(updatingProjectIdsRef.current)
    if (busy) next.add(projectId)
    else next.delete(projectId)
    updatingProjectIdsRef.current = next
    setUpdatingProjectIds([...next])
  }

  const beginContentUpdate = (target: Instance, projectId: string) => {
    activeContentUpdatesRef.current += 1
    setUpdatingInstanceId(target.id)
    setUpdatingProjectId(projectId)
    setInstallingProjectId(projectId)
    setProjectUpdateBusy(projectId, true)
  }

  const finishContentUpdate = (projectId: string) => {
    activeContentUpdatesRef.current = Math.max(0, activeContentUpdatesRef.current - 1)
    setProjectUpdateBusy(projectId, false)
    if (activeContentUpdatesRef.current === 0) {
      setUpdatingInstanceId(null)
      setUpdatingProjectId(null)
      setInstallingProjectId(null)
    }
  }

  const installContentUpdate = async (target: Instance, update: ContentUpdateItem) => {
    if (update.provider === 'curseforge') {
      return window.electron.installCurseForgeContent({
        instance: target,
        playerName: activeAccount?.name,
        accountType: activeAccount?.type,
        project: {
          id: update.projectId.replace(/^curseforge:/i, ''),
          project_id: update.projectId,
          title: update.title,
          icon_url: update.iconUrl || null,
          project_type: update.projectType,
          provider: 'curseforge'
        }
      })
    }

    return window.electron.installModrinthContent({
      instance: target,
      project: {
        project_id: update.projectId,
        title: update.title,
        project_type: update.projectType,
        icon_url: update.iconUrl || null
      },
      projectType: update.projectType,
      playerName: activeAccount?.name,
      accountType: activeAccount?.type
    })
  }

  const updateInstalledContent = async (target: Instance, update: ContentUpdateItem) => {
    if (updatingProjectIdsRef.current.has(update.projectId)) return
    if (installingProjectId || modpackInstallActivity?.phase === 'installing') {
      setStatusText(t('content.install.anotherRunning'))
      return false
    }
    if (shouldBlockContentMutation(target.id, update.projectType)) {
      setStatusText(t('content.update.busy'))
      return
    }

    beginContentUpdate(target, update.projectId)
    setProgress(0)
    setStatusText(tf('status.updatingContent', { title: update.title }))

    try {
      await installContentUpdate(target, update)
      setProgress(100)
      setInstanceUpdateSummaries((prev) => {
        const summary = prev[target.id]
        if (!summary) return prev
        return {
          ...prev,
          [target.id]: {
            ...summary,
            updates: summary.updates.filter((item) => item.projectId !== update.projectId)
          }
        }
      })
      if (currentTarget?.id === target.id) {
        await refreshInstanceContent(contentTab, target)
      }
      await refreshUpdateSummaries([target])
      setStatusText(tf('status.updatedContent', { title: update.title }))
    } catch {
      setStatusText(t('status.updateFailed'))
      setProgress(0)
    } finally {
      finishContentUpdate(update.projectId)
    }
  }

  const updateAllContent = async (target: Instance, requestedUpdates?: ContentUpdateItem[]) => {
    if (updatingInstanceId === target.id || activeContentUpdatesRef.current > 0) return
    if (requestedUpdates && isInstanceBusy(target.id)) {
      setStatusText(t('instance.settings.updates.locked'))
      return false
    }
    if (installingProjectId || modpackInstallActivity?.phase === 'installing') {
      setStatusText(t('content.install.anotherRunning'))
      return false
    }
    let updates = requestedUpdates ? [...requestedUpdates] : (instanceUpdateSummaries[target.id]?.updates || [])
    if (!requestedUpdates && updates.length === 0) {
      const summary = await window.electron.getInstanceUpdateSummary(target)
      updates = summary.updates
      setInstanceUpdateSummaries((prev) => ({ ...prev, [target.id]: summary }))
    }

    const blockedModUpdates = updates.filter((update) => shouldBlockContentMutation(target.id, update.projectType))
    if (blockedModUpdates.length > 0) {
      updates = updates.filter((update) => !shouldBlockContentMutation(target.id, update.projectType))
      if (updates.length === 0) {
        setStatusText(t('content.update.busy'))
        return
      }
    }

    if (updates.length === 0) {
      setStatusText(t('status.allContentUpToDate'))
      return
    }

    setUpdatingInstanceId(target.id)
    setProgress(0)

    try {
      const manualUpdates: ContentUpdateItem[] = []
      const failedUpdates: ContentUpdateItem[] = []
      let updatedCount = 0

      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index]
        setUpdatingProjectId(update.projectId)
        setInstallingProjectId(update.projectId)
        setProjectUpdateBusy(update.projectId, true)
        setStatusText(`${tf('status.updatingContent', { title: update.title })} (${index + 1}/${updates.length})`)
        try {
          await installContentUpdate(target, update)
          updatedCount += 1
        } catch (error) {
          if (update.provider === 'curseforge' && isCurseForgeManualDownloadRequired(error)) {
            manualUpdates.push(update)
          } else {
            failedUpdates.push(update)
          }
        } finally {
          setProjectUpdateBusy(update.projectId, false)
        }
        setProgress(Math.round(((index + 1) / updates.length) * 100))
      }

      setProgress(100)
      setInstanceUpdateSummaries((prev) => ({
        ...prev,
        [target.id]: {
          updates: [...blockedModUpdates, ...manualUpdates, ...failedUpdates],
          checkedAt: new Date().toISOString()
        }
      }))
      if (currentTarget?.id === target.id) {
        await refreshInstanceContent(contentTab, target)
      }
      await refreshUpdateSummaries([target])
      const failedCount = failedUpdates.length + blockedModUpdates.length
      setStatusText(manualUpdates.length > 0 || failedCount > 0
        ? tf('instance.settings.updates.partial', {
            updated: updatedCount,
            manual: manualUpdates.length,
            failed: failedCount
          })
        : tf('instance.settings.updates.updated', { count: updatedCount }))
    } catch {
      setStatusText(t('status.updateAllFailed'))
      setProgress(0)
    } finally {
      setUpdatingInstanceId(null)
      setUpdatingProjectId(null)
      setInstallingProjectId(null)
      updatingProjectIdsRef.current = new Set()
      setUpdatingProjectIds([])
      activeContentUpdatesRef.current = 0
    }
  }

  const installSelectedLibraryVersion = async () => {
    if (!libraryProjectDetails || !selectedLibraryVersionId) return
    const installed = await installLibraryProject(libraryProjectDetails, selectedLibraryVersionId)
    if (installed) closeLibraryProjectDetails()
  }

  const getLibraryButtonState = (project: any) => {
    const projectId = getProjectKey(project)
    const projectType = project.project_type || libraryType
    const status = contentStatuses[projectId]

    if (project.provider === 'curseforge' && project.allow_distribution === false) {
      return {
        kind: 'disabled',
        label: 'Website only',
        disabled: true,
        title: 'This author disabled third-party downloads. Open the CurseForge project page instead.'
      }
    }

    if (installingProjectId === projectId) {
      return {
        kind: 'installing',
        label: 'Installing',
        disabled: true,
        title: projectType === 'modpack' ? 'Installing modpack instance' : 'Installing to selected instance'
      }
    }

    if (installingProjectId || modpackInstallActivity?.phase === 'installing') {
      return {
        kind: 'disabled',
        label: t('content.install.busyLabel'),
        disabled: true,
        title: t('content.install.anotherRunning')
      }
    }

    if (shouldBlockCurrentTargetContent(projectType)) {
      return {
        kind: 'disabled',
        label: 'Game running',
        disabled: true,
        title: 'Stop the game before changing mods in this instance'
      }
    }

    if (projectType === 'modpack') {
      return { kind: 'install', label: t('library.button.install'), disabled: false, title: t('library.button.modpackTitle') }
    }

    if (!canInstallLibraryType(projectType)) {
      return {
        kind: 'disabled',
        label: projectType === 'mod' ? t('library.button.needLoader') : t('library.button.unsupported'),
        disabled: true,
        title: projectType === 'mod' ? t('library.install.needLoader') : t('library.install.unsupported')
      }
    }

    if (status?.state === 'installed') {
      return {
        kind: 'installed',
        label: t('library.button.installed'),
        disabled: true,
        title: status.installedVersion ? tf('library.button.installedVersion', { version: status.installedVersion }) : t('library.button.alreadyInstalled')
      }
    }

    if (status?.state === 'update') {
      return {
        kind: 'update',
        label: t('content.update'),
        disabled: false,
        title: status.latestVersion
          ? tf('library.button.updateTitle', { installed: status.installedVersion || t('library.button.installed'), latest: status.latestVersion })
          : t('library.button.updateInstalled')
      }
    }

    if (status?.state === 'unavailable' || status?.state === 'unsupported') {
      return {
        kind: 'disabled',
        label: 'No version',
        disabled: true,
        title: status.reason || 'No compatible version for this instance'
      }
    }

    return { kind: 'install', label: t('library.button.install'), disabled: false, title: t('library.button.installTitle') }
  }

  const openScreenshotViewer = (item: InstanceContentItem) => {
    if (!item.iconUrl) {
      revealContentFile(item).catch(() => undefined)
      return
    }
    cancelScreenshotPanFrame()
    setSelectedScreenshot(item)
    setScreenshotZoom(1)
    setScreenshotPan({ x: 0, y: 0 })
    setScreenshotDragging(false)
    screenshotDragRef.current = null
  }

  const closeScreenshotViewer = () => {
    cancelScreenshotPanFrame()
    setSelectedScreenshot(null)
    setScreenshotZoom(1)
    setScreenshotPan({ x: 0, y: 0 })
    setScreenshotDragging(false)
    screenshotDragRef.current = null
  }

  const cancelScreenshotPanFrame = () => {
    if (screenshotPanFrameRef.current !== null) {
      window.cancelAnimationFrame(screenshotPanFrameRef.current)
      screenshotPanFrameRef.current = null
    }
    screenshotPanPendingRef.current = null
  }

  const scheduleScreenshotPan = (nextPan: ScreenshotPan) => {
    screenshotPanPendingRef.current = nextPan
    if (screenshotPanFrameRef.current !== null) return

    screenshotPanFrameRef.current = window.requestAnimationFrame(() => {
      screenshotPanFrameRef.current = null
      const pendingPan = screenshotPanPendingRef.current
      screenshotPanPendingRef.current = null
      if (pendingPan) setScreenshotPan(pendingPan)
    })
  }

  const adjustScreenshotZoom = (delta: number) => {
    const next = Math.min(3, Math.max(0.5, Number((screenshotZoom + delta).toFixed(2))))
    setScreenshotZoom(next)
    if (next <= 1) {
      cancelScreenshotPanFrame()
      setScreenshotPan({ x: 0, y: 0 })
      setScreenshotDragging(false)
      screenshotDragRef.current = null
    }
  }

  const resetScreenshotZoom = () => {
    cancelScreenshotPanFrame()
    setScreenshotZoom(1)
    setScreenshotPan({ x: 0, y: 0 })
    setScreenshotDragging(false)
    screenshotDragRef.current = null
  }

  const startScreenshotPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (screenshotZoom <= 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setScreenshotDragging(true)
    screenshotDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: screenshotPan.x,
      originY: screenshotPan.y
    }
  }

  const moveScreenshotPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = screenshotDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    scheduleScreenshotPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    })
  }

  const stopScreenshotPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = screenshotDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const pendingPan = screenshotPanPendingRef.current
    cancelScreenshotPanFrame()
    if (pendingPan) setScreenshotPan(pendingPan)
    screenshotDragRef.current = null
    setScreenshotDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => () => cancelScreenshotPanFrame(), [])

  const toggleContent = async (item: InstanceContentItem) => {
    if (!currentTarget) return
    if (shouldBlockCurrentTargetContent(item.kind)) {
      setStatusText(t('content.toggle.busy'))
      return
    }

    const nextEnabled = !item.enabled
    const optimisticFileName = nextEnabled ? item.enabledFileName : `${item.enabledFileName}.disable`
    setBusyContentId(item.id)
    setStatusText(item.enabled ? t('content.disabling') : t('content.enabling'))
    setInstanceContent((prev) => prev.map((content) => content.id === item.id
      ? { ...content, enabled: nextEnabled, fileName: optimisticFileName }
      : content
    ))

    try {
      const result = await window.electron.toggleInstanceContent({
        instance: currentTarget,
        kind: item.kind,
        fileName: item.fileName,
        contentId: item.id,
        enabled: nextEnabled
      })
      setInstanceContent((prev) => prev.map((content) => content.id === item.id
        ? {
          ...content,
          enabled: result.enabled,
          filePath: result.filePath,
          fileName: result.fileName,
          enabledFileName: result.enabledFileName,
          updatedAt: result.updatedAt
        }
        : content
      ))
      refreshUpdateSummaries([currentTarget]).catch(() => undefined)
      refreshInstanceContent(item.kind, currentTarget, { silent: true, force: true }).catch(() => undefined)
      setStatusText(item.enabled ? t('content.disabled.done') : t('content.enabled.done'))
    } catch (error: any) {
      setInstanceContent((prev) => prev.map((content) => content.id === item.id ? item : content))
      const message = error instanceof Error ? error.message : String(error || '')
      setStatusText(
        /different file already uses the target enabled\/disabled name/i.test(message)
          ? t('status.contentToggleConflict')
          : t('status.contentToggleFailed')
      )
    } finally {
      setBusyContentId(null)
    }
  }

  const deleteContentFiles = async (item: InstanceContentItem, target: Instance) => {
    if (shouldBlockContentMutation(target.id, item.kind)) {
      setStatusText(t('content.delete.busy'))
      return
    }

    setBusyContentId(item.id)
    setStatusText(t('content.delete.deleting'))
    const previousIndex = instanceContent.findIndex((content) => content.id === item.id)
    setInstanceContent((prev) => prev.filter((content) => content.id !== item.id))

    try {
      await window.electron.deleteInstanceContent({
        instance: target,
        kind: item.kind,
        fileName: item.fileName,
        contentId: item.id
      })
      setSelectedScreenshot((current) => current?.id === item.id ? null : current)
      refreshUpdateSummaries([target]).catch(() => undefined)
      refreshInstanceContent(item.kind, target, { silent: true, force: true }).catch(() => undefined)
      setStatusText(t('content.delete.deleted'))
    } catch {
      setInstanceContent((prev) => {
        if (prev.some((content) => content.id === item.id)) return prev
        const next = [...prev]
        next.splice(Math.max(0, previousIndex), 0, item)
        return next
      })
      setStatusText(t('status.contentDeleteFailed'))
    } finally {
      setBusyContentId(null)
    }
  }

  const revealContentFile = async (item: InstanceContentItem) => {
    if (!currentTarget) return
    try {
      await window.electron.revealInstanceContentFile({
        instance: currentTarget,
        kind: item.kind,
        fileName: item.fileName,
        contentId: item.id
      })
    } catch {
      setStatusText(t('status.fileLocationFailed'))
    }
  }

  const importDroppedContentFiles = async (files: File[]) => {
    if (!currentTarget || files.length === 0 || contentImporting) return
    if (shouldBlockCurrentTargetContent(contentTab)) {
      setContentDropActive(false)
      setStatusText(t('content.toggle.busy'))
      return
    }

    const filePaths = window.electron.getDroppedFilePaths(files)
    if (filePaths.length === 0) {
      setContentDropActive(false)
      setStatusText(t('content.drop.unreadable'))
      return
    }

    setContentImporting(true)
    setContentDropActive(false)
    setStatusText(tf('content.import.status', { count: filePaths.length }))

    try {
      const result = await window.electron.importInstanceContentFiles({
        instance: currentTarget,
        kind: contentTab,
        filePaths
      })
      setInstanceContent(result.content)
      updateInstanceContentCache(currentTarget.id, contentTab, result.content)
      refreshUpdateSummaries([currentTarget]).catch(() => undefined)
      const importedCount = result.imported.length
      const rejectedCount = result.rejected.length
      const skippedCount = result.skipped.length
      if (importedCount > 0) {
        setStatusText(tf('content.import.done', { count: importedCount, skipped: rejectedCount + skippedCount }))
      } else {
        setStatusText(rejectedCount > 0 ? tf('content.import.noneCompatible', { label: currentContentTab.label }) : t('content.import.none'))
      }
    } catch {
      setStatusText(t('status.droppedImportFailed'))
    } finally {
      setContentImporting(false)
    }
  }

  const handleContentDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!currentTarget || instancePanelView !== 'content') return
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = shouldBlockCurrentTargetContent(contentTab) ? 'none' : 'copy'
    if (!contentDropActive) setContentDropActive(true)
  }

  const handleContentDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setContentDropActive(false)
  }

  const handleContentDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!currentTarget || instancePanelView !== 'content') return
    event.preventDefault()
    void importDroppedContentFiles(Array.from(event.dataTransfer.files || []))
  }

  const updateLauncherSettings = async (next: LauncherSettings) => {
    setDiscordSettings(next)
    try {
      const saved = await window.electron.setDiscordSettings(next)
      setDiscordSettings({ ...DEFAULT_LAUNCHER_SETTINGS, ...saved })
      await refreshDiscordStatus()
      setStatusText(t('status.settingsUpdated'))
    } catch {
      setStatusText(t('status.settingsUpdateFailed'))
    }
  }

  const focusDiscordAccountSection = () => {
    const section = discordAccountSectionRef.current
    if (!pendingDiscordAccountFocusRef.current || !section || activeView !== 'settings') return
    pendingDiscordAccountFocusRef.current = false
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    section.focus({ preventScroll: true })
  }

  const openDiscordAccountSettings = () => {
    pendingDiscordAccountFocusRef.current = true
    setActiveView('settings')
    // A mounted settings page can scroll immediately; a new one waits for its
    // entrance animation, including AnimatePresence's delayed mount.
    if (activeView === 'settings') focusDiscordAccountSection()
  }

  const connectLauncherDiscord = async () => {
    if (launcherDiscordAccountBusy) return
    setLauncherDiscordAccountBusy(true)
    setLauncherDiscordAccountError('')
    try {
      setLauncherDiscordAccount(await window.electron.connectLauncherDiscordAccount())
    } catch (error) {
      setLauncherDiscordAccountError(error instanceof Error ? error.message : t('settings.discordAccount.failed'))
    } finally {
      setLauncherDiscordAccountBusy(false)
    }
  }

  const checkForLauncherUpdateNow = async () => {
    if (checkingLauncherUpdate) return
    setCheckingLauncherUpdate(true)
    setStatusText(t('settings.update.checking'))
    setActivityDetail('')
    try {
      const update = await window.electron.checkLauncherUpdate()
      setLauncherUpdate(update)
      setDismissedLauncherUpdateVersion('')
      setLauncherUpdateInstallState('idle')
      setLauncherUpdateProgress(null)
      setLauncherUpdateBlockReason(null)
      setStatusText(update.error
        ? t('status.updateCheckFailed')
        : update.updateAvailable
          ? t('settings.update.available')
          : t('settings.update.upToDate'))
    } catch {
      setStatusText(t('status.updateCheckFailed'))
    } finally {
      setCheckingLauncherUpdate(false)
    }
  }

  const disconnectLauncherDiscord = async () => {
    setLauncherDiscordAccountBusy(true)
    setLauncherDiscordAccountError('')
    try {
      setLauncherDiscordAccount(await window.electron.disconnectLauncherDiscordAccount())
    } catch (error) {
      setLauncherDiscordAccountError(error instanceof Error ? error.message : t('settings.discordAccount.failed'))
    } finally {
      setLauncherDiscordAccountBusy(false)
    }
  }

  const requestDisconnectLauncherDiscord = () => {
    if (!launcherDiscordAccount?.connected || launcherDiscordAccountBusy) return
    setConfirmDialog({
      title: t('settings.discordAccount.logoutTitle'),
      body: t('settings.discordAccount.logoutBody'),
      confirmLabel: t('settings.discordAccount.logoutConfirm'),
      cancelLabel: t('settings.discordAccount.logoutCancel'),
      danger: true,
      onConfirm: disconnectLauncherDiscord
    })
  }

  const chooseDataLocation = async () => {
    if (gameRunning || launching) {
      setStatusText(t('status.storageStopGame'))
      return
    }

    setMovingDataLocation(true)
    try {
      const result = await window.electron.chooseLauncherDataLocation({ restartAfterMove: true })
      setDataLocation(result)
      setDataLocationStatus('ready')
      setDataLocationError('')
      if (result.changed) {
        setStatusText(t('status.storageMoved'))
      }
    } catch {
      setStatusText(t('status.storageMoveFailed'))
    } finally {
      setMovingDataLocation(false)
    }
  }

  const handleMemoryChange = (value: number) => {
    setMemoryGb(Math.min(Math.max(value || 1, 1), 32))
  }

  const openInstanceDetail = (instanceId: string) => {
    const navigation = getInstanceDetailNavigation(instanceId)
    if (!navigation) return

    pendingInstanceHeadingFocusRef.current = activeView !== navigation.activeView
      || currentTarget?.id !== navigation.instanceId
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    setSelectedInstanceId(navigation.instanceId)
    setInstancePanelView(navigation.panelView)
    setContentTab(navigation.contentTab)
    setActiveView(navigation.activeView)
    setShowAccountMenu(false)
  }

  const openInstanceModsLibrary = (instanceId: string) => {
    const navigation = getInstanceModsLibraryNavigation(instanceId)
    if (!navigation) return

    pendingLibraryHeadingFocusRef.current = true
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    setSelectedInstanceId(navigation.instanceId)
    setLibraryType(navigation.libraryType)
    setLibraryFilters((current) => ({ ...current, compatibleOnly: true }))
    setLibraryPage(0)
    setLibraryError('')
    setActiveView(navigation.activeView)
    setShowAccountMenu(false)
  }

  const goToLibraryPage = (page: number) => {
    const totalPages = getLibraryTotalPages(totalHits)
    const nextPage = clampLibraryPage(page, totalPages)
    if (nextPage === libraryPage) return
    pendingLibraryPageFocusRef.current = nextPage
    setLibraryLoading(true)
    setLibraryPage(nextPage)
    window.requestAnimationFrame(() => {
      librarySectionRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    })
  }

  const libraryTypes: Array<{ id: LibraryProjectType; label: string }> = [
    { id: 'mod', label: t('library.type.mod') },
    { id: 'modpack', label: t('library.type.modpack') },
    { id: 'resourcepack', label: t('library.type.resourcepack') },
    { id: 'shader', label: t('library.type.shader') }
  ]

  const discordState = discordStatus?.state || (discordSettings.discordRpcEnabled ? 'connecting' : 'disabled')
  const discordStateLabel = discordState === 'connected'
    ? t('settings.discord.connected')
    : discordState === 'native'
      ? t('settings.discord.native')
      : discordState === 'error'
        ? t('settings.discord.error')
        : discordState === 'disabled'
          ? t('settings.discord.disabled')
          : discordState === 'suspended'
            ? t('settings.discord.suspended')
            : t('settings.discord.connecting')
  const discordStateClass = discordState === 'connected' || discordState === 'native'
    ? 'bg-blue-500/15 text-blue-200'
    : discordState === 'error'
      ? 'bg-red-500/15 text-red-200'
      : 'bg-slate-800 text-slate-400'

  const instanceContentTabs: Array<{ id: InstanceContentKind; label: string; folder: string }> = INSTANCE_CONTENT_KINDS.map((id) => ({
    id,
    label: getContentTabLabel(id),
    folder: getContentFolderLabel(id)
  }))
  const currentContentTab = instanceContentTabs.find((tab) => tab.id === contentTab) || instanceContentTabs[0]
  const currentContentCached = Boolean(currentTarget && instanceContentCache[currentTarget.id]?.[contentTab])
  const filteredInstanceContent = filterInstanceContent(instanceContent, instanceContentQuery)
  const showingScreenshots = currentContentTab.id === 'screenshots'
  const selectedModpackVersion = modpackVersions.find((version) => version.id === selectedModpackVersionId) || null
  const selectedLibraryVersion = libraryProjectVersions.find((version) => version.id === selectedLibraryVersionId) || null
  const manualDownloadCompleteCount = manualDownloadItems.filter((item) => manualDownloadStatuses[item.id] === 'complete').length
  const manualDownloadPendingCount = Math.max(0, manualDownloadItems.length - manualDownloadCompleteCount)
  const manualDownloadAllComplete = manualDownloadItems.length > 0 && manualDownloadPendingCount === 0
  const currentUpdateSummary = currentTarget ? instanceUpdateSummaries[currentTarget.id] : null
  const currentUpdates = currentUpdateSummary?.updates || []
  const currentUpdateCount = currentUpdates.length
  const currentNonModUpdateCount = currentUpdates.filter((update) => !isModContentType(update.projectType)).length
  const currentUpdateAllBlocked = currentBusyThisTarget && currentUpdateCount > 0 && currentNonModUpdateCount === 0
  const visibleBootProgress = Math.min(Math.max(Math.round(bootProgress), 0), 100)
  const installingCurrentModpack = Boolean(modpackProject && installingProjectId === getProjectKey(modpackProject))
  const welcomeName = activeAccount?.name || 'Player'
  const recentInstances = [...instances]
    .filter((instance) => instance.lastPlayedAt && Number.isFinite(new Date(instance.lastPlayedAt).getTime()))
    .sort((left, right) => new Date(right.lastPlayedAt!).getTime() - new Date(left.lastPlayedAt!).getTime())
    .slice(0, 4)
  const recentPlayablePlaces = getRecentPlayablePlaces(recentPlaces, instances)
  const onlinePlayers = Math.max(0, Number(launcherStats?.online_players || 0))
  const onlinePlayersText = new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US').format(onlinePlayers)
  const currentLauncherVersion = launcherVersion || launcherUpdate?.currentVersion || '...'
  const currentLauncherChannel = launcherUpdate?.channel || 'stable'
  const launcherUpdatePromptVisible = Boolean(
    launcherUpdate?.updateAvailable
    && (launcherUpdate.mandatory || dismissedLauncherUpdateVersion !== launcherUpdate.latestVersion)
    && !showFirstRunSetup
    && !showLegalReview
    && !launcherErrorReport
  )
  const launcherUpdatePercent = Math.min(Math.max(Math.round(launcherUpdateProgress?.percent || 0), 0), 100)
  const launcherUpdateProgressLabel = launcherUpdateInstallState === 'blocked'
    ? t('settings.update.prompt.blocked')
    : launcherUpdateInstallState === 'failed'
    ? t('settings.update.prompt.failed')
    : launcherUpdateInstallState === 'opened' || launcherUpdateProgress?.state === 'installer-opened'
      ? t('settings.update.prompt.opened')
    : launcherUpdateProgress?.state === 'opening-installer'
      ? t('settings.update.prompt.opening')
    : launcherUpdateProgress?.state === 'downloading'
      ? t('settings.update.prompt.downloading')
      : t('settings.update.prompt.installing')
  const libraryTotalPages = getLibraryTotalPages(totalHits)
  const libraryResultsText = tf('library.results', { count: totalHits.toLocaleString() })
  const libraryPaginationStatusText = tf('library.pagination.status', {
    page: libraryPage + 1,
    pages: libraryTotalPages,
    results: libraryResultsText
  })
  const libraryPaginationLabels = {
    navigation: t('library.pagination.navigation'),
    top: t('library.pagination.top'),
    bottom: t('library.pagination.bottom'),
    previous: t('library.back'),
    next: t('library.next'),
    jumpToPage: t('library.pagination.jump'),
    go: t('library.pagination.go'),
    invalidPage: t('library.pagination.invalid'),
    loading: t('library.pagination.loading'),
    pageButton: (page: number) => tf('library.pagination.page', { page })
  }
  const bootMilestones = [
    { label: 'Data', done: visibleBootProgress >= 24 },
    { label: 'Accounts', done: visibleBootProgress >= 48 },
    { label: 'Versions', done: visibleBootProgress >= 74 },
    { label: 'Ready', done: visibleBootProgress >= 100 }
  ]
  const setupLogRows = bootLog.slice(-7)
  const minecraftVersionOptions = uniqueStrings([
    latestVersion,
    ...versions.map(getMinecraftVersionId)
  ])
  const libraryMinecraftVersionOptions = uniqueStrings([
    currentTarget?.version || '',
    resolvedLibraryFilters.gameVersion,
    ...minecraftVersionOptions.filter((version) => /^[A-Za-z0-9._+\-]{1,40}$/.test(version))
  ]).slice(0, 160)
  const newInstanceGameVersionOptions = uniqueStrings([
    newInstance.version,
    ...minecraftVersionOptions
  ])
  const instanceSettingsGameVersionOptions = uniqueStrings([
    instanceSettingsDraft.version,
    ...minecraftVersionOptions
  ])
  const instanceSettingsLoaderVersionOptions = uniqueStrings([
    instanceSettingsDraft.loaderVersion,
    ...instanceSettingsLoaderVersions.map((loader) => loader.id)
  ])
  const launcherUpdateStepIndex = launcherUpdateInstallState === 'opened'
    ? 2
    : launcherUpdateInstallState === 'installing' && launcherUpdateProgress?.state === 'opening-installer'
      ? 2
    : launcherUpdateInstallState === 'installing' && launcherUpdateProgress?.state === 'downloading'
      ? 1
      : 0
  const launcherUpdateSteps = [
    t('settings.update.prompt.step.prepare'),
    t('settings.update.prompt.step.download'),
    t('settings.update.prompt.step.open')
  ]
  const launcherUpdateStopped = launcherUpdateInstallState === 'blocked' || launcherUpdateInstallState === 'failed'

  const dismissLauncherUpdatePrompt = () => {
    if (!launcherUpdate?.latestVersion || launcherUpdate.mandatory || launcherUpdateInstallState === 'installing') return
    setDismissedLauncherUpdateVersion(launcherUpdate.latestVersion)
  }

  const openLauncherUpdatePrompt = () => {
    if (!launcherUpdate?.updateAvailable || launcherUpdateInstallState === 'installing') return
    setDismissedLauncherUpdateVersion('')
  }

  const openLauncherUpdateDownload = () => {
    if (!launcherUpdate?.downloadUrl) return
    window.electron.openExternal(launcherUpdate.downloadUrl)
  }

  const openPartnerServerWebsite = (server: PartnerServerDefinition) => {
    if (server.id === 'minisand') {
      window.electron.openExternal(MINISAND_PARTNER_URL)
      return
    }
    window.electron.openExternal(server.websiteUrl)
  }

  const getLauncherUpdateBlockMessage = (reason?: LauncherUpdateBlockReason) => {
    if (reason === 'minecraft-active') return t('settings.update.prompt.blocked.minecraft')
    if (reason === 'content-install-active') return t('settings.update.prompt.blocked.content')
    if (reason === 'update-in-progress') return t('settings.update.prompt.blocked.progress')
    if (reason === 'already-current') return t('settings.update.prompt.blocked.current')
    return t('settings.update.prompt.blocked.generic')
  }

  const installLauncherUpdateNow = async () => {
    if (!launcherUpdate?.updateAvailable || launcherUpdateInstallState === 'installing') return
    setLauncherUpdateBlockReason(null)
    setLauncherUpdateInstallState('installing')
    setLauncherUpdateProgress({ state: 'checking', percent: 0, detail: launcherUpdate.latestVersion })
    setStatusText(t('settings.update.prompt.installing'))
    setActivityDetail(`${launcherUpdate.currentVersion} -> ${launcherUpdate.latestVersion}`)

    try {
      const result = await window.electron.installLauncherUpdate()
      if (result.blocked) {
        const message = getLauncherUpdateBlockMessage(result.blockReason)
        setLauncherUpdateBlockReason(result.blockReason || null)
        setLauncherUpdateInstallState('blocked')
        setLauncherUpdateProgress({ state: 'blocked', percent: 0, detail: message })
        setProgress(0)
        setStatusText(message)
        setActivityDetail('')
        return
      }
      if (result.openedDownload) {
        setLauncherUpdateInstallState('idle')
        setStatusText(result.message || t('settings.update.download'))
        return
      }
      if (result.installerOpened) {
        setLauncherUpdateInstallState('opened')
        setLauncherUpdateProgress({
          state: 'installer-opened',
          percent: 100,
          detail: result.message || t('settings.update.prompt.readyNotice')
        })
        setStatusText(t('settings.update.prompt.opened'))
        setActivityDetail('')
        return
      }
      setStatusText(t('settings.update.prompt.opened'))
      setActivityDetail('')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error || '')
      const failureReason = classifyLauncherUpdateFailureMessage(errorMessage)
      const message = failureReason === 'download-invalid'
        ? t('settings.update.prompt.failed.invalid')
        : failureReason === 'download-failed'
          ? t('settings.update.prompt.failed.download')
          : failureReason === 'installer-open-failed'
            ? t('settings.update.prompt.failed.open')
            : t('settings.update.prompt.failed.generic')
      setLauncherUpdateBlockReason(null)
      setLauncherUpdateInstallState('failed')
      setLauncherUpdateProgress({ state: 'failed', percent: launcherUpdatePercent, detail: message })
      setStatusText(message)
      setActivityDetail('')
    }
  }

  useEffect(() => {
    if (!bootReady || activeView !== 'settings' || dataLocationStatus !== 'error') return
    void loadLauncherDataLocation()
  }, [bootReady, activeView])

  const deleteContent = (item: InstanceContentItem) => {
    if (!currentTarget) return
    if (shouldBlockCurrentTargetContent(item.kind)) {
      setStatusText(t('content.delete.busy'))
      return
    }
    const target = currentTarget
    setConfirmDialog({
      title: t('content.delete.title'),
      body: tf('content.delete.body', { name: item.name }),
      confirmLabel: t('content.delete.confirm'),
      cancelLabel: t('content.delete.cancel'),
      danger: true,
      onConfirm: () => deleteContentFiles(item, target)
    })
  }

  const getLauncherErrorReportMetaLines = (report: LauncherErrorReport) => {
    const system = report.system || {}
    const gpu = Array.isArray(system.gpu) ? system.gpu.filter(Boolean).slice(0, 4).join(', ') : ''
    const storageSummary = Array.isArray(system.storage)
      ? system.storage
          .map((device) => [device.model, device.mediaType, device.size].filter(Boolean).join(' / '))
          .filter(Boolean)
          .slice(0, 4)
          .join('; ')
      : ''
    const cpu = [
      system.cpu || '',
      system.cpu_cores ? `${system.cpu_cores} cores` : ''
    ].filter(Boolean).join(' / ')

    return [
      `Player: ${report.playerName || activeAccount?.name || 'unknown'}`,
      `Account type: ${report.accountType || activeAccount?.type || 'unknown'}`,
      `OS: ${system.os || 'unknown'}`,
      `CPU: ${cpu || 'unknown'}`,
      `RAM: ${system.ram_gb ? `${system.ram_gb} GB` : 'unknown'}`,
      `GPU: ${gpu || 'unknown'}`,
      `Storage: ${storageSummary || 'unknown'}`
    ]
  }

  const copyLauncherErrorReport = async () => {
    if (!launcherErrorReport) return
    setErrorCopyState('copying')
    const reportText = [
      'NamLauncher Error Report',
      `Time: ${launcherErrorReport.occurredAt}`,
      `Launcher version: ${launcherErrorReport.launcherVersion || currentLauncherVersion}`,
      `Platform: ${launcherErrorReport.platform || 'unknown'}/${launcherErrorReport.arch || 'unknown'}`,
      `Electron: ${launcherErrorReport.electronVersion || 'unknown'}`,
      ...getLauncherErrorReportMetaLines(launcherErrorReport),
      `Context: ${launcherErrorReport.context}`,
      launcherErrorReport.diagnosis
        ? `Diagnosis: ${launcherErrorReport.diagnosis.code}${launcherErrorReport.diagnosis.culpritMod ? ` (${launcherErrorReport.diagnosis.culpritMod})` : ''}`
        : '',
      `Problem: ${launcherErrorReport.message}`,
      '',
      '--- Full sanitized launcher app.logs ---',
      launcherErrorReport.logs
    ].join('\n')
    try {
      await window.electron.copyErrorReport(reportText)
      setErrorCopyState('copied')
    } catch {
      setErrorCopyState('failed')
    }
  }

  const submitLauncherErrorReport = async () => {
    if (!launcherErrorReport || submittedErrorReportsRef.current.has(launcherErrorReport.id) || errorSubmitState === 'sending') return
    setErrorSubmitState('sending')
    setErrorSubmitDetail('')
    try {
      const result = await window.electron.submitErrorReport({
        reportId: launcherErrorReport.id,
        activeAccountId,
        playerName: activeAccount?.name || null
      })
      if (!result.confirmed) throw new Error(t('launcherError.submit.failedDefault'))
      submittedErrorReportsRef.current.add(launcherErrorReport.id)
      setErrorSubmitState('sent')
      setErrorSubmitDetail(t('launcherError.submit.sentDetail'))
    } catch (error: any) {
      setErrorSubmitState('failed')
      setErrorSubmitDetail(error?.message || t('launcherError.submit.failedDefault'))
    }
  }

  const launcherErrorIsMinecraft = Boolean(launcherErrorReport?.context?.startsWith('minecraft'))
  const launcherErrorTitle = launcherErrorReport?.title || (launcherErrorIsMinecraft
    ? t('launcherError.title.minecraft')
    : t('launcherError.title.launcher'))
  const launcherErrorBody = launcherErrorIsMinecraft
    ? t('launcherError.body.minecraft')
    : t('launcherError.body.launcher')
  const launcherErrorDiagnosis = launcherErrorReport?.diagnosis || null
  const getCrashDiagnosisText = (diagnosis: MinecraftCrashDiagnosis | null) => {
    if (diagnosis?.code === 'jvm-native-memory') return {
      title: t('launcherError.diagnosis.nativeMemory.title'),
      body: t('launcherError.diagnosis.nativeMemory.body')
    }
    const dependency = diagnosis?.dependencyId || 'unknown'
    const required = diagnosis?.requiredVersion || 'a compatible version'
    const installed = diagnosis?.installedVersion || 'unknown version'
    const dependentMods = diagnosis?.dependentMods?.length
      ? diagnosis.dependentMods.join(', ')
      : 'unknown mod'
    const title = diagnosis?.code === 'graphics-memory'
      ? t('launcherError.diagnosis.graphics.title')
      : diagnosis?.code === 'incompatible-mod-mixin'
        ? tf('launcherError.diagnosis.mixin.title', { mod: diagnosis.culpritMod || 'unknown' })
        : diagnosis?.code === 'missing-mod-dependency'
          ? tf('launcherError.diagnosis.dependencyMissing.title', { dependency })
          : diagnosis?.code === 'incompatible-mod-dependency'
            ? tf('launcherError.diagnosis.dependencyVersion.title', { dependency })
            : ''
    const body = diagnosis?.code === 'graphics-memory'
      ? t('launcherError.diagnosis.graphics.body')
      : diagnosis?.code === 'incompatible-mod-mixin'
        ? tf('launcherError.diagnosis.mixin.body', { mod: diagnosis.culpritMod || 'unknown' })
        : diagnosis?.code === 'missing-mod-dependency'
          ? tf('launcherError.diagnosis.dependencyMissing.body', { dependency, required, mods: dependentMods })
          : diagnosis?.code === 'incompatible-mod-dependency'
            ? tf('launcherError.diagnosis.dependencyVersion.body', { dependency, installed, required, mods: dependentMods })
            : ''
    return { title, body }
  }
  const launcherErrorDiagnosisText = getCrashDiagnosisText(launcherErrorDiagnosis)
  const launcherErrorSystem = launcherErrorReport?.system || {}
  const launcherErrorGpuSummary = Array.isArray(launcherErrorSystem.gpu)
    ? launcherErrorSystem.gpu.filter(Boolean).slice(0, 2).join(', ')
    : ''
  const launcherErrorStorageSummary = Array.isArray(launcherErrorSystem.storage)
    ? launcherErrorSystem.storage
        .map((device) => [device.model, device.mediaType, device.size].filter(Boolean).join(' / '))
        .filter(Boolean)
        .slice(0, 2)
        .join('; ')
    : ''

  const launcherErrorModal = launcherErrorReport ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="launcher-error-title">
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex h-[calc(100vh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-red-400/35 bg-[#0d1526] shadow-2xl shadow-red-950/30"
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-red-400/20 bg-red-500/[0.07] p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-red-400/30 bg-red-500/15 text-red-200">
            <AlertTriangle size={23} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-300">{t('launcherError.eyebrow')}</p>
            <h2 id="launcher-error-title" className="mt-1 text-xl font-black text-white">
              {launcherErrorTitle}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
              {launcherErrorBody}
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-5">
          {launcherErrorDiagnosis && (
            <div className="flex shrink-0 items-start gap-3 rounded-lg border border-amber-300/25 bg-amber-400/[0.08] p-3 text-amber-50">
              <Wrench size={17} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <p className="text-sm font-black">{launcherErrorDiagnosisText.title}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/75">{launcherErrorDiagnosisText.body}</p>
              </div>
            </div>
          )}
          <div className="grid shrink-0 gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs font-semibold text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <span className="flex min-w-0 items-center gap-2">
              <User size={14} className="shrink-0 text-blue-300" />
              <span className="truncate">{launcherErrorReport.playerName || activeAccount?.name || 'unknown'}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <Cpu size={14} className="shrink-0 text-blue-300" />
              <span className="truncate">{launcherErrorSystem.cpu || 'unknown'}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <HardDrive size={14} className="shrink-0 text-blue-300" />
              <span className="truncate">{launcherErrorStorageSummary || `${launcherErrorSystem.ram_gb || '?'} GB RAM`}</span>
            </span>
            <span className="min-w-0 truncate font-mono text-slate-400">{launcherErrorGpuSummary || `${launcherErrorReport.platform || 'unknown'}/${launcherErrorReport.arch || 'unknown'}`}</span>
          </div>
          <div className="grid max-h-36 shrink-0 gap-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs font-semibold sm:grid-cols-[180px_1fr]">
            <span className="font-mono text-slate-500">{launcherErrorReport.context}</span>
            <span className="break-words text-red-100">{launcherErrorReport.message}</span>
          </div>
          <textarea
            readOnly
            spellCheck={false}
            aria-label={t('launcherError.logsAria')}
            value={launcherErrorReport.logs}
            wrap="off"
            className="min-h-[220px] flex-1 cursor-text resize-none overflow-auto rounded-lg border border-slate-700 bg-[#060b14] p-4 font-mono text-[11px] leading-5 text-slate-300 outline-none selection:bg-blue-500/35"
          />
        </div>

        {errorSubmitDetail && (
          <div className={classNames(
            'mx-5 mb-4 max-h-24 overflow-y-auto rounded-lg border px-4 py-3 text-sm font-semibold leading-6',
            errorSubmitState === 'failed'
              ? 'border-red-400/30 bg-red-500/10 text-red-100'
              : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
          )}>
            {errorSubmitDetail}
          </div>
        )}

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => {
              setLauncherErrorReport(null)
              setErrorCopyState('idle')
              setErrorSubmitState('idle')
              setErrorSubmitDetail('')
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-red-500 px-5 text-sm font-black text-white transition-colors hover:bg-red-400"
          >
            <X size={17} />
            {t('launcherError.close')}
          </button>
          <button
            type="button"
            onClick={copyLauncherErrorReport}
            disabled={errorCopyState === 'copying'}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-sm font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60"
          >
            {errorCopyState === 'copying' ? <Loader2 size={17} className="animate-spin" /> : <ClipboardCopy size={17} />}
            {errorCopyState === 'copied'
              ? t('launcherError.copy.copied')
              : errorCopyState === 'failed'
                ? t('launcherError.copy.failed')
                : t('launcherError.copy.all')}
          </button>
          <button
            type="button"
            onClick={submitLauncherErrorReport}
            disabled={errorSubmitState === 'sending' || errorSubmitState === 'sent' || submittedErrorReportsRef.current.has(launcherErrorReport.id)}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-400/40 bg-blue-500/10 px-4 text-sm font-black text-blue-100 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
          >
            {errorSubmitState === 'sending' ? <Loader2 size={17} className="animate-spin" /> : <MessageCircle size={17} />}
            {errorSubmitState === 'sent' || submittedErrorReportsRef.current.has(launcherErrorReport.id)
              ? t('launcherError.submit.sent')
              : errorSubmitState === 'failed'
                ? t('launcherError.submit.failed')
                : t('launcherError.submit.send')}
          </button>
        </footer>
      </motion.section>
    </div>
  ) : null

  const gameIssueInstance = minecraftGameIssue
    ? instances.find((instance) => instance.id === minecraftGameIssue.instanceId) || null
    : null
  const gameIssueCategory = minecraftGameIssue?.classification.category === 'user-content'
    ? 'user-content'
    : minecraftGameIssue?.classification.category === 'game-environment'
      ? 'game-environment'
      : 'unknown-game'
  const gameIssueMessageKey = minecraftGameIssue?.classification.code === 'resource-pack-invalid'
    ? 'resource-pack-invalid'
    : minecraftGameIssue?.classification.code === 'client-shutdown-hang'
      ? 'client-shutdown-hang'
      : gameIssueCategory
  const gameIssueContentTab: InstanceContentKind = minecraftGameIssue?.classification.code === 'resource-pack-invalid'
    ? 'resourcepacks'
    : 'mods'
  const gameIssueDiagnosisText = getCrashDiagnosisText(minecraftGameIssue?.diagnosis || null)
  const gameIssueLogs = minecraftGameIssue?.logs?.trim() || ''
  const gameIssueCopyState = gameIssueCopyResult?.id === minecraftGameIssue?.id
    ? gameIssueCopyResult?.state
    : undefined
  const copyMinecraftGameIssueLogs = async () => {
    if (!minecraftGameIssue || !gameIssueLogs || gameIssueCopyState === 'copying') return
    const id = minecraftGameIssue.id
    setGameIssueCopyResult({ id, state: 'copying' })
    try {
      // Local clipboard only; game-content diagnostics are never submitted.
      const result = await window.electron.copyErrorReport(gameIssueLogs)
      setGameIssueCopyResult({ id, state: result.success ? 'copied' : 'failed' })
    } catch {
      setGameIssueCopyResult({ id, state: 'failed' })
    }
  }
  const openMinecraftGameIssueView = (view: 'content' | 'logs') => {
    if (!gameIssueInstance) return
    setSelectedInstanceId(gameIssueInstance.id)
    setActiveView('instances')
    setInstancePanelView(view)
    if (view === 'content') setContentTab(gameIssueContentTab)
    setMinecraftGameIssue(null)
  }
  const minecraftGameIssueModal = minecraftGameIssue ? (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="minecraft-game-issue-title">
      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-300/30 bg-[#0d1526] shadow-2xl shadow-amber-950/25"
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-amber-300/20 bg-amber-400/[0.07] p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-400/15 text-amber-200">
            <Wrench size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">{t('gameIssue.eyebrow')}</p>
            <h2 id="minecraft-game-issue-title" className="mt-1 text-xl font-black text-white">
              {t(`gameIssue.title.${gameIssueMessageKey}`)}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
              {t(`gameIssue.body.${gameIssueMessageKey}`)}
            </p>
          </div>
        </header>

        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          {minecraftGameIssue.diagnosis && gameIssueDiagnosisText.title && (
            <div className="rounded-lg border border-amber-300/25 bg-amber-400/[0.08] p-4">
              <p className="text-sm font-black text-amber-50">{gameIssueDiagnosisText.title}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/75">{gameIssueDiagnosisText.body}</p>
            </div>
          )}

          <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-4 text-xs font-semibold text-slate-300 sm:grid-cols-2">
            <span className="min-w-0 truncate">{minecraftGameIssue.instanceName}</span>
            <span className="font-mono text-slate-500 sm:text-right">
              {minecraftGameIssue.exitCode === null
                ? minecraftGameIssue.classification.code
                : tf('gameIssue.exitCode', { code: minecraftGameIssue.exitCode })}
            </span>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.07] px-4 py-3 text-sm font-bold text-emerald-100">
            <ShieldCheck size={18} className="shrink-0 text-emerald-300" />
            <span>{t('gameIssue.localOnly')}</span>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="minecraft-game-issue-logs" className="text-xs font-black text-slate-300">
                {t('gameIssue.logs')}
              </label>
              <button
                type="button"
                onClick={copyMinecraftGameIssueLogs}
                disabled={!gameIssueLogs || gameIssueCopyState === 'copying'}
                className="flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {gameIssueCopyState === 'copying' ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCopy size={14} />}
                <span role="status" aria-live="polite">
                  {gameIssueCopyState === 'copied'
                    ? t('launcherError.copy.copied')
                    : gameIssueCopyState === 'failed'
                      ? t('launcherError.copy.failed')
                      : t('gameIssue.copyLogs')}
                </span>
              </button>
            </div>
            <textarea
              id="minecraft-game-issue-logs"
              readOnly
              spellCheck={false}
              value={gameIssueLogs || t('gameIssue.logsUnavailable')}
              className="h-48 w-full resize-y rounded-lg border border-slate-700 bg-slate-950/80 p-3 font-mono text-xs leading-5 text-slate-300 outline-none selection:bg-blue-500/40 focus:border-blue-400"
            />
            <p className="text-xs leading-5 text-slate-500">{t('gameIssue.logsHint')}</p>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={() => setMinecraftGameIssue(null)}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-800 px-5 text-sm font-black text-white transition-colors hover:bg-slate-700"
          >
            <X size={17} />
            {t('gameIssue.close')}
          </button>
          {gameIssueInstance && (
            <>
              <button
                type="button"
                onClick={() => window.electron.openInstanceFolder(gameIssueInstance).catch(() => undefined)}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-4 text-sm font-black text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
              >
                <FolderOpen size={17} />
                {t('gameIssue.openFolder')}
              </button>
              <button
                type="button"
                onClick={() => openMinecraftGameIssueView('logs')}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 text-sm font-black text-blue-100 transition-colors hover:bg-blue-500/20"
              >
                <FileText size={17} />
                {t('gameIssue.openLogs')}
              </button>
              <button
                type="button"
                onClick={() => openMinecraftGameIssueView('content')}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 text-sm font-black text-slate-950 transition-colors hover:bg-amber-300"
              >
                <Package size={17} />
                {minecraftGameIssue.classification.code === 'resource-pack-invalid'
                  ? t('gameIssue.openResourcePacks')
                  : t('gameIssue.openMods')}
              </button>
            </>
          )}
        </footer>
      </motion.section>
    </div>
  ) : null

  const mrpackImportProgressModal = importingMrpack ? (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="mrpack-import-title">
      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: reduceMotion ? 0.1 : 0.18, ease: 'easeOut' }}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-blue-300/25 bg-[#0d1526] shadow-2xl shadow-black/45"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-blue-300/25 bg-blue-500/12 text-blue-100">
              <FileArchive size={22} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('mrpack.progress.eyebrow')}</p>
              <h2 id="mrpack-import-title" className="mt-1 text-xl font-black text-white">{t('mrpack.progress.title')}</h2>
              <p className="mt-1 truncate text-sm font-semibold text-slate-400">
                {activityDetail || statusText || t('mrpack.progress.preparing')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => cancelActiveInstall()}
            aria-label={t('mrpack.progress.cancel')}
            data-tooltip={t('mrpack.progress.cancelTooltip')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-100"
          >
            <X size={17} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            <span>{statusText || t('mrpack.progress.working')}</span>
            <span className="font-mono tabular-nums text-blue-200">{Math.min(Math.max(Math.round(progress), 0), 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-400 transition-[width] duration-200"
              style={{ width: `${Math.min(Math.max(Math.round(progress), 0), 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-blue-400/15 bg-blue-500/[0.06] p-3 text-sm font-bold text-blue-100/80">
            <Loader2 size={17} className="shrink-0 animate-spin" />
            <span className="min-w-0 truncate">{activityDetail || t('mrpack.progress.reading')}</span>
          </div>
        </div>
      </motion.section>
    </div>
  ) : null

  if (!bootReady) {
    return (
      <div className="app-shell nam-backdrop-grid h-screen w-screen overflow-hidden bg-[#09101f] text-slate-100 antialiased">
        {launcherErrorModal}
        {minecraftGameIssueModal}
        <header className="titlebar flex h-12 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0a1120]/90 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-blue-400/30 bg-blue-500/15">
              <img src="./namlauncher-icon.png" alt="" className="h-7 w-7 object-contain outline-0" />
            </div>
            <p className="text-sm font-black text-white">NamLauncher</p>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-black uppercase text-emerald-200">
              {t('brand.beta')}
            </span>
          </div>
          <div className="no-drag flex items-center gap-1">
            <button onClick={() => window.electron.windowControl('minimize')} aria-label={t('window.minimize')} data-tooltip={t('window.minimize')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100">
              <Minus size={15} />
            </button>
            <button onClick={() => window.electron.windowControl('maximize')} aria-label={t('window.maximize')} data-tooltip={t('window.maximize')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100">
              <Square size={13} />
            </button>
            <button onClick={() => window.electron.windowControl('close')} aria-label={t('window.close')} data-tooltip={t('window.close')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-300">
              <X size={15} />
            </button>
          </div>
        </header>

        <main className="flex h-[calc(100vh-48px)] items-center justify-center px-8">
          {startupAutoUpdating ? (
            <section
              data-testid="startup-update-card"
              className="nam-motion-card w-full max-w-[440px] overflow-hidden rounded-2xl border border-blue-300/25 bg-[#0d1526]/95 p-5 shadow-2xl shadow-black/40"
            >
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-blue-400/30 bg-blue-500/15">
                  <img src="./namlauncher-icon.png" alt="" className="h-14 w-14 object-contain outline-0" />
                  <span className="absolute inset-x-2 bottom-1 h-0.5 overflow-hidden rounded-full bg-slate-950/60">
                    <span className="nam-progress-bar block h-full w-1/2 rounded-full bg-blue-300" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300">NamLauncher Update</p>
                  <h1 className="mt-1 text-xl font-black text-white">
                    {t(launcherUpdateProgress?.state === 'downloading'
                      ? 'update.auto.downloading'
                      : launcherUpdateProgress?.state === 'opening-installer' || launcherUpdateProgress?.state === 'installer-opened'
                        ? 'update.auto.installing'
                        : 'update.auto.checking')}
                  </h1>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-400" role="status" aria-live="polite">
                    {launcherUpdateProgress?.detail || t('update.auto.notice')}
                  </p>
                </div>
                <span className="font-mono text-sm font-black tabular-nums text-blue-200">{launcherUpdatePercent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={t('update.auto.progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={launcherUpdatePercent}
                className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800"
              >
                <div
                  className="nam-progress-bar h-full rounded-full bg-gradient-to-r from-blue-500 via-sky-300 to-cyan-300 transition-[width] duration-300"
                  style={{ width: `${Math.max(4, launcherUpdatePercent)}%` }}
                />
              </div>
              <p className="mt-3 text-[11px] font-semibold leading-5 text-slate-500">{t('update.auto.notice')}</p>
            </section>
          ) : (
            <section className="nam-motion-card flex w-full max-w-xl flex-col items-center rounded-xl border border-slate-800/80 bg-[#0d1526]/92 p-7 text-center shadow-2xl shadow-black/30">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-blue-400/30 bg-blue-500/15 shadow-2xl shadow-blue-950/35">
                <img src="./namlauncher-icon.png" alt="" className="h-20 w-20 object-contain outline-0 drop-shadow-[0_16px_30px_rgba(59,130,246,0.28)]" />
              </div>
              <p className="mt-8 text-xs font-black uppercase text-blue-300">{t('boot.eyebrow')}</p>
              <h1 className="mt-3 text-4xl font-black text-white">NamLauncher</h1>
              <p className="mt-3 min-h-[24px] text-sm font-bold text-slate-400" role="status" aria-live="polite">{bootText}</p>
              <div className="mt-7 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="nam-progress-bar h-full rounded-full bg-blue-400 transition-[width] duration-300" style={{ width: `${visibleBootProgress}%` }} />
              </div>
              <div className="mt-3 flex w-full items-center justify-between text-xs font-black text-slate-500">
                <span>{t('boot.preparing')}</span>
                <span className="font-mono tabular-nums text-blue-200">{visibleBootProgress}%</span>
              </div>
              <div className="mt-6 grid w-full grid-cols-4 gap-2">
                {bootMilestones.map((step) => (
                  <div key={step.label} className={classNames('rounded-lg border px-2 py-2 text-[11px] font-black uppercase', step.done ? 'border-blue-400/30 bg-blue-500/12 text-blue-100' : 'border-slate-800 bg-slate-950/25 text-slate-600')}>{step.label}</div>
                ))}
              </div>
              <div className="mt-5 w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950/30 text-left">
                <div className="flex h-9 items-center justify-between border-b border-slate-800 px-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t('setup.log.title')}</span>
                  <span className="font-mono text-[11px] font-black tabular-nums text-blue-200">{setupLogRows.length}</span>
                </div>
                <div className="max-h-28 overflow-hidden p-3">
                  {setupLogRows.length > 0 ? setupLogRows.slice(-4).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 py-1 text-xs font-semibold text-slate-400">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" />
                      <span className="font-mono text-[10px] tabular-nums text-slate-600">{entry.at}</span>
                      <span className="min-w-0 truncate">{entry.text}</span>
                    </div>
                  )) : <p className="py-2 text-xs font-semibold text-slate-600">{t('setup.log.empty')}</p>}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell nam-backdrop-grid h-screen w-screen overflow-hidden bg-[#09101f] text-slate-100 antialiased">
      {launcherErrorModal}
      {minecraftGameIssueModal}
      {mrpackImportProgressModal}
      <div className="pointer-events-none fixed right-3 top-14 z-[35] flex flex-col items-end">
        <AnimatePresence initial={false} mode="popLayout">
          {modpackInstallActivity?.minimized && (
            <ModpackInstallActivityCard
              key={modpackInstallActivity.taskId}
              activity={modpackInstallActivity}
              icon={modpackInstallActivity.iconUrl ? (
                <CachedImage
                  src={modpackInstallActivity.iconUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  fallback={<Package size={18} aria-hidden="true" />}
                />
              ) : undefined}
              reduceMotion={Boolean(reduceMotion)}
              labels={{
                installing: t('modpack.install.installing'),
                completed: t('modpack.install.completed'),
                failed: t('modpack.install.failed'),
                restore: t('modpack.install.restore'),
                dismiss: t('modpack.install.dismiss')
              }}
              onRestore={restoreModpackInstall}
              onDismiss={dismissModpackInstallActivity}
            />
          )}
        </AnimatePresence>
      </div>
      <div className="flex h-full">
        <aside
          className="relative grid h-full shrink-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden border-r border-slate-800 bg-[#0d1526]"
          style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
        >
          <div
            role="separator"
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onKeyDown={handleSidebarResizeKeyDown}
            className="nam-sidebar-resize-hit no-drag group absolute -right-[6px] top-0 z-40 h-full w-3 cursor-ew-resize outline-none"
            aria-label={t('sidebar.resize')}
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            data-tooltip={t('sidebar.resize')}
          >
            <span className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-800 transition-colors duration-150 group-hover:bg-blue-300/50 group-focus-visible:bg-blue-300/70" />
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300/0 transition-colors duration-150 group-hover:bg-blue-300/60 group-focus-visible:bg-blue-300/75" />
          </div>
          <div className={classNames('titlebar min-h-[72px] py-4', sidebarNarrow ? 'px-3' : 'px-5')}>
            <div className={classNames('flex min-w-0 items-center', sidebarNarrow ? 'gap-2' : 'gap-3')}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-blue-400/30 bg-blue-500/15">
                <img src="./namlauncher-icon.png" alt="" className="h-8 w-8 object-contain outline-0" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-black tracking-tight text-white">NamLauncher</h1>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300">Minecraft</p>
              </div>
            </div>
          </div>

          <nav className={classNames('space-y-1 pb-3', sidebarNarrow ? 'px-2' : 'px-3')}>
            {navItems.map((item) => (
              <button
                key={item.id}
                onPointerEnter={() => {
                  if (item.id === 'skins') void loadSkinPageModule()
                }}
                onFocus={() => {
                  if (item.id === 'skins') void loadSkinPageModule()
                }}
                onClick={() => {
                  setActiveView(item.id)
                  setShowAccountMenu(false)
                }}
                aria-current={activeView === item.id ? 'page' : undefined}
                className={classNames(
                  'relative flex h-11 w-full min-w-0 items-center rounded-lg text-sm font-bold transition-colors duration-150',
                  sidebarNarrow ? 'gap-2 px-2.5' : 'gap-3 px-3',
                  activeView === item.id
                    ? 'text-blue-100'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                )}
              >
                {activeView === item.id && (
                  <motion.span
                    layoutId="active-navigation"
                    className="absolute inset-0 rounded-lg border border-blue-400/25 bg-blue-500/15 shadow-[0_10px_28px_rgba(37,99,235,0.14),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    transition={reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
                  />
                )}
                <item.icon size={18} className="relative z-10 shrink-0" />
                <span className="relative z-10 min-w-0 truncate">{t(item.labelKey)}</span>
              </button>
            ))}
          </nav>

          <div className={classNames('flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden border-t border-slate-800/70 py-3', sidebarNarrow ? 'px-2' : 'px-3')}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('sidebar.instances')}</span>
              <button
                onClick={() => setShowInstanceModal(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-blue-200"
                data-tooltip={t('sidebar.newInstance')}
                aria-label={t('sidebar.newInstance')}
              >
                <Plus size={17} />
              </button>
            </div>

            <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
              <div className="h-full min-w-0 max-w-full space-y-1.5 overflow-y-auto overflow-x-hidden px-1 py-1">
                {instances.length > 0 ? (
                  instances.map((instance) => {
                    const updateCount = instanceUpdateSummaries[instance.id]?.updates.length || 0
                    const running = isInstanceBusy(instance.id)
                    const updating = updatingInstanceId === instance.id

                    return (
                      <div
                        key={instance.id}
                        className={classNames(
                          'nam-interactive-surface group flex min-h-[58px] w-full min-w-0 max-w-full items-center overflow-hidden rounded-lg border text-left transition-colors duration-150 focus-within:border-blue-300/55 focus-within:bg-blue-500/[0.07]',
                          sidebarNarrow ? 'gap-1 pl-2 pr-1' : 'gap-2 pl-3 pr-2',
                          selectedInstanceId === instance.id
                            ? 'nam-selected-glow border-blue-400/30 bg-blue-500/10'
                            : 'border-transparent hover:border-slate-700 hover:bg-slate-800/60'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => openInstanceDetail(instance.id)}
                          aria-current={activeView === 'instances' && selectedInstanceId === instance.id ? 'page' : undefined}
                          aria-label={tf('sidebar.openInstance', { name: instance.name })}
                          className={classNames(
                            'nam-sidebar-instance-button flex min-h-[56px] min-w-0 flex-1 items-center text-left outline-none',
                            sidebarNarrow ? 'gap-2' : 'gap-3'
                          )}
                        >
                          <InstanceIcon instance={instance} running={running} size={sidebarCompact ? 'xs' : 'sm'} />
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className={classNames('block truncate font-black text-slate-100', sidebarNarrow ? 'text-xs' : 'text-sm')}>
                              {instance.name}
                            </span>
                            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate text-[11px] font-semibold capitalize text-slate-500">
                                {instance.loader}{sidebarNarrow ? '' : ` / ${instance.version}`}
                              </span>
                            </span>
                          </span>
                          {!sidebarNarrow && <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-slate-600" />}
                        </button>
                        {updateCount > 0 && (
                          <button
                            type="button"
                            disabled={updating || running}
                            onClick={() => updateAllContent(instance)}
                            aria-label={running ? t('content.update.busy') : tf('home.updatesAvailable', { count: updateCount })}
                            className={classNames(
                              'flex shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-[11px] font-black text-sky-100 transition-colors duration-150 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50',
                              sidebarNarrow ? 'h-7 w-7 min-w-0 px-0' : 'h-8 min-w-8 gap-1 px-2'
                            )}
                            data-tooltip={running ? t('content.update.busy') : tf('home.updatesAvailable', { count: updateCount })}
                          >
                            {updating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            {!sidebarNarrow && updateCount}
                          </button>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-700/80 px-3 py-5 text-center">
                    <Package size={22} className="mx-auto text-slate-600" />
                    <p className="mt-2 text-xs font-black text-slate-400">{t('sidebar.noInstances.title')}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-600">{t('sidebar.noInstances.body')}</p>
                    <button
                      onClick={() => setShowInstanceModal(true)}
                      className="mt-3 h-8 rounded-md bg-blue-500 px-3 text-xs font-black text-white transition-colors duration-150 hover:bg-blue-400"
                    >
                      {t('sidebar.newInstance')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div ref={accountMenuRef} className={classNames('relative min-w-0 border-t border-slate-800 bg-[#0b1322]/70', sidebarNarrow ? 'p-2' : 'p-3')}>
            {showAccountMenu && accounts.length > 0 && (
              <div className={classNames(
                'absolute bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-lg border border-slate-700 bg-[#101a2e] shadow-2xl shadow-black/45',
                sidebarNarrow ? 'left-2 right-2' : 'left-3 right-3'
              )}>
                <div className="border-b border-slate-800 px-3 py-2">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('account.menu.title')}</p>
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {accounts.map((account) => (
                    <div key={account.id} className="group flex min-w-0 items-center gap-2 rounded-md p-2 hover:bg-slate-800/70">
                      <button
                        onClick={() => {
                          setActiveAccountId(account.id)
                          setShowAccountMenu(false)
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <AccountHead account={account} skinTextureSrc={accountSkinTextures[account.id]} sizeClass="h-9 w-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-100">{account.name}</p>
                          <p className="truncate text-[11px] font-bold text-slate-500">
                            {getAccountTypeLabel(account.type)} · {getAccountTypeDetail(account.type)}
                          </p>
                        </div>
                        {activeAccountId === account.id && <CheckCircle2 size={15} className="text-blue-300" />}
                      </button>
                      <button
                        onClick={() => removeAccount(account)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                        data-tooltip={t('account.remove.tooltip')}
                        aria-label={t('account.remove.tooltip')}
                      >
                        <LogOut size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className={classNames(
                  'grid gap-2 border-t border-slate-800 p-2',
                  sidebarNarrow ? 'grid-cols-1' : 'grid-cols-2'
                )}>
                  <button
                    onClick={() => {
                      setShowAccountMenu(false)
                      handleLogin('microsoft')
                    }}
                    className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-md bg-blue-500 px-2 text-xs font-black text-white transition-colors duration-150 hover:bg-blue-400"
                  >
                    <MicrosoftMark className="h-4 w-4" />
                    <span className="min-w-0 truncate">{t('auth.microsoft.title')}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowAccountMenu(false)
                      openOfflineLogin()
                    }}
                    className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border border-slate-700 px-2 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                  >
                    <FileText size={15} />
                    <span className="min-w-0 truncate">{t('auth.offline.title')}</span>
                  </button>
                </div>
              </div>
            )}

            {activeAccount ? (
              <button
                onClick={() => setShowAccountMenu((value) => !value)}
                className={classNames(
                  'flex w-full min-w-0 items-center overflow-hidden rounded-lg border border-slate-800 bg-slate-950/30 text-left transition-colors duration-150 hover:border-blue-400/30 hover:bg-slate-900/80',
                  sidebarNarrow ? 'gap-2 p-2' : 'gap-3 p-3'
                )}
                data-tooltip={t('account.switch')}
              >
                <AccountHead account={activeAccount} skinTextureSrc={accountSkinTextures[activeAccount.id]} sizeClass={sidebarCompact ? 'h-8 w-8' : 'h-10 w-10'} />
                <div className="min-w-0 flex-1">
                  <p className={classNames('truncate font-black', sidebarNarrow ? 'text-xs' : 'text-sm')}>
                    {activeAccount.name}
                  </p>
                  <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-blue-300">
                    {getAccountTypeLabel(activeAccount.type)}
                  </p>
                </div>
                {!sidebarCompact && <ChevronRight size={16} className={classNames('shrink-0 text-slate-500 transition-transform duration-150', showAccountMenu && '-rotate-90')} />}
              </button>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-500 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-colors duration-150 hover:bg-blue-400"
              >
                <User size={17} />
                {t('auth.title')}
              </button>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="titlebar flex h-12 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0a1120]/90 px-5">
            <div className="flex items-center gap-3">
              <motion.div
                animate={gameRunning && !reduceMotion
                  ? { scale: [1, 1.28, 1], opacity: [1, 0.72, 1] }
                  : { scale: 1, opacity: 1 }}
                transition={gameRunning && !reduceMotion
                  ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.15 }}
                className={classNames(
                 'h-2.5 w-2.5 rounded-full',
                 gameRunning ? 'bg-blue-300 shadow-[0_0_16px_rgba(96,165,250,0.9)]' : 'bg-slate-600'
                )}
              />
              <p className="max-w-[560px] truncate text-xs font-black uppercase tracking-[0.18em] text-slate-400" data-tooltip={activityDetail || statusText}>
                {statusText}
              </p>
            </div>
            <div className="no-drag flex items-center gap-1">
              <div
                className="mr-2 flex h-8 items-center gap-2 rounded-md border border-blue-400/20 bg-blue-500/10 px-2.5 text-blue-100 shadow-sm shadow-blue-950/15"
                data-tooltip={t('topbar.playersTooltip')}
              >
                <Users size={14} className="text-blue-200" />
                <span className="font-mono text-xs font-black tabular-nums">{onlinePlayersText}</span>
                <span className="hidden text-[11px] font-black uppercase tracking-[0.12em] text-blue-200/65 xl:inline">{t('topbar.players')}</span>
              </div>
              <button
                type="button"
                onClick={openDiscordAccountSettings}
                className="mr-1 flex h-8 max-w-[190px] items-center gap-2 rounded-md border border-indigo-300/20 bg-indigo-500/10 px-2.5 text-indigo-100 shadow-sm shadow-indigo-950/15 transition-colors hover:border-indigo-300/45 hover:bg-indigo-500/18"
                data-tooltip={launcherDiscordAccount?.connected && launcherDiscordAccount.profile
                  ? launcherDiscordAccount.profile.displayName
                  : t('settings.discordAccount.login')}
                aria-label={launcherDiscordAccount?.connected && launcherDiscordAccount.profile
                  ? launcherDiscordAccount.profile.displayName
                  : t('settings.discordAccount.login')}
              >
                {launcherDiscordAccount?.connected && launcherDiscordAccount.profile ? (
                  <img
                    src={launcherDiscordAccount.profile.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-5 w-5 shrink-0 rounded-full bg-slate-900 object-cover ring-1 ring-indigo-200/30"
                  />
                ) : (
                  <DiscordLogo className="h-[15px] w-[15px] shrink-0 text-indigo-200" />
                )}
                <span className="hidden truncate text-[11px] font-black xl:inline">
                  {launcherDiscordAccount?.connected && launcherDiscordAccount.profile
                    ? launcherDiscordAccount.profile.displayName
                    : t('settings.discordAccount.login')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => window.electron.openExternal(NAMLAUNCHER_DISCORD_URL)}
                className="mr-1 flex h-8 shrink-0 items-center gap-2 rounded-md border border-indigo-300/20 bg-indigo-500/10 px-2.5 text-indigo-100 transition-colors hover:border-indigo-300/45 hover:bg-indigo-500/18"
                data-tooltip={t('topbar.discord')}
                aria-label={t('topbar.discord')}
              >
                <DiscordLogo className="h-[15px] w-[15px] shrink-0 text-indigo-200" />
                <span className="hidden text-[11px] font-black xl:inline">{t('topbar.discord')}</span>
              </button>
              <button onClick={() => window.electron.windowControl('minimize')} aria-label={t('window.minimize')} data-tooltip={t('window.minimize')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100">
                <Minus size={15} />
              </button>
              <button onClick={() => window.electron.windowControl('maximize')} aria-label={t('window.maximize')} data-tooltip={t('window.maximize')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100">
                <Square size={13} />
              </button>
              <button onClick={() => window.electron.windowControl('close')} aria-label={t('window.close')} data-tooltip={t('window.close')} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-300">
                <X size={15} />
              </button>
            </div>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            {launcherUpdate?.updateAvailable && (
              <motion.div
                key={`launcher-update-${launcherUpdate.latestVersion}`}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0.1 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="no-drag flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-sky-400/20 bg-sky-500/10 px-5 py-3 shadow-[inset_0_-1px_0_rgba(125,211,252,0.08)]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-sky-100">{t('settings.update.available')}</p>
                  <p className="mt-0.5 text-xs font-semibold text-sky-200/70">
                    {t('settings.update.current')} {launcherUpdate.currentVersion} / {t('settings.update.latest')} {launcherUpdate.latestVersion}
                  </p>
                </div>
                <button
                  onClick={openLauncherUpdatePrompt}
                  disabled={launcherUpdateInstallState === 'installing'}
                  className="flex h-9 items-center gap-2 rounded-md bg-sky-500 px-3 text-xs font-black text-white transition-colors duration-150 hover:bg-sky-400 disabled:cursor-wait disabled:opacity-65"
                >
                  {launcherUpdateInstallState === 'installing' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {t('settings.update.download')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <main ref={mainScrollRef} className="min-h-0 flex-1 overflow-y-auto p-6">
            <AnimatePresence mode="wait" initial={false}>
            {activeView === 'home' && (
              <motion.div key="home" {...pageMotionProps} className="mx-auto max-w-[1500px] space-y-6">
                <section
                  aria-labelledby="home-welcome-title"
                  className="relative isolate flex min-h-[132px] items-center justify-between gap-5 overflow-hidden rounded-xl border border-blue-400/20 bg-[#0d1526]/92 p-5 shadow-[0_18px_50px_rgba(2,8,23,0.24),inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6"
                >
                  <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_88%_50%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(110deg,rgba(15,23,42,0.2),transparent_65%)]" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('home.welcome')}</p>
                    <h2 id="home-welcome-title" className="mt-1 truncate text-2xl font-black tracking-tight text-white sm:text-3xl">{welcomeName}</h2>
                  </div>
                  <div aria-hidden="true" className="shrink-0 rounded-xl border border-blue-300/25 bg-slate-950/40 p-1.5 shadow-[0_14px_36px_rgba(30,64,175,0.24)]">
                    {activeAccount ? (
                      <AccountHead
                        account={activeAccount}
                        skinTextureSrc={accountSkinTextures[activeAccount.id]}
                        sizeClass="h-16 w-16 sm:h-20 sm:w-20"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-800 text-slate-500 sm:h-20 sm:w-20">
                        <User size={28} />
                      </div>
                    )}
                  </div>
                </section>

                <section aria-labelledby="home-recent-title">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="home-recent-title" className="text-lg font-black text-white">{t('home.recent.title')}</h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{t('home.recent.subtitle')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('instances')}
                      className="flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-300 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100"
                    >
                      {t('home.recent.all')}
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {recentInstances.length > 0 ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {recentInstances.map((instance) => {
                        const busy = isInstanceBusy(instance.id)
                        const elapsed = busy ? runningElapsedByInstance[instance.id] || 0 : 0
                        return (
                          <article key={instance.id} className="nam-interactive-surface flex min-w-0 items-center gap-3 rounded-lg border border-slate-800 bg-[#0d1526] p-3 transition-colors hover:border-blue-400/35 hover:bg-blue-500/[0.05]">
                            <button
                              type="button"
                              onClick={() => openInstanceDetail(instance.id)}
                              className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                              aria-label={tf('home.recent.open', { name: instance.name })}
                            >
                              <InstanceIcon instance={instance} running={busy} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-black text-white">{instance.name}</span>
                                <span className="mt-1 block truncate text-xs font-semibold text-slate-500">
                                  {instance.loader} / Minecraft {instance.version}
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-600">
                                  <span>{tf('home.recent.played', { time: formatRelativeDate(instance.lastPlayedAt!, language) })}</span>
                                  <span className="font-mono tabular-nums">{formatPlaytime((instance.playtimeSeconds || 0) + elapsed)}</span>
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLaunchOrStop(instance)}
                              className={classNames(
                                'flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-black text-white transition-colors',
                                busy ? 'bg-red-500 hover:bg-red-400' : 'bg-blue-500 hover:bg-blue-400'
                              )}
                              aria-label={busy ? tf('home.recent.stop', { name: instance.name }) : tf('home.recent.play', { name: instance.name })}
                            >
                              {busy ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                              {busy ? t('play.stop') : t('play.play')}
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#0d1526]/70 px-6 text-center">
                      <Clock3 size={25} className="text-slate-700" />
                      <p className="mt-3 text-sm font-black text-slate-400">{t('home.recent.empty.title')}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-600">{t('home.recent.empty.body')}</p>
                    </div>
                  )}
                </section>

                {recentPlayablePlaces.length > 0 && (
                  <section aria-labelledby="home-places-title">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h2 id="home-places-title" className="text-lg font-black text-white">{t('home.places.title')}</h2>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{t('home.places.subtitle')}</p>
                      </div>
                      {recentPlayablePlaces.some(({ place }) => place.type === 'server') && (
                        <button
                          type="button"
                          onClick={() => {
                            for (const [key, cached] of homeServerStatusCacheRef.current) {
                              homeServerStatusCacheRef.current.set(key, { ...cached, expiresAt: 0 })
                            }
                            setHomeServerStatusRefresh((value) => value + 1)
                          }}
                          disabled={homeServerStatusesRefreshing}
                          className="flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-300 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          <RefreshCw size={14} className={homeServerStatusesRefreshing ? 'animate-spin' : ''} />
                          {t('places.refresh')}
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {recentPlayablePlaces.map(({ place, instance, quickPlay }) => {
                        const busy = isInstanceBusy(instance.id)
                        const placeIdentity = quickPlay.type === 'server' ? quickPlay.address : quickPlay.folderName
                        const serverStatus = place.type === 'server' && place.address
                          ? homeServerStatuses[getHomeServerStatusKey(instance.id, place.address)]
                          : undefined
                        const serverPing = serverStatus?.ping
                        const serverOnline = serverStatus?.phase === 'online'
                        const serverLoading = place.type === 'server' && (!serverStatus || serverStatus.phase === 'loading')
                        const partnerServer = place.type === 'server' && place.address
                          ? PARTNER_SERVERS.find((server) => (
                            normalizeHomeServerAddress(server.address) === normalizeHomeServerAddress(place.address!)
                          ))
                          : undefined
                        const serverIcon = serverPing?.status?.faviconDataUrl || serverPing?.iconDataUrl || partnerServer?.iconUrl
                        return (
                          <article key={`${instance.id}:${quickPlay.type}:${placeIdentity}`} className="nam-interactive-surface flex min-w-0 items-center gap-3 rounded-lg border border-slate-800 bg-[#0d1526] p-3 transition-colors hover:border-blue-400/35 hover:bg-blue-500/[0.05]">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedInstanceId(instance.id)
                                setInstancePanelView('places')
                                setActiveView('instances')
                              }}
                              className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                              aria-label={tf('home.places.open', { name: place.label })}
                            >
                              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-200">
                                {place.type === 'server' ? (
                                  <CachedImage
                                    src={serverIcon}
                                    alt=""
                                    className="h-full w-full object-contain"
                                    loading="lazy"
                                    fallback={<Server size={19} />}
                                  />
                                ) : <Package size={19} />}
                              </span>
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="min-w-0 truncate text-sm font-black text-white">{place.label}</span>
                                  {place.type === 'server' && (serverLoading ? (
                                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-black text-slate-500">
                                      <Loader2 size={10} className="animate-spin" />{t('places.checking')}
                                    </span>
                                  ) : serverOnline ? (
                                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-black text-emerald-300">
                                      <CheckCircle2 size={10} />{t('places.online')}
                                    </span>
                                  ) : (
                                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-black text-red-300">
                                      <WifiOff size={10} />{t('places.offline')}
                                    </span>
                                  ))}
                                </span>
                                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-slate-500">
                                  <span className={place.type === 'server' ? 'truncate font-mono text-slate-400' : 'truncate'}>
                                    {place.type === 'server' ? place.address : instance.name}
                                  </span>
                                  {serverOnline && serverPing?.status?.players && (
                                    <span className="flex shrink-0 items-center gap-1 text-emerald-300">
                                      <Users size={11} />{serverPing.status.players.online}/{serverPing.status.players.max}
                                    </span>
                                  )}
                                  {serverOnline && (
                                    <span className="shrink-0 font-mono tabular-nums text-slate-500">
                                      {Math.round(serverPing?.status?.latencyMs || 0)} ms
                                    </span>
                                  )}
                                </span>
                                {place.type === 'server' && (
                                  <MinecraftServerMotd
                                    motd={serverOnline ? serverPing?.status?.motd : null}
                                    fallback={serverLoading
                                      ? t('places.checking')
                                      : serverOnline
                                        ? t('places.motd.empty')
                                        : t('places.cannotConnect')}
                                    className={classNames(
                                      'mt-1 line-clamp-2 whitespace-pre-line break-words font-mono text-[11px] font-semibold leading-4',
                                      serverLoading ? 'text-slate-600' : serverOnline ? 'text-slate-300' : 'text-red-300/80'
                                    )}
                                  />
                                )}
                                <span className="mt-1 block truncate text-[11px] font-bold text-slate-600">
                                  {tf('home.places.played', { time: formatRelativeDate(place.playedAt, language), instance: instance.name })}
                                </span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLaunchOrStop(instance, quickPlay, place.label)}
                              className={classNames(
                                'flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-black text-white transition-colors',
                                busy ? 'bg-red-500 hover:bg-red-400' : 'bg-blue-500 hover:bg-blue-400'
                              )}
                              aria-label={busy
                                ? tf('home.recent.stop', { name: instance.name })
                                : tf('home.places.play', { name: place.label })}
                            >
                              {busy ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                              {busy ? t('play.stop') : t('play.play')}
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )}

                <section aria-labelledby="home-modpacks-title">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="home-modpacks-title" className="text-lg font-black text-white">{t('home.modpacks.title')}</h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{t('home.modpacks.subtitle')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLibrarySource('modrinth')
                        setLibraryType('modpack')
                        setLibraryPage(0)
                        setModQuery('')
                        setActiveView('library')
                      }}
                      className="flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-300 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100"
                    >
                      {t('home.modpacks.browse')}
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {homeModpacksLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('home.modpacks.loading')}>
                      {Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className="animate-pulse overflow-hidden rounded-lg border border-slate-800 bg-[#0d1526]">
                          <div className="aspect-[2/1] bg-slate-800/70" />
                          <div className="p-4">
                            <div className="h-4 w-2/3 rounded bg-slate-800/70" />
                            <div className="mt-3 h-3 rounded bg-slate-800/50" />
                            <div className="mt-2 h-3 w-4/5 rounded bg-slate-800/40" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : homeModpacksError ? (
                    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-red-400/20 bg-red-500/[0.05] px-6 text-center" role="alert">
                      <AlertTriangle size={25} className="text-red-300" />
                      <p className="mt-3 text-sm font-black text-red-100">{t('home.modpacks.error')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setHomeModpacksLoaded(false)
                          setHomeModpacksError(false)
                          setHomeModpacksRetry((value) => value + 1)
                        }}
                        className="mt-3 flex h-9 items-center gap-2 rounded-md border border-red-300/30 bg-red-500/10 px-3 text-xs font-black text-red-100 transition-colors hover:bg-red-500/20"
                      >
                        <RefreshCw size={14} />
                        {t('home.modpacks.retry')}
                      </button>
                    </div>
                  ) : homeModpacks.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {homeModpacks.map((modpack) => {
                        // Author/creator: nattapat2871 (https://nattapat2871.me)
                        const artwork = resolveHomeModpackArtwork(modpack)
                        const iconFallback = (
                          <span className="flex h-full w-full items-center justify-center bg-slate-950/35 p-5">
                            <CachedImage
                              src={artwork.iconUrl}
                              alt=""
                              loading="lazy"
                              className="max-h-24 max-w-24 object-contain transition-transform duration-300 group-hover:scale-105"
                              fallback={<Package size={30} className="text-slate-700" />}
                            />
                          </span>
                        )

                        return (
                          <article key={getProjectKey(modpack)} className="group overflow-hidden rounded-lg border border-slate-800 bg-[#0d1526] transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-blue-400/40 hover:shadow-lg hover:shadow-blue-950/20">
                            <button
                              type="button"
                              onClick={() => void openModpackInstaller(modpack)}
                              className="block h-full w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300/70"
                              aria-label={tf('home.modpacks.install', { name: modpack.title })}
                            >
                              <span className="flex aspect-[2/1] w-full items-center justify-center overflow-hidden bg-slate-950/35">
                                {artwork.bannerUrl ? (
                                  <CachedImage
                                    src={artwork.bannerUrl}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                                    fallback={iconFallback}
                                  />
                                ) : iconFallback}
                              </span>
                              <span className="block p-4">
                                <span className="block truncate text-sm font-black text-white">{modpack.title}</span>
                                <span className="mt-1 line-clamp-2 min-h-10 text-xs font-semibold leading-5 text-slate-500">{modpack.description}</span>
                                <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
                                  <span className="truncate">{modpack.author}</span>
                                  <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums">
                                    <Download size={12} />
                                    {Number(modpack.downloads || 0).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
                                  </span>
                                </span>
                              </span>
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#0d1526]/70 px-6 text-center">
                      <Package size={25} className="text-slate-700" />
                      <p className="mt-3 text-sm font-black text-slate-400">{t('home.modpacks.empty')}</p>
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {activeView === 'instances' && (
              <motion.div key="instances" {...pageMotionProps} className="h-full min-h-[680px]">
                {currentTarget ? (
                  <section aria-labelledby="instance-detail-title" className="min-w-0 rounded-lg border border-slate-800 bg-[#0d1526]">
                  <div className="border-b border-slate-800 p-5">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-start gap-4">
                        <InstanceIcon instance={currentTarget} running={currentRunningThisTarget} size="lg" />
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">{t('home.selectedInstance')}</p>
                          <h2
                            ref={instanceHeadingRef}
                            id="instance-detail-title"
                            tabIndex={-1}
                            className="mt-2 truncate rounded-sm text-3xl font-black tracking-tight text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0d1526]"
                          >
                            {currentTarget.name}
                          </h2>
                          <p className="mt-2 flex items-center gap-2 text-sm font-semibold capitalize text-slate-400">
                            <LoaderIcon loader={currentTarget.loader} className="h-5 w-5 shrink-0" />
                            {currentTarget.loader} / Minecraft {currentTarget.version}{currentTarget.loaderVersion ? ` / ${currentTarget.loaderVersion}` : ''}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {runningServers[currentTarget.id] && (
                              <span className="inline-flex items-center gap-1.5 rounded border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[11px] font-black text-emerald-100">
                                <Server size={13} aria-hidden="true" />
                                {tf('instance.server.playing', { server: runningServers[currentTarget.id].label })}
                              </span>
                            )}
                            {currentUpdateCount > 0 ? (
                              <span className="rounded bg-sky-500/15 px-2 py-1 text-[11px] font-black uppercase text-sky-200">
                                {tf('home.updatesAvailable', { count: currentUpdateCount })}
                              </span>
                            ) : (
                              <span className="rounded bg-slate-800 px-2 py-1 text-[11px] font-black uppercase text-slate-400">
                                {checkingUpdates ? t('home.checkingUpdates') : t('home.upToDate')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto xl:justify-end">
                        <button
                          type="button"
                          onClick={() => handleLaunchOrStop(currentTarget)}
                          className={classNames(
                            'flex h-12 min-w-[150px] flex-1 items-center justify-center gap-2 rounded-lg px-5 text-sm font-black text-white shadow-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none',
                            currentBusyThisTarget ? 'bg-red-500 shadow-red-950/30 hover:bg-red-400' : 'bg-blue-500 shadow-blue-950/30 hover:bg-blue-400'
                          )}
                        >
                          {currentBusyThisTarget ? <Square size={17} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                          {currentBusyThisTarget ? t('play.stop') : t('play.play')}
                        </button>
                        <button
                          type="button"
                          onClick={() => openInstanceModsLibrary(currentTarget.id)}
                          aria-label={tf('instance.mods.addFor', { name: currentTarget.name })}
                          className="flex h-12 min-w-[132px] flex-1 items-center justify-center gap-2 rounded-lg border border-blue-400/35 bg-blue-500/10 px-4 text-sm font-black text-blue-100 transition-colors duration-150 hover:border-blue-300/55 hover:bg-blue-500/20 sm:flex-none"
                        >
                          <Plus size={18} aria-hidden="true" />
                          {t('instance.mods.add')}
                        </button>
                        <button
                          type="button"
                          onClick={() => openInstanceSettings(currentTarget)}
                          className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 transition-colors duration-150 hover:border-blue-300/45 hover:bg-blue-500/12 hover:text-blue-100"
                          data-tooltip={t('instance.settings.open')}
                          aria-label={t('instance.settings.open')}
                        >
                          <Settings size={19} />
                        </button>
                        <div ref={instanceActionMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setInstanceActionMenuOpen((value) => !value)}
                            className="flex h-12 w-12 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100"
                            data-tooltip={t('instance.actions.menu')}
                            aria-label={t('instance.actions.menu')}
                          >
                            <MoreVertical size={21} />
                          </button>
                          {instanceActionMenuOpen && (
                            <div className="absolute right-0 top-14 z-40 w-56 overflow-hidden rounded-lg border border-slate-700 bg-[#111827] p-1 shadow-2xl shadow-black/45">
                              <button
                                type="button"
                                disabled={exportingInstanceId === currentTarget.id || currentBusyThisTarget}
                                onClick={() => {
                                  setInstanceActionMenuOpen(false)
                                  exportInstanceMrpack(currentTarget)
                                }}
                                className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-black text-slate-300 transition-colors hover:bg-slate-800 hover:text-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {exportingInstanceId === currentTarget.id ? <Loader2 size={16} className="animate-spin" /> : <FileArchive size={16} />}
                                {t('instance.export.button')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {(launching || progress > 0) && (
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-blue-400 transition-[width] duration-200" style={{ width: `${Math.min(progress, 100)}%` }} />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 border-b border-slate-800">
                    <div className="border-r border-slate-800 p-4">
                      <div className="mb-2 flex items-center gap-2 text-slate-500">
                        <Clock3 size={16} />
                        <span className="text-[11px] font-black uppercase tracking-[0.16em]">{t('instance.metric.playtime')}</span>
                      </div>
                      <p className="font-mono text-2xl font-black text-white">{formatPlaytime(targetPlaytime + (currentRunningThisTarget ? (runningElapsedByInstance[currentTarget.id] || 0) : 0))}</p>
                    </div>
                    <div className="border-r border-slate-800 p-4">
                      <div className="mb-2 flex items-center gap-2 text-slate-500">
                        <HardDrive size={16} />
                        <span className="text-[11px] font-black uppercase tracking-[0.16em]">{t('instance.metric.memory')}</span>
                      </div>
                      <p className="font-mono text-2xl font-black text-white">{memoryGb}G</p>
                    </div>
                    <div className="p-4">
                      <div className="mb-2 flex items-center gap-2 text-slate-500">
                        <LoaderIcon loader={currentTarget.loader} className="h-5 w-5" />
                        <span className="text-[11px] font-black uppercase tracking-[0.16em]">{t('instance.metric.loader')}</span>
                      </div>
                      <p className="truncate text-sm font-bold capitalize text-white">{currentTarget.loader === 'neoforge' ? 'NeoForge' : currentTarget.loader}</p>
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-black">
                          {instancePanelView === 'logs'
                            ? t('instance.logs.title')
                            : instancePanelView === 'places'
                              ? t('instance.places.title')
                              : t('instance.content.title')}
                        </h3>
                        <p className="text-xs font-semibold text-slate-500">
                          {instancePanelView === 'logs'
                            ? currentRunningThisTarget
                              ? t('instance.logs.live')
                              : gameLogPath
                                ? 'latest.log'
                                : t('instance.logs.empty')
                            : instancePanelView === 'places'
                              ? t('instance.places.description')
                              : tf('instance.content.count', { count: instanceContent.length, folder: currentContentTab.folder })}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {instancePanelView === 'content' && currentUpdateCount > 0 && (
                          <button
                            disabled={updatingInstanceId === currentTarget.id || currentUpdateAllBlocked}
                            onClick={() => updateAllContent(currentTarget)}
                            className="flex h-10 items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 text-xs font-black text-emerald-100 transition-colors duration-150 hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-50"
                            data-tooltip={currentUpdateAllBlocked ? t('content.update.busy') : t('home.updateAllTooltip')}
                          >
                            {updatingInstanceId === currentTarget.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                            {t('home.updateAll')}
                          </button>
                        )}
                        {instancePanelView === 'content' && (
                          <button
                            disabled={checkingUpdates}
                            onClick={() => {
                              refreshUpdateSummaries([currentTarget])
                                .then(() => refreshInstanceContent(contentTab, currentTarget, { force: true }))
                                .catch(() => undefined)
                            }}
                            className="flex h-10 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-sky-200 disabled:cursor-wait disabled:opacity-60"
                          >
                            {checkingUpdates ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                            {t('instance.updates.refresh')}
                          </button>
                        )}
                        <button
                          onClick={() => window.electron.openInstanceFolder(currentTarget)}
                          className="flex h-10 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                        >
                          <FolderOpen size={15} />
                          {t('instance.folder.button')}
                        </button>
                        <div className="flex flex-wrap rounded-lg border border-slate-700 bg-slate-950/30 p-1" role="tablist" aria-label={t('instance.panel.tabs')}>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={instancePanelView === 'content'}
                            onClick={() => setInstancePanelView('content')}
                            className={classNames(
                              'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-black transition-colors',
                              instancePanelView === 'content' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100'
                            )}
                          >
                            <Package size={14} />
                            {t('instance.content.button')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={instancePanelView === 'places'}
                            onClick={() => setInstancePanelView('places')}
                            className={classNames(
                              'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-black transition-colors',
                              instancePanelView === 'places' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100'
                            )}
                          >
                            <Server size={14} />
                            {t('instance.places.button')}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={instancePanelView === 'logs'}
                            onClick={() => openInstanceLogs(currentTarget)}
                            className={classNames(
                              'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-black transition-colors',
                              instancePanelView === 'logs' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100'
                            )}
                          >
                            <FileText size={14} />
                            {t('instance.logs.button')}
                          </button>
                        </div>
                      </div>
                    </div>

                    {instancePanelView === 'logs' ? (
                      <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#050914] shadow-inner shadow-black/20">
                        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/45 px-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={classNames(
                              'h-2.5 w-2.5 shrink-0 rounded-full',
                              currentRunningThisTarget ? 'bg-blue-300 shadow-[0_0_12px_rgba(96,165,250,0.85)]' : 'bg-slate-600'
                            )} />
                            <p className="truncate font-mono text-[11px] font-semibold text-slate-500" data-tooltip={gameLogPath}>
                              {gameLogPath || 'latest.log'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-[11px] font-black uppercase text-slate-500">
                            {gameLogLoading ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                {t('instance.logs.loading')}
                              </>
                            ) : (
                              <span className="font-mono tabular-nums">{tf('instance.logs.lines', { count: gameLogLines.length })}</span>
                            )}
                          </div>
                        </div>
                        <div className="nam-selectable h-[460px] cursor-text overflow-y-auto bg-black/35 p-4 font-mono text-[11px] leading-5 text-slate-300">
                          {gameLogLoading ? (
                            <div className="flex h-full items-center justify-center gap-2 text-sm font-bold text-slate-500">
                              <Loader2 size={17} className="animate-spin" />
                              {t('instance.logs.loadingFile')}
                            </div>
                          ) : gameLogLines.length > 0 ? (
                            gameLogLines.map((line, index) => {
                              const lower = line.toLowerCase()
                              const tone = lower.includes('error') || lower.includes('exception') || lower.includes('failed')
                                ? 'text-red-300'
                                : lower.includes('warn')
                                  ? 'text-amber-300'
                                  : lower.includes('[debug]')
                                    ? 'text-slate-500'
                                    : 'text-slate-300'

                              return (
                                <div key={`${index}-${line.slice(0, 24)}`} className={classNames('whitespace-pre-wrap break-words', tone)}>
                                  {line}
                                </div>
                              )
                            })
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-600">
                              {t('instance.logs.none')}
                            </div>
                          )}
                          <div ref={logEndRef} />
                        </div>
                      </div>
                    ) : instancePanelView === 'places' ? (
                      <Suspense
                        fallback={(
                          <div className="flex min-h-64 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/20 text-sm font-bold text-slate-500">
                            <Loader2 size={18} className="animate-spin" />
                            {t('places.loading')}
                          </div>
                        )}
                      >
                        <WorldsServersPanel
                          key={currentTarget.id}
                          instance={currentTarget}
                          api={window.electron}
                          language={language}
                          busy={currentBusyThisTarget}
                          t={t}
                          tf={tf}
                          onStatus={setStatusText}
                          onPlay={(quickPlay, label) => handleLaunchOrStop(currentTarget, quickPlay, label)}
                          confirmRemoval={(server: MinecraftServerPlace, onConfirm: () => Promise<void>) => {
                            setConfirmDialog({
                              title: t('places.remove.title'),
                              body: tf('places.remove.body', { name: server.name, address: server.address }),
                              confirmLabel: t('places.remove.confirm'),
                              cancelLabel: t('places.remove.cancel'),
                              danger: true,
                              onConfirm
                            })
                          }}
                        />
                      </Suspense>
                    ) : (
                      <div
                        onDragOver={handleContentDragOver}
                        onDragLeave={handleContentDragLeave}
                        onDrop={handleContentDrop}
                        className={classNames(
                          'rounded-lg border border-transparent p-0 transition-colors duration-150',
                          contentDropActive ? 'border-blue-300/45 bg-blue-500/[0.05]' : ''
                        )}
                      >
                    <div className="mb-4 flex rounded-lg border border-slate-800 bg-slate-950/30 p-1">
                      {instanceContentTabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setContentTab(tab.id)}
                          className={classNames(
                            'h-10 flex-1 rounded-md px-3 text-xs font-black transition-colors duration-150',
                            contentTab === tab.id
                              ? 'bg-blue-500 text-white shadow-lg shadow-blue-950/30'
                              : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-100'
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 transition-colors focus-within:border-blue-400/60 focus-within:bg-slate-950">
                        <Search size={16} className="shrink-0 text-slate-500" />
                        <input
                          type="text"
                          value={instanceContentQuery}
                          onChange={(event) => setInstanceContentQuery(event.target.value)}
                          placeholder={tf('content.search.placeholder', { label: currentContentTab.label.toLowerCase() })}
                          aria-label={tf('content.search.placeholder', { label: currentContentTab.label.toLowerCase() })}
                          className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600"
                        />
                        {instanceContentQuery && (
                          <button
                            type="button"
                            onClick={() => setInstanceContentQuery('')}
                            aria-label={t('content.search.clear')}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-100"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">
                        {instanceContentQuery.trim()
                          ? tf('content.files.filtered', { filtered: filteredInstanceContent.length, total: instanceContent.length })
                          : tf('content.files.total', { count: instanceContent.length })}
                      </span>
                    </div>

                    <div className={classNames(
                      'mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                      contentDropActive
                        ? 'border-blue-300/45 bg-blue-500/10 text-blue-100'
                        : 'border-slate-800 bg-slate-950/25 text-slate-500'
                    )}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-slate-950/45">
                          {contentImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-200">
                            {contentImporting ? t('content.importing') : tf('content.drop.title', { label: currentContentTab.label.toLowerCase() })}
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                            {tf('content.drop.body', { folder: currentContentTab.folder })}
                          </p>
                        </div>
                      </div>
                      <span className="hidden shrink-0 font-mono text-[11px] font-black uppercase text-slate-500 sm:block">
                        {currentContentTab.folder}
                      </span>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-800">
                      {contentLoading ? (
                        <div className="flex h-48 items-center justify-center gap-2 text-sm font-bold text-slate-500">
                          <Loader2 size={17} className="animate-spin" />
                          {currentContentCached ? t('content.loading.refreshing') : t('content.loading')}
                        </div>
                      ) : filteredInstanceContent.length > 0 && showingScreenshots ? (
                        <div className="grid gap-3 bg-slate-950/20 p-3 sm:grid-cols-2 xl:grid-cols-3">
                          {filteredInstanceContent.map((item) => {
                            const busy = busyContentId === item.id
                            return (
                              <div key={item.id} className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-950/35 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-blue-300/35 hover:shadow-xl hover:shadow-blue-950/20">
                                <button
                                  type="button"
                                  onClick={() => openScreenshotViewer(item)}
                                  className="relative block aspect-video w-full overflow-hidden bg-slate-900 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                                  aria-label={tf('screenshot.open', { name: item.fileName })}
                                >
                                  {item.iconUrl ? (
                                    <CachedImage
                                      src={item.iconUrl}
                                      alt=""
                                      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.045]"
                                      fallback={<div className="flex h-full w-full items-center justify-center text-slate-600"><ImageIcon size={24} /></div>}
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-600">
                                      <ImageIcon size={24} />
                                    </div>
                                  )}
                                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-10 text-[11px] font-black text-white/85 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                    <span>{t('screenshot.view')}</span>
                                    <ZoomIn size={14} />
                                  </span>
                                </button>
                                <div className="p-3">
                                  <p className="truncate text-sm font-black text-slate-100" data-tooltip={item.fileName}>
                                    {item.fileName}
                                  </p>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                                    <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                                    <span>{formatDate(item.updatedAt)}</span>
                                  </div>
                                  <div className="mt-3 flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => revealContentFile(item)}
                                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                                      data-tooltip={t('content.showFolder')}
                                      aria-label={t('content.showFolder')}
                                    >
                                      <FolderOpen size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => deleteContent(item)}
                                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors duration-150 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                                      data-tooltip={t('content.delete.tooltip')}
                                      aria-label={t('content.delete.tooltip')}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : filteredInstanceContent.length > 0 ? (
                        <div className="divide-y divide-slate-800">
                          {filteredInstanceContent.map((item) => {
                            const busy = busyContentId === item.id
                            const contentBlocked = shouldBlockCurrentTargetContent(item.kind)
                            const update = item.projectId
                              ? currentUpdates.find((candidate) => candidate.projectId === item.projectId)
                              : null
                            const updatingThis = Boolean(update && updatingProjectIds.includes(update.projectId))
                            return (
                              <div key={item.id} className="flex items-center gap-4 bg-slate-950/20 px-4 py-3 transition-colors duration-150 hover:bg-blue-500/[0.04]">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-blue-300">
                                  {item.iconUrl ? (
                                    <CachedImage
                                      src={item.iconUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                      fallback={<ImageIcon size={18} />}
                                    />
                                  ) : (
                                    <ImageIcon size={18} />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate text-sm font-black text-slate-100" data-tooltip={getContentDisplayName(item)}>
                                      {getContentDisplayName(item)}
                                    </p>
                                    <span className={classNames(
                                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase',
                                      item.source === 'modrinth'
                                        ? 'bg-blue-500/15 text-blue-200'
                                        : item.source === 'curseforge'
                                          ? 'bg-orange-500/15 text-orange-200'
                                          : 'bg-slate-700/70 text-slate-300'
                                    )}>
                                      {item.source === 'modrinth' ? 'Modrinth' : item.source === 'curseforge' ? 'CurseForge' : t('content.source.local')}
                                    </span>
                                    {!item.enabled && (
                                      <span className="shrink-0 rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-black uppercase text-slate-300">
                                        {t('content.disabled')}
                                      </span>
                                    )}
                                    {update && (
                                      <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-sky-200">
                                        {t('content.update')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                                    <span className="max-w-full truncate">{item.fileName}</span>
                                    <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                                    {item.versionNumber && <span className="font-mono text-blue-300">{item.versionNumber}</span>}
                                    {update && (
                                      <span className="font-mono text-sky-300">
                                        {update.installedVersion} -&gt; {update.latestVersion}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {update && (
                                    <button
                                      type="button"
                                      disabled={busy || updatingThis || contentBlocked || (updatingInstanceId === currentTarget.id && !updatingThis)}
                                      onClick={() => updateInstalledContent(currentTarget, update)}
                                      className="flex h-10 items-center gap-2 rounded-md bg-sky-500 px-3 text-xs font-black text-white transition-colors duration-150 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                                      data-tooltip={contentBlocked ? t('content.update.busy') : t('content.update.tooltip')}
                                    >
                                      {updatingThis ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                                      {t('content.update')}
                                    </button>
                                  )}
                                  <SwitchControl
                                    checked={item.enabled}
                                    onChange={() => toggleContent(item)}
                                    disabled={contentBlocked}
                                    busy={busy}
                                    title={contentBlocked ? t('content.toggle.busy') : item.enabled ? t('content.disable') : t('content.enable')}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => revealContentFile(item)}
                                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                                    data-tooltip={t('content.showFolder')}
                                    aria-label={t('content.showFolder')}
                                  >
                                    <FolderOpen size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy || contentBlocked}
                                    onClick={() => deleteContent(item)}
                                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors duration-150 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                                    data-tooltip={contentBlocked ? t('content.delete.busy') : t('content.delete.tooltip')}
                                    aria-label={contentBlocked ? t('content.delete.busy') : t('content.delete.tooltip')}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : instanceContent.length > 0 && instanceContentQuery.trim() ? (
                        <div className="flex h-48 flex-col items-center justify-center px-4 text-center">
                          <Search size={30} className="text-slate-700" />
                          <p className="mt-3 text-sm font-black text-slate-400">{tf('content.empty.filtered.title', { label: currentContentTab.label.toLowerCase() })}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">{t('content.empty.filtered.body')}</p>
                        </div>
                      ) : (
                        <div className="flex h-48 flex-col items-center justify-center text-center">
                          <FileArchive size={30} className="text-slate-700" />
                          <p className="mt-3 text-sm font-black text-slate-400">{tf('content.empty.title', { label: currentContentTab.label.toLowerCase() })}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">
                            {tf('content.empty.body', { folder: currentContentTab.folder })}
                          </p>
                        </div>
                      )}
                    </div>
                      </div>
                    )}
                  </div>
                  </section>
                ) : (
                  <section className="flex min-h-[520px] min-w-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-[#0d1526] px-6 py-12 text-center">
                    <Package size={42} className="text-slate-700" />
                    <h2 className="mt-4 text-2xl font-black tracking-tight text-white">{t('instance.empty.selected.title')}</h2>
                    <p className="mt-2 max-w-md text-sm font-semibold text-slate-500">
                      {t('instance.empty.selected.body')}
                    </p>
                    <button
                      onClick={() => setShowInstanceModal(true)}
                      className="mt-5 flex h-11 items-center gap-2 rounded-lg bg-blue-500 px-4 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-colors duration-150 hover:bg-blue-400"
                    >
                      <Plus size={16} />
                      {t('instance.empty.selected.button')}
                    </button>
                  </section>
                )}
              </motion.div>
            )}

            {activeView === 'skins' && (
              <motion.div key="skins" {...pageMotionProps}>
                <Suspense fallback={
                  <section className="flex min-h-[520px] items-center justify-center rounded-lg border border-slate-800 bg-[#0d1526]">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-500">
                      <Loader2 size={17} className="animate-spin text-blue-300" />
                      {t('skin.loading')}
                    </div>
                  </section>
                }>
                  <SkinPage
                    accounts={accounts}
                    activeAccountId={activeAccountId}
                    language={language}
                    onRequestLogin={() => {
                      setLoginStep('select')
                      setShowLoginModal(true)
                    }}
                    onStatus={setStatusText}
                    onLibraryChange={(library) => {
                      const texture = library.effectiveSkin?.textureDataUrl || ''
                      if (!texture) return
                      setAccountSkinTextures((current) => (
                        current[library.accountId] === texture
                          ? current
                          : { ...current, [library.accountId]: texture }
                      ))
                    }}
                  />
                </Suspense>
              </motion.div>
            )}

            {activeView === 'library' && (
              <motion.section
                ref={librarySectionRef}
                key="library"
                {...pageMotionProps}
                aria-labelledby="library-page-title"
                aria-busy={libraryLoading}
                className="rounded-lg border border-slate-800 bg-[#0d1526]"
              >
                <div className="border-b border-slate-800 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2
                        ref={libraryHeadingRef}
                        id="library-page-title"
                        tabIndex={-1}
                        className="rounded-sm text-2xl font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0d1526]"
                      >
                        {t('library.title')}
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{t('library.subtitle')}</p>
                      {currentTarget && libraryType !== 'modpack' && (
                        <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[11px] font-black text-blue-200">
                          <Package size={13} aria-hidden="true" className="shrink-0" />
                          <span className="truncate">{tf('library.targetInstance', { name: currentTarget.name })}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-end gap-2">
                      <LibrarySourceSelect value={librarySource} label={t('library.source')} onChange={selectLibrarySource} />
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950/30 p-1" role="group" aria-label={t('library.categories')}>
                      {libraryTypes.map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          aria-pressed={libraryType === type.id}
                          onClick={() => {
                            setLibraryType(type.id)
                            setLibraryPage(0)
                          }}
                          className={classNames(
                            'h-9 rounded-md px-3 text-xs font-black transition-colors duration-150',
                            libraryType === type.id ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-100'
                          )}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative min-w-[280px] flex-1">
                      <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        value={modQuery}
                        onChange={(event) => {
                          setModQuery(event.target.value)
                          setLibraryPage(0)
                        }}
                        placeholder={tf('library.search', { source: librarySource === 'curseforge' ? 'CurseForge' : 'Modrinth' })}
                        aria-label={tf('library.search', { source: librarySource === 'curseforge' ? 'CurseForge' : 'Modrinth' })}
                        maxLength={LIBRARY_SEARCH_QUERY_MAX_LENGTH}
                        autoComplete="off"
                        spellCheck={false}
                        className="no-drag h-11 w-full rounded-lg border border-slate-800 bg-slate-950/40 pl-10 pr-3 text-sm font-bold outline-none transition-colors duration-150 placeholder:text-slate-600 focus:border-blue-400/60"
                      />
                      {libraryLoading && (
                        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                          <Loader2 size={16} className="animate-spin text-blue-300" />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Wrench size={14} aria-hidden="true" className="text-blue-300" />
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-300">
                          {t('library.filters')}
                        </p>
                        {activeLibraryFilterCount > 0 && (
                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-black text-blue-200">
                            {tf('library.filters.active', { count: activeLibraryFilterCount })}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={activeLibraryFilterCount === 0}
                        onClick={resetLibraryFilters}
                        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-black text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        {t('library.filters.reset')}
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-2" role="group" aria-label={t('library.filters')}>
                      {libraryCompatibilityAvailable && currentTarget && (
                        <button
                          type="button"
                          aria-pressed={effectiveLibraryFilters.compatibleOnly}
                          onClick={() => updateLibraryFilters({
                            compatibleOnly: !effectiveLibraryFilters.compatibleOnly
                          })}
                          className={classNames(
                            'h-10 max-w-[260px] truncate rounded-md border px-3 text-xs font-black transition-colors',
                            effectiveLibraryFilters.compatibleOnly
                              ? 'border-blue-400/45 bg-blue-500/15 text-blue-100'
                              : 'border-slate-700 bg-slate-950/30 text-slate-400 hover:border-blue-400/35 hover:text-slate-200'
                          )}
                          data-tooltip={tf('library.filters.compatible', { name: currentTarget.name })}
                        >
                          {tf('library.filters.compatible', { name: currentTarget.name })}
                        </button>
                      )}

                      <label>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                          {t('library.filters.sort')}
                        </span>
                        <select
                          value={effectiveLibraryFilters.sort}
                          onChange={(event) => updateLibraryFilters({ sort: event.target.value as LibrarySort })}
                          className="h-10 min-w-[150px] cursor-pointer rounded-md border border-slate-700 bg-slate-950/40 px-3 text-xs font-black text-slate-100 outline-none focus:border-blue-400/60"
                        >
                          {librarySource === 'modrinth' && (
                            <option value="relevance">{t('library.filters.sort.relevance')}</option>
                          )}
                          <option value="downloads">{t('library.filters.sort.downloads')}</option>
                          <option value="updated">{t('library.filters.sort.updated')}</option>
                          <option value="newest">{t('library.filters.sort.newest')}</option>
                        </select>
                      </label>

                      <label>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                          {t('library.filters.gameVersion')}
                        </span>
                        <select
                          value={resolvedLibraryFilters.gameVersion}
                          disabled={effectiveLibraryFilters.compatibleOnly}
                          onChange={(event) => updateLibraryFilters({ gameVersion: event.target.value })}
                          className="h-10 min-w-[145px] cursor-pointer rounded-md border border-slate-700 bg-slate-950/40 px-3 text-xs font-black text-slate-100 outline-none focus:border-blue-400/60 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <option value="">{t('library.filters.allVersions')}</option>
                          {libraryMinecraftVersionOptions.map((version) => (
                            <option key={version} value={version}>{version}</option>
                          ))}
                        </select>
                      </label>

                      {libraryLoaderFilterAvailable && (
                        <label>
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                            {t('library.filters.loader')}
                          </span>
                          <select
                            value={resolvedLibraryFilters.loader}
                            disabled={effectiveLibraryFilters.compatibleOnly}
                            onChange={(event) => updateLibraryFilters({
                              loader: event.target.value as LibrarySearchFilters['loader']
                            })}
                            className="h-10 min-w-[130px] cursor-pointer rounded-md border border-slate-700 bg-slate-950/40 px-3 text-xs font-black capitalize text-slate-100 outline-none focus:border-blue-400/60 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <option value="">{t('library.filters.allLoaders')}</option>
                            {LIBRARY_LOADERS.map((loader) => (
                              <option key={loader} value={loader}>{loader}</option>
                            ))}
                          </select>
                        </label>
                      )}

                      {librarySource === 'modrinth' && libraryType === 'mod' && (
                        <label>
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                            {t('library.filters.environment')}
                          </span>
                          <select
                            value={effectiveLibraryFilters.environment}
                            onChange={(event) => updateLibraryFilters({
                              environment: event.target.value as LibraryEnvironment
                            })}
                            className="h-10 min-w-[150px] cursor-pointer rounded-md border border-slate-700 bg-slate-950/40 px-3 text-xs font-black text-slate-100 outline-none focus:border-blue-400/60"
                          >
                            <option value="all">{t('library.filters.environment.all')}</option>
                            <option value="client">{t('library.filters.environment.client')}</option>
                            <option value="server">{t('library.filters.environment.server')}</option>
                            <option value="both">{t('library.filters.environment.both')}</option>
                          </select>
                        </label>
                      )}

                      {librarySource === 'modrinth' && (
                        <button
                          type="button"
                          aria-pressed={effectiveLibraryFilters.openSourceOnly}
                          onClick={() => updateLibraryFilters({
                            openSourceOnly: !effectiveLibraryFilters.openSourceOnly
                          })}
                          className={classNames(
                            'h-10 rounded-md border px-3 text-xs font-black transition-colors',
                            effectiveLibraryFilters.openSourceOnly
                              ? 'border-blue-400/45 bg-blue-500/15 text-blue-100'
                              : 'border-slate-700 bg-slate-950/30 text-slate-400 hover:border-blue-400/35 hover:text-slate-200'
                          )}
                        >
                          {t('library.filters.openSource')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {libraryError && (
                  <div role="alert" aria-atomic="true" className="border-b border-red-400/15 bg-red-500/[0.06] px-5 py-3 text-xs font-bold text-red-200">
                    {libraryError}
                  </div>
                )}

                <LibraryPagination
                  idPrefix="library"
                  placement="top"
                  currentPage={libraryPage}
                  totalHits={totalHits}
                  resultText={libraryResultsText}
                  statusText={libraryPaginationStatusText}
                  labels={libraryPaginationLabels}
                  loading={libraryLoading}
                  onPageChange={goToLibraryPage}
                  className="border-b border-slate-800 bg-slate-950/10"
                />

                <div className="divide-y divide-slate-800">
                  {!libraryLoading && mods.length === 0 && (
                    <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
                      <Package size={32} className="text-slate-700" />
                      <p className="mt-3 text-sm font-black text-slate-400">
                        {librarySource === 'curseforge' && !curseForgeConfigured ? t('library.empty.proxy.title') : t('library.empty.title')}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-600">
                        {librarySource === 'curseforge' && !curseForgeConfigured
                          ? t('library.empty.proxy.body')
                          : t('library.empty.body')}
                      </p>
                    </div>
                  )}
                  {mods.map((mod) => {
                    const projectId = getProjectKey(mod)
                    const status = contentStatuses[projectId]
                    const buttonState = getLibraryButtonState(mod)

                    return (
                      <div key={mod.project_id} className="nam-interactive-surface flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-slate-800/35">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-slate-600">
                          <CachedImage
                            src={mod.icon_url}
                            alt=""
                            className="h-full w-full object-cover"
                            fallback={<Package size={20} />}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate text-base font-black text-white">{mod.title}</h3>
                            <span className={classNames(
                              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase',
                              mod.provider === 'curseforge'
                                ? 'bg-orange-500/15 text-orange-200'
                                : 'bg-blue-500/15 text-blue-200'
                            )}>
                              {mod.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                            </span>
                            {status?.state === 'installed' && (
                              <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-blue-200">{t('library.status.installed')}</span>
                            )}
                            {status?.state === 'update' && (
                              <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-sky-200">{t('library.status.update')}</span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-500">{mod.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600">
                            <span>{mod.author}</span>
                            <span className="flex items-center gap-1"><Download size={13} />{Number(mod.downloads || 0).toLocaleString()}</span>
                            {status?.state === 'installed' && status.installedVersion && (
                              <span className="font-mono text-blue-300">{tf('library.status.installedVersion', { version: status.installedVersion })}</span>
                            )}
                            {status?.state === 'update' && (
                              <span className="font-mono text-sky-300">
                                {status.installedVersion || t('library.status.installed')} -&gt; {status.latestVersion || t('library.status.latest')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => void openLibraryProjectDetails(mod, event.currentTarget)}
                            className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-600 bg-slate-950/25 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/55 hover:bg-blue-500/10 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                            data-tooltip={t('library.detail.openTooltip')}
                          >
                            <FileText size={15} aria-hidden="true" />
                            {t('library.button.openProject')}
                          </button>
                          <button
                            disabled={buttonState.disabled}
                            onClick={() => installLibraryProject(mod)}
                            className={classNames(
                              'flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-md px-3 text-xs font-black transition-colors duration-150 disabled:cursor-not-allowed',
                              buttonState.kind === 'installed'
                                ? 'bg-blue-500/15 text-blue-200'
                                : buttonState.kind === 'update'
                                  ? 'bg-sky-500 text-white hover:bg-sky-400'
                                  : buttonState.disabled
                                    ? 'bg-slate-700 text-slate-400'
                                    : 'bg-blue-500 text-white hover:bg-blue-400'
                            )}
                            data-tooltip={buttonState.title}
                          >
                            {buttonState.kind === 'installing' && <Loader2 size={15} className="animate-spin" />}
                            {buttonState.kind === 'installed' && <CheckCircle2 size={15} />}
                            {buttonState.kind === 'update' && <RefreshCw size={15} />}
                            {buttonState.kind === 'install' && <Download size={15} />}
                            {buttonState.kind === 'disabled' && <Download size={15} />}
                            {buttonState.label}
                          </button>
                          <button
                            onClick={() => window.electron.openExternal(
                              mod.website_url || `https://modrinth.com/${mod.project_type || libraryType}/${mod.slug}`
                            )}
                            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                            data-tooltip={tf('library.openOn', { source: mod.provider === 'curseforge' ? 'CurseForge' : 'Modrinth' })}
                            aria-label={tf('library.openOn', { source: mod.provider === 'curseforge' ? 'CurseForge' : 'Modrinth' })}
                          >
                            <ExternalLink size={15} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <LibraryPagination
                  idPrefix="library"
                  placement="bottom"
                  currentPage={libraryPage}
                  totalHits={totalHits}
                  resultText={libraryResultsText}
                  statusText={libraryPaginationStatusText}
                  labels={libraryPaginationLabels}
                  loading={libraryLoading}
                  onPageChange={goToLibraryPage}
                  className="border-t border-slate-800"
                />
              </motion.section>
            )}

            {activeView === 'settings' && (
              <motion.section key="settings" {...pageMotionProps} onAnimationComplete={focusDiscordAccountSection} className="max-w-4xl space-y-5">
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h2 className="text-2xl font-black tracking-tight">{t('settings.title')}</h2>
                  <p className="mt-1 text-pretty text-sm font-semibold text-slate-500">{t('settings.subtitle')}</p>
                </motion.div>

                <motion.div
                  variants={settingsCardVariants}
                  initial="hidden"
                  animate="show"
                  className="nam-settings-card relative overflow-hidden rounded-xl border border-blue-400/20 bg-[linear-gradient(135deg,rgba(30,64,175,0.22),rgba(13,21,38,0.96)_48%,rgba(15,23,42,0.96))] p-5"
                >
                  <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-blue-400/10 blur-3xl" />
                  <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-300/25 bg-blue-400/10 text-blue-100 shadow-[0_12px_30px_rgba(37,99,235,0.18)]">
                        <Package size={21} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-black text-white">{t('settings.about.title')}</h3>
                        <p className="mt-1 text-pretty text-xs font-semibold text-slate-400">{t('settings.about.subtitle')}</p>
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2">
                      <div className="rounded-lg border border-white/10 bg-slate-950/35 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{t('settings.about.version')}</p>
                        <p className="mt-1 font-mono text-sm font-black tabular-nums text-blue-100">v{currentLauncherVersion}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/35 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{t('settings.about.channel')}</p>
                        <p className="mt-1 text-sm font-black capitalize text-slate-100">{currentLauncherChannel}</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-semibold text-slate-400">
                      {launcherUpdate?.updateAvailable
                        ? `${t('settings.update.latest')} v${launcherUpdate.latestVersion}`
                        : t('settings.about.ready')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.electron.openExternal(NAMLAUNCHER_DISCORD_URL)}
                        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-indigo-300/30 bg-indigo-500/10 px-3 text-xs font-black text-indigo-100 transition-colors duration-150 hover:border-indigo-300/55 hover:bg-indigo-500/18"
                      >
                        <DiscordLogo className="h-[15px] w-[15px]" />
                        {t('settings.discord.join')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void checkForLauncherUpdateNow()}
                        disabled={checkingLauncherUpdate}
                        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-950/35 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-300/45 hover:bg-blue-500/10 hover:text-blue-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        {checkingLauncherUpdate ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                        {checkingLauncherUpdate ? t('settings.update.checking') : t('settings.update.check')}
                      </button>
                      <button
                        type="button"
                        onClick={openLegalReview}
                        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-blue-300/30 bg-blue-500/10 px-3 text-xs font-black text-blue-100 transition-colors duration-150 hover:border-blue-300/55 hover:bg-blue-500/18"
                      >
                        <ShieldCheck size={15} />
                        {t('settings.legal.button')}
                      </button>
                    {launcherUpdate?.updateAvailable && (
                      <button
                        onClick={openLauncherUpdatePrompt}
                        disabled={launcherUpdateInstallState === 'installing'}
                        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-500 px-3 text-xs font-black text-white hover:bg-blue-400 disabled:cursor-wait disabled:opacity-65"
                      >
                        {launcherUpdateInstallState === 'installing' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {t('settings.update.download')}
                      </button>
                    )}
                    </div>
                  </div>
                  <div className="relative mt-4 grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => window.electron.openExternal('https://nattapat2871.me/')}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/35 px-4 py-3 text-left transition-colors hover:border-blue-300/40 hover:bg-blue-500/[0.08]"
                      aria-label={t('settings.about.openDeveloper')}
                    >
                      <span className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                          {t('settings.about.developerLabel')}
                        </span>
                        <span className="mt-1 block truncate text-sm font-black text-white">{t('settings.about.developerName')}</span>
                      </span>
                      <ExternalLink size={15} className="shrink-0 text-blue-200 transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => window.electron.openExternal('https://namlauncher.nattapat2871.me/')}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/35 px-4 py-3 text-left transition-colors hover:border-blue-300/40 hover:bg-blue-500/[0.08]"
                      aria-label={t('settings.support.button')}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <MessageCircle size={18} className="shrink-0 text-blue-300" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-white">{t('settings.support.title')}</span>
                          <span className="mt-1 block truncate text-xs font-semibold text-slate-500">{t('settings.support.subtitle')}</span>
                        </span>
                      </span>
                      <ExternalLink size={15} className="shrink-0 text-blue-200 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                  <div className="relative mt-4 border-t border-white/10 pt-4">
                    <div className="mb-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-200">{t('settings.about.partnersTitle')}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{t('settings.about.partnersSubtitle')}</p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {PARTNER_SERVERS.map((server) => (
                        <button
                          key={server.id}
                          type="button"
                          onClick={() => openPartnerServerWebsite(server)}
                          className="group flex min-w-0 items-center gap-3 rounded-lg border border-blue-300/20 bg-blue-500/[0.07] p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-blue-200/55 hover:bg-blue-400/10 hover:shadow-[0_0_30px_rgba(59,130,246,0.16)]"
                          aria-label={tf('settings.about.openPartner', { name: server.name })}
                        >
                          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/25 text-blue-200 ring-1 ring-blue-200/20 transition-transform duration-200 group-hover:scale-105">
                            <Server size={21} aria-hidden="true" />
                            <img
                              src={server.iconUrl}
                              alt=""
                              loading={server.id === 'minisand' ? 'eager' : 'lazy'}
                              decoding="async"
                              className="absolute inset-0 h-full w-full bg-black/25 object-contain"
                              onError={(event) => { event.currentTarget.style.display = 'none' }}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-blue-200/75">
                              {server.relationship === 'owned' ? t('settings.about.ownedServer') : t('settings.about.partnerTitle')}
                            </span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-black text-white">
                              <span className="truncate">{server.name}</span>
                              <ExternalLink size={13} className="shrink-0 text-blue-200" />
                            </span>
                            <span className="mt-1 block truncate font-mono text-[11px] font-semibold text-slate-500">{server.address}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                <div className="nam-settings-card rounded-lg border border-slate-800 bg-[#0d1526]">
                  <div className="flex items-center gap-3 border-b border-slate-800 p-5">
                    <MonitorDown size={20} className="text-blue-300" />
                    <div>
                      <h3 className="font-black">{t('settings.performance.title')}</h3>
                      <p className="text-xs font-semibold text-slate-500">{t('settings.performance.subtitle')}</p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div>
                        <p className="text-sm font-black text-slate-100">{t('settings.performance.profile.title')}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                          {t('settings.performance.profile.subtitle')}
                        </p>
                      </div>
                      <div
                        className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
                        role="group"
                        aria-label={t('settings.performance.profile.title')}
                      >
                        {(['automatic', 'low-spec', 'balanced', 'max-fps'] as PerformanceProfile[]).map((profile) => (
                          <button
                            key={profile}
                            type="button"
                            aria-pressed={discordSettings.performanceProfile === profile}
                            onClick={() => updateLauncherSettings({ ...discordSettings, performanceProfile: profile })}
                            className={classNames(
                              'h-10 rounded-md border px-3 text-xs font-black transition-colors',
                              discordSettings.performanceProfile === profile
                                ? 'border-blue-300/60 bg-blue-500/15 text-blue-100'
                                : 'border-slate-700 text-slate-400 hover:border-blue-400/40 hover:bg-blue-500/[0.06] hover:text-slate-100'
                            )}
                          >
                            {t(`settings.performance.profile.${profile}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-100">{t('settings.autoMinimize.title')}</p>
                        <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
                          {discordSettings.autoMinimizeOnLaunch ? t('settings.autoMinimize.on') : t('settings.autoMinimize.off')}
                        </p>
                      </div>
                      <SwitchControl
                        checked={discordSettings.autoMinimizeOnLaunch}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          autoMinimizeOnLaunch: !discordSettings.autoMinimizeOnLaunch
                        })}
                        title={t('settings.autoMinimize.title')}
                      />
                    </div>
                    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-100">{t('settings.closeToTray.title')}</p>
                        <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
                          {discordSettings.closeToTrayEnabled ? t('settings.closeToTray.on') : t('settings.closeToTray.off')}
                        </p>
                      </div>
                      <SwitchControl
                        checked={discordSettings.closeToTrayEnabled}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          closeToTrayEnabled: !discordSettings.closeToTrayEnabled
                        })}
                        title={t('settings.closeToTray.title')}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Languages size={18} className="shrink-0 text-blue-300" />
                        <div>
                          <p className="text-sm font-black text-slate-100">{t('settings.language.title')}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{t('settings.language.subtitle')}</p>
                        </div>
                      </div>
                      <div className="flex rounded-lg border border-slate-800 bg-slate-950/40 p-1">
                        {(['en', 'th'] as LauncherLanguage[]).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => updateLauncherSettings({ ...discordSettings, language: lang })}
                            className={classNames(
                              'h-9 min-w-[54px] rounded-md px-3 text-xs font-black transition-[background-color,color,box-shadow] duration-150',
                              language === lang
                                ? 'bg-blue-500 text-white shadow-lg shadow-blue-950/30'
                                : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-100'
                            )}
                          >
                            {lang.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="nam-settings-card rounded-lg border border-slate-800 bg-[#0d1526]">
                  <div className="flex items-center gap-3 border-b border-slate-800 p-5">
                    <FolderOpen size={20} className="text-blue-300" />
                    <div>
                      <h3 className="font-black">{t('settings.storage.title')}</h3>
                      <p className="text-xs font-semibold text-slate-500">{t('settings.storage.subtitle')}</p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className={classNames(
                      'rounded-lg border bg-slate-950/20 p-4',
                      dataLocationStatus === 'error' ? 'border-red-400/30' : 'border-slate-800'
                    )}>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">{t('settings.storage.current')}</p>
                      {dataLocationStatus === 'loading' ? (
                        <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-400" role="status">
                          <Loader2 size={14} className="shrink-0 animate-spin text-blue-300" />
                          {t('settings.storage.loading')}
                        </div>
                      ) : dataLocationStatus === 'error' ? (
                        <div className="mt-2 flex flex-col items-start gap-3" role="alert">
                          <div>
                            <p className="text-xs font-black text-red-200">{t('settings.storage.loadFailed')}</p>
                            {dataLocationError && (
                              <p className="mt-1 break-words font-mono text-[11px] font-semibold leading-5 text-red-200/60">
                                {dataLocationError}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadLauncherDataLocation()}
                            className="flex h-9 items-center gap-2 rounded-md border border-red-300/30 bg-red-500/10 px-3 text-xs font-black text-red-100 transition-colors duration-150 hover:bg-red-500/18"
                          >
                            <RefreshCw size={14} />
                            {t('settings.storage.retry')}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 break-all font-mono text-xs font-semibold leading-5 text-slate-300">
                          {dataLocation?.currentPath || t('settings.storage.unavailable')}
                        </p>
                      )}
                    </div>
                    {dataLocation?.nextPath && dataLocation.restartRequired && (
                      <div className="rounded-lg border border-blue-400/25 bg-blue-500/[0.08] p-4">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-200">{t('settings.storage.next')}</p>
                        <p className="mt-2 break-all font-mono text-xs font-semibold leading-5 text-blue-50/80">
                          {dataLocation.nextPath}
                        </p>
                        <p className="mt-3 text-xs font-bold text-blue-100/70">{t('settings.storage.restart')}</p>
                      </div>
                    )}
                    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="max-w-xl text-xs font-semibold leading-5 text-slate-500">{t('settings.storage.note')}</p>
                      <button
                        type="button"
                        disabled={movingDataLocation || gameRunning || launching}
                        onClick={chooseDataLocation}
                        className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {movingDataLocation ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                        {movingDataLocation ? t('settings.storage.moving') : t('settings.storage.button')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="nam-settings-card rounded-lg border border-slate-800 bg-[#0d1526]">
                  <div className="flex items-center gap-3 border-b border-slate-800 p-5">
                    <Cpu size={20} className="text-blue-300" />
                    <div>
                      <h3 className="font-black">{t('settings.memory.title')}</h3>
                      <p className="text-xs font-semibold text-slate-500">{t('settings.memory.subtitle')}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_140px] gap-5 p-5">
                    <input
                      type="range"
                      min={1}
                      max={32}
                      step={1}
                      value={memoryGb}
                      disabled={discordSettings.automaticMemory}
                      onChange={(event) => handleMemoryChange(Number(event.target.value))}
                      className="nam-range mt-3 w-full"
                    />
                    <div className="flex h-12 items-center rounded-lg border border-slate-700 bg-slate-950/30 px-3 focus-within:border-blue-400/60">
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={memoryGb}
                        disabled={discordSettings.automaticMemory}
                        onChange={(event) => handleMemoryChange(Number(event.target.value))}
                        className="w-full bg-transparent text-right font-mono text-xl font-black outline-none"
                      />
                      <span className="ml-2 text-sm font-black text-blue-300">GB</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-800 p-5">
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-100">{t('settings.memory.automatic.title')}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{t('settings.memory.automatic.body')}</p>
                      </div>
                      <SwitchControl
                        checked={discordSettings.automaticMemory}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          automaticMemory: !discordSettings.automaticMemory
                        })}
                        title={t('settings.memory.automatic.title')}
                      />
                    </div>
                  </div>
                  <div className="border-t border-slate-800 p-5">
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-100">{t('settings.java.title')}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {t('settings.java.body')}
                        </p>
                      </div>
                      <SwitchControl
                        checked={discordSettings.customJavaArgsEnabled}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          customJavaArgsEnabled: !discordSettings.customJavaArgsEnabled
                        })}
                        title={discordSettings.customJavaArgsEnabled ? 'Disable custom Java arguments' : 'Enable custom Java arguments'}
                      />
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      {discordSettings.customJavaArgsEnabled && (
                        <motion.div
                          key="custom-java-arguments"
                          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.99 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.99 }}
                          transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                          className="mt-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3"
                        >
                          <textarea
                            value={discordSettings.customJavaArgs}
                            onChange={(event) => setDiscordSettings((prev) => ({ ...prev, customJavaArgs: event.target.value }))}
                            onBlur={(event) => updateLauncherSettings({
                              ...discordSettings,
                              customJavaArgs: event.target.value
                            })}
                            spellCheck={false}
                            rows={4}
                            placeholder="-XX:+UseG1GC -XX:+UseStringDeduplication"
                            className="min-h-[112px] w-full resize-y bg-transparent font-mono text-xs font-semibold leading-6 text-slate-200 outline-none placeholder:text-slate-600"
                          />
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="text-[11px] font-semibold text-slate-600">
                              {t('settings.java.note')}
                            </p>
                            <button
                              onClick={() => updateLauncherSettings(discordSettings)}
                              className="h-8 rounded-md bg-blue-500 px-3 text-[11px] font-black text-white transition-colors duration-150 hover:bg-blue-400"
                            >
                              {t('settings.java.save')}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="nam-settings-card rounded-lg border border-slate-800 bg-[#0d1526]">
                  <div className="flex items-center gap-3 border-b border-slate-800 p-5">
                    <ShieldCheck size={20} className="text-blue-300" />
                    <div>
                      <h3 className="font-black">{t('settings.privacy.title')}</h3>
                      <p className="text-xs font-semibold text-slate-500">{t('settings.privacy.subtitle')}</p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div ref={discordAccountSectionRef} id="discord-account-settings" tabIndex={-1} aria-labelledby="discord-account-heading" className="scroll-mt-5 rounded-lg border border-indigo-300/20 bg-indigo-500/[0.06] p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          {launcherDiscordAccount?.connected && launcherDiscordAccount.profile ? (
                            <img
                              src={launcherDiscordAccount.profile.avatarUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="h-12 w-12 shrink-0 rounded-full bg-slate-900 object-cover ring-2 ring-indigo-300/25"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-300/25">
                              <DiscordLogo className="h-6 w-6" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p id="discord-account-heading" className="text-sm font-black text-slate-100">{t('settings.discordAccount.title')}</p>
                            {launcherDiscordAccount?.connected && launcherDiscordAccount.profile ? (
                              <>
                                <p className="mt-1 truncate text-sm font-black text-white">{launcherDiscordAccount.profile.displayName}</p>
                                <p className="truncate text-xs font-semibold text-slate-500">@{launcherDiscordAccount.profile.username}</p>
                              </>
                            ) : (
                              <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
                                {t('settings.discordAccount.subtitle')}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={launcherDiscordAccountBusy}
                          onClick={() => void (launcherDiscordAccount?.connected ? requestDisconnectLauncherDiscord() : connectLauncherDiscord())}
                          className={classNames(
                            'flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-xs font-black transition-colors disabled:cursor-wait disabled:opacity-60',
                            launcherDiscordAccount?.connected
                              ? 'border border-slate-700 text-slate-200 hover:border-red-300/40 hover:bg-red-500/10 hover:text-red-100'
                              : 'bg-indigo-500 text-white hover:bg-indigo-400'
                          )}
                        >
                          {launcherDiscordAccountBusy
                            ? <Loader2 size={15} className="animate-spin" />
                            : launcherDiscordAccount?.connected
                              ? <LogOut size={15} />
                              : <DiscordLogo className="h-[15px] w-[15px] shrink-0" />}
                          {launcherDiscordAccountBusy
                            ? t('settings.discordAccount.waiting')
                            : launcherDiscordAccount?.connected
                              ? t('settings.discordAccount.logout')
                              : t('settings.discordAccount.login')}
                        </button>
                      </div>
                      {launcherDiscordAccountError && (
                        <p className="mt-3 rounded-md border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100" role="alert">
                          {launcherDiscordAccountError}
                        </p>
                      )}
                      {launcherDiscordAccount?.connected && launcherDiscordAccount.offline && (
                        <p className="mt-3 text-[11px] font-semibold text-amber-200/75">{t('settings.discordAccount.offline')}</p>
                      )}
                      {launcherDiscordAccount?.connected && !launcherDiscordAccount.persistent && (
                        <p className="mt-3 text-[11px] font-semibold text-amber-200/75">{t('settings.discordAccount.notSaved')}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-slate-100">{t('settings.discord.title')}</p>
                          <span className={classNames('rounded px-2 py-0.5 text-[10px] font-black uppercase', discordStateClass)}>
                            {discordStateLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {discordSettings.discordRpcEnabled ? t('settings.discord.on') : t('settings.discord.off')}
                        </p>
                        {discordSettings.discordRpcEnabled && (
                          <p className="mt-1 max-w-xl truncate text-[11px] font-semibold text-slate-600" data-tooltip={discordStatus?.lastError || discordStatus?.lastActivity || undefined}>
                            {discordStatus?.lastError
                              ? discordStatus.lastError
                              : discordStatus?.lastActivity
                                ? `Last activity: ${discordStatus.lastActivity}${discordStatus.applicationId ? ` • App ${discordStatus.applicationId}` : ``}`
                                : t('settings.discord.waiting')}
                          </p>
                        )}
                      </div>
                      <SwitchControl
                        checked={discordSettings.discordRpcEnabled}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          discordRpcEnabled: !discordSettings.discordRpcEnabled
                        })}
                        title={discordSettings.discordRpcEnabled ? 'Disable Discord IPC' : 'Enable Discord IPC'}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div>
                        <p className="text-sm font-black text-slate-100">{t('settings.playerBadge.title')}</p>
                        <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
                          {discordSettings.playerBadgeEnabled
                            ? t('settings.playerBadge.on')
                            : t('settings.playerBadge.off')}
                        </p>
                      </div>
                      <SwitchControl
                        checked={discordSettings.playerBadgeEnabled}
                        onChange={() => updateLauncherSettings({
                          ...discordSettings,
                          playerBadgeEnabled: !discordSettings.playerBadgeEnabled
                        })}
                        title={discordSettings.playerBadgeEnabled ? 'Disable in-game player badges' : 'Enable in-game player badges'}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div>
                        <p className="text-sm font-black text-slate-100">{t('settings.gameplayTelemetry.title')}</p>
                        <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
                          {t('settings.gameplayTelemetry.on')}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-200">
                        <ShieldCheck size={13} /> {t('settings.required')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
                      <div>
                        <p className="text-sm font-black text-slate-100">{t('settings.stats.title')}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {t('settings.stats.on')}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-200">
                        <ShieldCheck size={13} /> {t('settings.required')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText size={18} className="shrink-0 text-blue-300" />
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-100">{t('settings.legal.title')}</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{t('settings.legal.subtitle')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openLegalReview}
                        className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                      >
                        <ShieldCheck size={15} />
                        {t('settings.legal.button')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="nam-settings-card rounded-lg border border-slate-800 bg-[#0d1526] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FileText size={20} className="text-blue-300" />
                      <div>
                        <h3 className="font-black">{t('settings.logs.title')}</h3>
                        <p className="text-xs font-semibold text-slate-500">{t('settings.logs.subtitle')}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => window.electron.openLogs()}
                      className="flex h-10 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                    >
                      <FileText size={15} />
                      {t('settings.logs.button')}
                    </button>
                  </div>
                </div>
              </motion.section>
            )}
            </AnimatePresence>
          </main>
        </section>
      </div>

      <AnimatePresence mode="wait">
        {launcherUpdatePromptVisible && launcherUpdate && (
          <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/74 p-3 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="launcher-update-title">
            <motion.section
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.18, ease: 'easeOut' }}
              className="flex max-h-[calc(100vh-32px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-blue-300/25 bg-[#0d1526] shadow-2xl shadow-black/45"
            >
              <header className="shrink-0 border-b border-slate-800 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-300/25 bg-blue-500/12 text-blue-100 shadow-[0_12px_28px_rgba(37,99,235,0.18)]">
                    <Download size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">{t('settings.update.prompt.eyebrow')}</p>
                    <h2 id="launcher-update-title" className="mt-1 text-xl font-black leading-tight text-white">
                      {t('settings.update.prompt.title')}
                    </h2>
                    <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-400">
                      {t('settings.update.prompt.body')}
                    </p>
                  </div>
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{t('settings.update.current')}</p>
                    <p className="mt-1 font-mono text-sm font-black text-slate-100">v{launcherUpdate.currentVersion}</p>
                  </div>
                  <div className="rounded-lg border border-blue-300/25 bg-blue-500/10 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">{t('settings.update.latest')}</p>
                    <p className="mt-1 font-mono text-sm font-black text-blue-100">v{launcherUpdate.latestVersion}</p>
                  </div>
                </div>

                {launcherUpdate.notes && launcherUpdate.notes.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                    <ul className="space-y-1.5 text-xs font-semibold leading-5 text-slate-400">
                      {launcherUpdate.notes.slice(0, 3).map((note, index) => (
                        <li key={`${launcherUpdate.latestVersion}-${index}`} className="flex gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-blue-300" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {launcherUpdateStopped && (
                  <motion.div
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    role="alert"
                    aria-live="assertive"
                    className={classNames(
                      'flex items-start gap-3 rounded-lg border p-3',
                      launcherUpdateInstallState === 'blocked'
                        ? 'border-amber-300/35 bg-amber-400/10 text-amber-50'
                        : 'border-red-300/35 bg-red-400/10 text-red-50'
                    )}
                  >
                    <AlertTriangle size={19} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-balance text-sm font-black">
                        {launcherUpdateInstallState === 'blocked'
                          ? t('settings.update.prompt.blocked.title')
                          : t('settings.update.prompt.failed.title')}
                      </p>
                      <p className="mt-1 text-pretty text-xs font-semibold leading-5 opacity-85">
                        {launcherUpdateProgress?.detail || t('settings.update.prompt.failed.generic')}
                      </p>
                    </div>
                  </motion.div>
                )}

                <div className="rounded-lg border border-sky-300/18 bg-sky-500/[0.07] p-3">
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {launcherUpdateSteps.map((label, index) => {
                      const updateStopped = launcherUpdateInstallState === 'failed' || launcherUpdateInstallState === 'blocked'
                      const done = !updateStopped && index < launcherUpdateStepIndex
                      const active = !updateStopped && index === launcherUpdateStepIndex
                      return (
                        <div
                          key={label}
                          className={classNames(
                            'flex min-h-[34px] items-center gap-2 rounded-md border px-2.5 text-xs font-black transition-colors',
                            done
                              ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
                              : active
                                ? 'border-sky-300/35 bg-sky-400/12 text-sky-100'
                                : 'border-slate-800 bg-slate-950/20 text-slate-500'
                          )}
                        >
                          {done ? (
                            <CheckCircle2 size={14} className="shrink-0" />
                          ) : active && launcherUpdateInstallState === 'installing' ? (
                            <Loader2 size={14} className="shrink-0 animate-spin" />
                          ) : (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-70" />
                          )}
                          <span className="min-w-0 truncate">{label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-black text-sky-100">{launcherUpdateProgressLabel}</p>
                    {(launcherUpdateInstallState === 'installing' || launcherUpdateInstallState === 'opened') && (
                      <span className="font-mono text-xs font-black tabular-nums text-sky-200">{launcherUpdatePercent}%</span>
                    )}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950/65">
                    <div
                      className={classNames(
                        'h-full rounded-full bg-sky-400 transition-[width] duration-200',
                        launcherUpdateInstallState === 'installing' || launcherUpdateInstallState === 'opened' ? '' : 'opacity-55'
                      )}
                      style={{ width: `${launcherUpdateInstallState === 'installing' || launcherUpdateInstallState === 'opened' ? Math.max(launcherUpdatePercent, 4) : 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">
                    {launcherUpdateInstallState === 'opened'
                        ? t('settings.update.prompt.readyNotice')
                      : t('settings.update.prompt.keepNotice')}
                  </p>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold leading-5 text-slate-400">
                    {t('settings.update.prompt.manualText')}
                  </p>
                  <button
                    type="button"
                    onClick={openLauncherUpdateDownload}
                    className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-blue-300/30 bg-blue-500/10 px-3 text-xs font-black text-blue-100 transition-colors duration-150 hover:border-blue-300/55 hover:bg-blue-500/18"
                  >
                    <ExternalLink size={14} />
                    {t('settings.update.prompt.manualLink')}
                  </button>
                </div>
              </div>

              <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-800 bg-[#0b1322] p-4 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={launcherUpdate.mandatory ? () => window.electron.windowControl('quit') : dismissLauncherUpdatePrompt}
                  disabled={launcherUpdateInstallState === 'installing'}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-200 transition-[border-color,background-color,color,opacity] duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200 disabled:cursor-wait disabled:opacity-55"
                >
                  <X size={17} />
                  {t(launcherUpdate.mandatory ? 'update.auto.quit' : 'settings.update.prompt.notNow')}
                </button>
                <button
                  type="button"
                  onClick={installLauncherUpdateNow}
                  disabled={launcherUpdateInstallState === 'installing'}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-[background-color,opacity,transform] duration-150 hover:bg-blue-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-65"
                >
                  {launcherUpdateInstallState === 'installing'
                    ? <Loader2 size={17} className="animate-spin" />
                    : launcherUpdateInstallState === 'opened'
                      ? <ExternalLink size={17} />
                      : launcherUpdateStopped
                        ? <RefreshCw size={17} />
                      : <Download size={17} />}
                  {launcherUpdateInstallState === 'installing'
                    ? t('settings.update.prompt.installing')
                    : launcherUpdateInstallState === 'opened'
                      ? t('settings.update.prompt.openAgain')
                      : launcherUpdateInstallState === 'blocked' && launcherUpdateBlockReason === 'minecraft-active'
                        ? t('settings.update.prompt.retry.minecraft')
                        : launcherUpdateStopped
                          ? t('settings.update.prompt.retry')
                          : t('settings.update.prompt.install')}
                </button>
              </footer>
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {(showFirstRunSetup || showLegalReview) && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/74 p-3 backdrop-blur-md"
            onMouseDown={(event) => {
              if (!showFirstRunSetup && event.target === event.currentTarget) setShowLegalReview(false)
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex max-h-[calc(100vh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/45"
            >
              <div className="relative border-b border-slate-800 p-6">
                {!showFirstRunSetup && (
                  <button
                    type="button"
                    onClick={() => setShowLegalReview(false)}
                    aria-label={t('setup.close')}
                    className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-100"
                  >
                    <X size={17} />
                  </button>
                )}
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-blue-400/30 bg-blue-500/15">
                    <img src="./namlauncher-icon.png" alt="" className="h-14 w-14 object-contain outline-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">
                      {showFirstRunSetup ? t('setup.eyebrow') : t('settings.legal.title')}
                    </p>
                    <h2 className="mt-2 pr-8 text-2xl font-black text-white">
                      {showFirstRunSetup ? t('setup.title') : (legalDocument?.title || t('settings.legal.title'))}
                    </h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
                      {showFirstRunSetup ? t('setup.body') : t('settings.legal.subtitle')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {legalDocument ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                      <span>{t('setup.updated')} {formatDate(legalDocument.updatedAt)}</span>
                      <span aria-hidden="true">/</span>
                      <span>{legalDocument.source === 'remote' ? t('setup.source.remote') : t('setup.source.bundled')}</span>
                      <span className="rounded bg-blue-500/10 px-2 py-1 font-mono text-blue-200">v{legalDocument.version}</span>
                    </div>
                    <p className="mb-5 rounded-lg border border-blue-400/20 bg-blue-500/[0.07] p-4 text-sm font-semibold leading-6 text-slate-300">
                      {legalDocument.intro}
                    </p>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {([
                        { key: 'terms', title: t('setup.terms'), icon: ShieldCheck, sections: legalDocument.terms },
                        { key: 'privacy', title: t('setup.privacy'), icon: FileText, sections: legalDocument.privacy }
                      ] as const).map((group) => {
                        const GroupIcon = group.icon
                        return (
                          <section key={group.key} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/30">
                            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
                              <GroupIcon size={17} className="text-blue-300" />
                              <h3 className="text-sm font-black text-white">{group.title}</h3>
                            </div>
                            <div className="divide-y divide-slate-800/80">
                              {group.sections.map((section, index) => (
                                <article key={`${group.key}-${index}`} className="p-4">
                                  <h4 className="text-xs font-black text-slate-100">{section.title}</h4>
                                  <p className="mt-2 whitespace-pre-line text-xs font-semibold leading-5 text-slate-400">{section.body}</p>
                                </article>
                              ))}
                            </div>
                          </section>
                        )
                      })}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {legalDocument.references.map((reference) => (
                        <button
                          key={reference.url}
                          type="button"
                          onClick={() => window.electron.openExternal(reference.url)}
                          className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2 text-[11px] font-bold text-slate-400 transition-colors hover:border-blue-400/40 hover:text-blue-200"
                        >
                          <ExternalLink size={12} />
                          {reference.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-64 items-center justify-center gap-3 text-sm font-bold text-slate-400">
                    <Loader2 size={20} className="animate-spin text-blue-300" />
                    Loading legal document...
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 bg-[#0b1322] p-5">
                {showFirstRunSetup && (
                  <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/35 p-3 transition-colors hover:border-blue-400/30">
                    <input
                      type="checkbox"
                      checked={legalAccepted}
                      onChange={(event) => setLegalAccepted(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue-500"
                    />
                    <span className="text-xs font-bold leading-5 text-slate-300">
                      {legalDocument?.acceptance || t('setup.accept')}
                    </span>
                  </label>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={() => window.electron.openExternal('https://namlauncher.nattapat2871.me/legal')}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-200 transition-[border-color,background-color,color] duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                  >
                    <ExternalLink size={16} />
                    {t('setup.openLegal')}
                  </button>
                  {showFirstRunSetup ? (
                    <button
                      type="button"
                      disabled={!legalDocument || !legalAccepted}
                      onClick={acceptLegalTerms}
                      className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-[background-color,opacity,transform] duration-150 hover:bg-blue-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
                    >
                      <CheckCircle2 size={17} />
                      {t('setup.continue')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLegalReview(false)}
                      className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-400"
                    >
                      <X size={17} />
                      {t('setup.close')}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}


        {showLoginModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !microsoftLoginLoading) setShowLoginModal(false)
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-modal-title"
              className="max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/40"
            >
              {loginStep === 'select' ? (
                <>
                  <div className="flex items-center justify-between border-b border-slate-800 p-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-400/25 bg-blue-500/12 text-blue-200">
                        <User size={19} />
                      </div>
                      <div className="min-w-0">
                        <h2 id="login-modal-title" className="text-xl font-black">{t('auth.title')}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{t('auth.subtitle')}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowLoginModal(false)}
                      disabled={microsoftLoginLoading}
                      aria-label={t('setup.close')}
                      data-tooltip={t('setup.close')}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100"
                    >
                      <X size={17} />
                    </button>
                  </div>
                  {sessionExpiredNotice && (
                    <div className="mx-5 mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-4" role="alert">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-300/25 bg-red-500/10 text-red-100">
                          <AlertTriangle size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-red-50">{t('auth.sessionExpired.title')}</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-red-100/75">
                            {tf('auth.sessionExpired.body', { account: sessionExpiredNotice.accountName })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 p-5 sm:grid-cols-2">
                    <button
                      onClick={() => handleLogin('microsoft')}
                      disabled={microsoftLoginLoading}
                      data-launcher-autofocus="true"
                      className="group min-h-[148px] rounded-lg border border-blue-400/25 bg-blue-500/12 p-4 text-left transition-[border-color,background-color,transform] duration-150 hover:border-blue-300/50 hover:bg-blue-500/18 active:scale-[0.99]"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500 text-white shadow-lg shadow-blue-950/25">
                        {microsoftLoginLoading ? <Loader2 size={18} className="animate-spin" /> : <MicrosoftMark className="h-5 w-5" />}
                      </div>
                      <h3 className="mt-4 text-base font-black text-white">{t('auth.microsoft.title')}</h3>
                      <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">{t('auth.microsoft.body')}</p>
                    </button>
                    <button
                      onClick={openOfflineLogin}
                      className="group min-h-[148px] rounded-lg border border-slate-700 bg-slate-950/25 p-4 text-left transition-[border-color,background-color,transform] duration-150 hover:border-amber-300/35 hover:bg-amber-300/[0.06] active:scale-[0.99]"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-200">
                        <FileText size={18} />
                      </div>
                      <h3 className="mt-4 text-base font-black text-white">{t('auth.offline.title')}</h3>
                      <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">{t('auth.offline.body')}</p>
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-5">
                  <button
                    onClick={() => {
                      setOfflineNameInputRejected(false)
                      setLoginStep('select')
                    }}
                    className="mb-5 flex h-9 items-center gap-2 rounded-md px-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition-colors duration-150 hover:text-blue-200"
                  >
                    <ArrowLeft size={15} />
                    {t('auth.back')}
                  </button>
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-200">
                      <FileText size={18} />
                    </div>
                    <div>
                      <h2 id="login-modal-title" className="text-xl font-black">{t('auth.offlineProfile.title')}</h2>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{t('auth.offlineProfile.subtitle')}</p>
                    </div>
                  </div>
                  <div className="mt-5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 text-amber-200">
                        <ShieldCheck size={17} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-amber-100">{t('auth.warning.title')}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/70">
                          {t('auth.warning.body')}
                        </p>
                      </div>
                    </div>
                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300/15 bg-black/15 p-3 transition-[border-color,background-color] duration-150 hover:border-amber-300/30 hover:bg-black/20">
                      <input
                        type="checkbox"
                        checked={offlineWarningAccepted}
                        onChange={(event) => setOfflineWarningAccepted(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-amber-400"
                      />
                      <span className="text-xs font-black leading-5 text-amber-50">
                        {t('auth.warning.accept')}
                      </span>
                    </label>
                  </div>
                  <label
                    htmlFor="offline-username"
                    className="mt-5 block text-xs font-black uppercase tracking-[0.14em] text-slate-400"
                  >
                    {t('auth.offline.label')}
                  </label>
                  <input
                    id="offline-username"
                    type="text"
                    value={offlineName}
                    onChange={handleOfflineNameChange}
                    placeholder={t('auth.offline.placeholder')}
                    minLength={OFFLINE_USERNAME_MIN_LENGTH}
                    maxLength={OFFLINE_USERNAME_MAX_LENGTH}
                    pattern={OFFLINE_USERNAME_HTML_PATTERN}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby="offline-username-requirements"
                    aria-invalid={offlineNameInputRejected}
                    data-launcher-autofocus="true"
                    className={classNames(
                      'mt-2 h-12 w-full rounded-lg border bg-slate-950/40 px-4 text-sm font-black outline-none transition-colors duration-150',
                      offlineNameInputRejected
                        ? 'border-red-400/65 focus:border-red-300'
                        : 'border-slate-700 focus:border-blue-400/60'
                    )}
                    autoFocus
                  />
                  <p
                    id="offline-username-requirements"
                    aria-live="polite"
                    aria-atomic="true"
                    className={classNames(
                      'mt-2 text-xs font-semibold leading-5',
                      offlineNameInputRejected ? 'text-red-300' : 'text-slate-500'
                    )}
                  >
                    {t(offlineNameInputRejected
                      ? 'auth.offline.invalidCharacters'
                      : 'auth.offline.requirements')}
                  </p>
                  <button
                    disabled={!isValidOfflineUsername(offlineName) || !offlineWarningAccepted}
                    onClick={confirmOfflineLogin}
                    className="mt-4 flex h-12 w-full items-center justify-center rounded-lg bg-blue-500 text-sm font-black text-white transition-[background-color,opacity,transform] duration-150 hover:bg-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t('auth.createProfile')}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {microsoftLoginLoading && (
          <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/78 p-4 backdrop-blur-md" role="status" aria-live="polite">
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-sm rounded-xl border border-blue-300/25 bg-[#0d1526] p-6 text-center shadow-2xl shadow-black/45"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-blue-300/25 bg-blue-500/12">
                <Loader2 size={24} className="animate-spin text-blue-200" />
              </div>
              <h2 className="mt-5 text-lg font-black text-white">{t('auth.microsoft.loading')}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{t('auth.microsoft.loading.body')}</p>
            </motion.div>
          </div>
        )}

        {selectedScreenshot && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/88 p-4 backdrop-blur-md"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeScreenshotViewer()
            }}
            onWheel={(event) => {
              event.preventDefault()
              adjustScreenshotZoom(event.deltaY > 0 ? -0.1 : 0.1)
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              role="dialog"
              aria-modal="true"
              aria-label={selectedScreenshot.fileName}
              className="flex h-full max-h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#07101f] shadow-2xl shadow-black/60"
            >
              <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/75 px-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-100" data-tooltip={selectedScreenshot.fileName}>
                    {selectedScreenshot.fileName}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                    {formatBytes(selectedScreenshot.size)} · {formatDate(selectedScreenshot.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustScreenshotZoom(-0.2)}
                    className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:border-blue-300/45 hover:bg-blue-500/10 hover:text-blue-100"
                    data-tooltip={t('screenshot.zoomOut')}
                    aria-label={t('screenshot.zoomOut')}
                  >
                    <ZoomOut size={15} />
                  </button>
                  <span className="w-14 text-center font-mono text-xs font-black tabular-nums text-slate-300">
                    {Math.round(screenshotZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustScreenshotZoom(0.2)}
                    className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:border-blue-300/45 hover:bg-blue-500/10 hover:text-blue-100"
                    data-tooltip={t('screenshot.zoomIn')}
                    aria-label={t('screenshot.zoomIn')}
                  >
                    <ZoomIn size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={resetScreenshotZoom}
                    className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:border-blue-300/45 hover:bg-blue-500/10 hover:text-blue-100"
                    data-tooltip={t('screenshot.resetZoom')}
                    aria-label={t('screenshot.resetZoom')}
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={closeScreenshotViewer}
                    className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                    data-tooltip={t('setup.close')}
                    aria-label={t('setup.close')}
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
              <div
                className={classNames(
                  'flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/45 p-4 touch-none',
                  screenshotZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                )}
                onPointerDown={startScreenshotPan}
                onPointerMove={moveScreenshotPan}
                onPointerUp={stopScreenshotPan}
                onPointerCancel={stopScreenshotPan}
              >
                {selectedScreenshot.iconUrl ? (
                  <img
                    src={selectedScreenshot.iconUrl}
                    alt=""
                    draggable={false}
                    className={classNames(
                      'max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl shadow-black/50',
                      screenshotDragging ? '' : 'transition-transform duration-100'
                    )}
                    style={{
                      transform: `translate3d(${screenshotPan.x}px, ${screenshotPan.y}px, 0) scale(${screenshotZoom})`,
                      transformOrigin: 'center center',
                      willChange: screenshotZoom > 1 ? 'transform' : undefined
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <ImageIcon size={32} />
                    <p className="text-sm font-bold">{t('screenshot.previewUnavailable')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {confirmDialog && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) dismissConfirmDialog()
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/50"
            >
              <header className="flex items-start gap-4 border-b border-slate-800 p-5">
                <div className={classNames(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border',
                  confirmDialog.danger
                    ? 'border-red-400/30 bg-red-500/12 text-red-100'
                    : 'border-blue-400/30 bg-blue-500/12 text-blue-100'
                )}>
                  {confirmDialog.danger ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="confirm-dialog-title" className="text-lg font-black text-white">{confirmDialog.title}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{confirmDialog.body}</p>
                </div>
                <button
                  type="button"
                  onClick={dismissConfirmDialog}
                  disabled={confirmDialogBusy}
                  aria-label={confirmDialog.cancelLabel}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100 disabled:cursor-wait disabled:opacity-45"
                >
                  <X size={17} />
                </button>
              </header>
              {confirmDialogError && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-500/[0.08] px-3 py-2 text-xs font-semibold leading-5 text-red-100" role="alert">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-300" />
                  <span className="min-w-0 break-words">{confirmDialogError}</span>
                </div>
              )}
              <footer className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={dismissConfirmDialog}
                  disabled={confirmDialogBusy}
                  className="flex h-10 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-200 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-45"
                >
                  {confirmDialog.cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={confirmDialogConfirm}
                  disabled={confirmDialogBusy}
                  className={classNames(
                    'flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-black text-white transition-colors duration-150 disabled:cursor-wait disabled:opacity-60',
                    confirmDialog.danger
                      ? 'bg-red-500 hover:bg-red-400'
                      : 'bg-blue-500 hover:bg-blue-400'
                  )}
                >
                  {confirmDialogBusy && <Loader2 size={16} className="animate-spin" />}
                  {confirmDialog.confirmLabel}
                </button>
              </footer>
            </motion.div>
          </div>
        )}

        {libraryProjectDetails && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && installingProjectId !== getProjectKey(libraryProjectDetails)) {
                closeLibraryProjectDetails()
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-project-detail-title"
          >
            <motion.div
              ref={libraryProjectDialogRef}
              tabIndex={-1}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.99 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-3xl overflow-hidden rounded-xl border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/45 outline-none"
            >
              <header className="flex items-start gap-4 border-b border-slate-800 p-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-slate-600">
                  <CachedImage
                    src={libraryProjectDetails.icon_url}
                    alt=""
                    className="h-full w-full object-cover"
                    fallback={<Package size={20} aria-hidden="true" />}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('library.detail.eyebrow')}</p>
                  <h2 id="library-project-detail-title" className="mt-1 truncate text-xl font-black text-white">
                    {libraryProjectDetails.title || libraryProjectDetails.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-500">{libraryProjectDetails.description}</p>
                </div>
                <button
                  type="button"
                  data-dialog-autofocus="true"
                  onClick={closeLibraryProjectDetails}
                  disabled={installingProjectId === getProjectKey(libraryProjectDetails)}
                  aria-label={t('library.detail.close')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </header>

              <div className="p-5">
                {libraryProjectVersionsLoading ? (
                  <div className="flex h-64 items-center justify-center gap-2 text-sm font-bold text-slate-400" role="status" aria-live="polite">
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    {t('library.detail.loading')}
                  </div>
                ) : libraryProjectVersionError ? (
                  <div className="flex h-64 flex-col items-center justify-center text-center" role="alert">
                    <AlertTriangle size={30} className="text-amber-300" aria-hidden="true" />
                    <p className="mt-3 text-sm font-black text-white">{t('library.detail.loadFailed')}</p>
                    <p className="mt-1 max-w-md text-xs font-semibold leading-5 text-slate-500">{libraryProjectVersionError}</p>
                  </div>
                ) : libraryProjectVersions.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_270px]">
                    <div className="max-h-[390px] overflow-y-auto rounded-lg border border-slate-800" aria-label={t('library.detail.versionList')}>
                      {libraryProjectVersions.map((version) => {
                        const selected = selectedLibraryVersionId === version.id
                        return (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => setSelectedLibraryVersionId(version.id)}
                            aria-pressed={selected}
                            className={classNames(
                              'flex min-h-16 w-full items-center gap-3 border-b border-slate-800 px-4 py-3 text-left transition-colors last:border-b-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300/70',
                              selected ? 'bg-blue-500/12' : 'hover:bg-slate-800/45'
                            )}
                          >
                            <div className={classNames(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                              selected ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-900 text-slate-500'
                            )}>
                              {selected ? <CheckCircle2 size={16} aria-hidden="true" /> : <Package size={16} aria-hidden="true" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-sm font-black text-slate-100">{version.name}</p>
                                <span className={classNames(
                                  'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-black uppercase',
                                  version.version_type === 'beta'
                                    ? 'border-amber-300/40 bg-amber-400/15 text-amber-200'
                                    : version.version_type === 'alpha'
                                      ? 'border-rose-300/40 bg-rose-400/15 text-rose-200'
                                      : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                                )}>{version.version_type}</span>
                              </div>
                              <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                {version.version_number} · Minecraft {version.game_versions.slice(0, 3).join(', ') || '-'}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    <aside className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('library.detail.selected')}</p>
                      <h3 className="mt-2 break-words text-lg font-black text-white">{selectedLibraryVersion?.version_number || '-'}</h3>
                      <dl className="mt-4 space-y-3 text-xs font-bold">
                        <div>
                          <dt className="uppercase tracking-[0.14em] text-slate-600">Minecraft</dt>
                          <dd className="mt-1 text-slate-200">{selectedLibraryVersion?.game_versions.join(', ') || '-'}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-[0.14em] text-slate-600">Loader</dt>
                          <dd className="mt-1 flex flex-wrap gap-1.5 text-slate-200">
                            {(selectedLibraryVersion?.loaders || []).length > 0
                              ? selectedLibraryVersion?.loaders.map((loader) => (
                                  <span key={loader} className="inline-flex items-center gap-1 capitalize">
                                    <LoaderIcon loader={loader} className="h-5 w-5" /> {loader}
                                  </span>
                                ))
                              : '-'}
                          </dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-[0.14em] text-slate-600">{t('library.detail.published')}</dt>
                          <dd className="mt-1 text-slate-200">{formatDate(selectedLibraryVersion?.date_published)}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        onClick={installSelectedLibraryVersion}
                        disabled={!selectedLibraryVersionId || Boolean(installingProjectId) || libraryProjectDetails.allow_distribution === false}
                        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {installingProjectId === getProjectKey(libraryProjectDetails)
                          ? <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                          : <Download size={17} aria-hidden="true" />}
                        {t('library.detail.installSelected')}
                      </button>
                      <button
                        type="button"
                        onClick={() => window.electron.openExternal(
                          libraryProjectDetails.website_url || `https://modrinth.com/${libraryProjectDetails.project_type || libraryType}/${libraryProjectDetails.slug}`
                        )}
                        className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-700 text-xs font-black text-slate-300 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                        {t('library.detail.openWebsite')}
                      </button>
                    </aside>
                  </div>
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center text-center">
                    <Package size={30} className="text-slate-700" aria-hidden="true" />
                    <p className="mt-3 text-sm font-black text-slate-300">{t('library.detail.empty')}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{t('library.detail.emptyHint')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {showModpackModal && modpackProject && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (installingCurrentModpack) {
                minimizeActiveModpackInstall()
                return
              }
              closeModpackInstaller()
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modpack-install-title"
          >
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-3xl overflow-hidden rounded-lg border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/40"
            >
              <div className="flex items-center gap-4 border-b border-slate-800 p-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-slate-600">
                  <CachedImage
                    src={modpackProject.icon_url}
                    alt=""
                    className="h-full w-full object-cover"
                    fallback={<Package size={20} />}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('modpack.install.title')}</p>
                  <h2 id="modpack-install-title" className="mt-1 truncate text-xl font-black text-white">{modpackProject.title}</h2>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-500">{modpackProject.description}</p>
                </div>
                <button
                  onClick={() => {
                    if (installingCurrentModpack) {
                      minimizeActiveModpackInstall()
                      return
                    }
                    closeModpackInstaller()
                  }}
                  aria-label={installingCurrentModpack ? t('modpack.install.minimize') : t('modpack.install.close')}
                  data-tooltip={installingCurrentModpack ? t('modpack.install.minimizeTooltip') : t('modpack.install.closeTooltip')}
                  className={classNames(
                    'flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70',
                    installingCurrentModpack
                      ? 'hover:bg-blue-500/15 hover:text-blue-100'
                      : 'hover:bg-red-500/15 hover:text-red-100'
                  )}
                >
                  {installingCurrentModpack ? <Minus size={17} /> : <X size={17} />}
                </button>
              </div>

              <div className="p-5">
                {installingCurrentModpack ? (
                  <div className="rounded-lg border border-blue-400/20 bg-blue-500/[0.06] p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-400/30 bg-blue-500/15 text-blue-200">
                        <Loader2 size={20} className="animate-spin" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('modpack.install.installing')}</p>
                        <h3 className="mt-1 truncate text-lg font-black text-white">{statusText}</h3>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500" data-tooltip={activityDetail || undefined}>
                          {activityDetail || selectedModpackVersion?.version_number || t('modpack.install.preparing')}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-black tabular-nums text-blue-200">{Math.min(Math.max(progress, 0), 100)}%</span>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-900">
                      <div
                        className="h-full rounded-full bg-blue-400 transition-[width] duration-200"
                        style={{ width: `${Math.min(Math.max(progress, 4), 100)}%` }}
                      />
                    </div>
                    <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/35 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t('modpack.install.currentTask')}</p>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-300">
                        {activityDetail || t('modpack.install.downloading')}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 border-t border-blue-400/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-semibold leading-5 text-slate-500">{t('modpack.install.backgroundHint')}</p>
                      <button
                        type="button"
                        onClick={() => cancelActiveInstall()}
                        className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-rose-400/25 bg-rose-500/[0.08] px-3 text-xs font-black text-rose-100 transition-colors duration-150 hover:border-rose-300/45 hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
                      >
                        <X size={15} aria-hidden="true" />
                        {t('modpack.install.cancel')}
                      </button>
                    </div>
                  </div>
                ) : modpackVersionsLoading ? (
                  <div className="flex h-56 items-center justify-center gap-2 text-sm font-bold text-slate-500">
                    <Loader2 size={17} className="animate-spin" />
                    {t('modpack.install.loadingVersions')}
                  </div>
                ) : modpackVersions.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-[1fr_260px]">
                    <div className="max-h-[360px] overflow-y-auto rounded-lg border border-slate-800">
                      {modpackVersions.map((version) => {
                        const selected = selectedModpackVersionId === version.id
                        return (
                          <button
                            key={version.id}
                            onClick={() => setSelectedModpackVersionId(version.id)}
                            className={classNames(
                              'flex w-full items-center gap-3 border-b border-slate-800 px-4 py-3 text-left transition-colors duration-150 last:border-b-0',
                              selected ? 'bg-blue-500/12' : 'hover:bg-slate-800/45'
                            )}
                          >
                            <div className={classNames(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                              selected ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-slate-700 bg-slate-900 text-slate-500'
                            )}>
                              {selected ? <CheckCircle2 size={16} /> : <Package size={16} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-sm font-black text-slate-100">{version.name}</p>
                                <span className={classNames(
                                  'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-black uppercase',
                                  version.version_type === 'beta'
                                    ? 'border-amber-300/40 bg-amber-400/15 text-amber-200'
                                    : version.version_type === 'alpha'
                                      ? 'border-rose-300/40 bg-rose-400/15 text-rose-200'
                                      : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                                )}>
                                  {version.version_type}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                {version.version_number} / Minecraft {version.game_versions.slice(0, 3).join(', ')}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t('modpack.version.selected')}</p>
                      <h3 className="mt-2 text-lg font-black text-white">{selectedModpackVersion?.version_number || t('modpack.install.noVersion')}</h3>
                      <div className="mt-4 space-y-3 text-xs font-bold text-slate-500">
                        <div>
                          <p className="mb-1 uppercase tracking-[0.14em] text-slate-600">{t('modpack.version.minecraft')}</p>
                          <p className="text-slate-200">{selectedModpackVersion?.game_versions.join(', ') || '-'}</p>
                        </div>
                        <div>
                          <p className="mb-1 uppercase tracking-[0.14em] text-slate-600">{t('modpack.version.loaders')}</p>
                          <p className="capitalize text-slate-200">{selectedModpackVersion?.loaders.join(', ') || '-'}</p>
                        </div>
                        <div>
                          <p className="mb-1 uppercase tracking-[0.14em] text-slate-600">{t('modpack.version.published')}</p>
                          <p className="text-slate-200">{formatDate(selectedModpackVersion?.date_published)}</p>
                        </div>
                      </div>
                      <button
                        disabled={!selectedModpackVersionId || Boolean(installingProjectId) || Boolean(activeInstallTaskId)}
                        onClick={installSelectedModpack}
                        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-500 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition-colors duration-150 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {installingProjectId === getProjectKey(modpackProject) ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                        {t('modpack.install.instance')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-56 flex-col items-center justify-center text-center">
                    <Package size={30} className="text-slate-700" />
                    <p className="mt-3 text-sm font-black text-slate-400">{t('modpack.version.empty.title')}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{t('modpack.version.empty.body')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {manualDownloadItems.length > 0 && manualDownloadInstance && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (manualDownloadPendingCount === 0) closeManualDownloads()
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="manual-download-title"
              className="flex max-h-[calc(100vh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#101827] shadow-2xl shadow-black/50"
            >
              <header className={classNames(
                'flex items-start justify-between gap-4 border-b px-5 py-4',
                manualDownloadAllComplete ? 'border-emerald-400/35' : 'border-red-500/45'
              )}>
                <div className="min-w-0">
                  <p className={classNames(
                    'text-[11px] font-black uppercase tracking-[0.18em]',
                    manualDownloadAllComplete ? 'text-emerald-300' : 'text-red-300'
                  )}>
                    {manualDownloadAllComplete ? t('manualDownload.ready.eyebrow') : t('manualDownload.eyebrow')}
                  </p>
                  <h2 id="manual-download-title" className="mt-1 text-xl font-black text-white">
                    {manualDownloadAllComplete ? t('manualDownload.ready.title') : t('manualDownload.title')}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
                    {manualDownloadAllComplete
                      ? tf('manualDownload.ready.body', { instance: manualDownloadInstance.name })
                      : tf('manualDownload.body', {
                        folder: manualDownloadDirectory || t('manualDownload.folderFallback'),
                        instance: manualDownloadInstance.name
                      })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeManualDownloads}
                  aria-label={t('manualDownload.close')}
                  data-tooltip={t('modpack.install.closeTooltip')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-100"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {manualDownloadAllComplete && (
                  <div className="mb-4 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/15 text-emerald-200">
                        <CheckCircle2 size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-emerald-100">{t('manualDownload.ready.title')}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-emerald-100/75">
                          {tf('manualDownload.ready.body', { instance: manualDownloadInstance.name })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="hidden grid-cols-[minmax(220px,1.3fr)_minmax(180px,1fr)_150px_184px] gap-3 border-b border-slate-800 px-3 pb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 md:grid">
                  <span>{t('manualDownload.columns.mod')}</span>
                  <span>{t('manualDownload.columns.filename')}</span>
                  <span>{t('manualDownload.columns.status')}</span>
                  <span>{t('manualDownload.columns.actions')}</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {manualDownloadItems.map((item) => {
                    const status = manualDownloadStatuses[item.id] || 'pending'
                    const complete = status === 'complete'
                    return (
                      <div
                        key={item.id}
                        className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(220px,1.3fr)_minmax(180px,1fr)_150px_184px] md:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-500">
                            <CachedImage
                              src={item.iconUrl}
                              alt=""
                              className="h-full w-full object-cover"
                              fallback={<Package size={18} />}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-100" data-tooltip={item.title}>{item.title}</p>
                            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                              {item.projectType === 'resourcepack'
                                ? t('manualDownload.type.resourcepack')
                                : item.projectType === 'shader'
                                  ? t('manualDownload.type.shader')
                                  : t('manualDownload.type.mod')}
                            </p>
                          </div>
                        </div>
                        <p className="min-w-0 truncate font-mono text-xs font-bold text-slate-300" data-tooltip={item.filename}>
                          {item.filename}
                        </p>
                        <div>
                          <span className={classNames(
                            'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-black',
                            complete
                              ? 'border-emerald-400/25 bg-emerald-500/12 text-emerald-200'
                              : status === 'checking'
                                ? 'border-blue-400/25 bg-blue-500/12 text-blue-200'
                                : status === 'failed'
                                  ? 'border-red-400/25 bg-red-500/12 text-red-200'
                                  : 'border-slate-700 bg-slate-900 text-slate-400'
                          )}>
                            {complete
                              ? <CheckCircle2 size={14} />
                              : status === 'checking'
                                ? <Loader2 size={14} className="animate-spin" />
                                : status === 'failed'
                                  ? <AlertTriangle size={14} />
                                  : <Clock3 size={14} />}
                            {complete
                              ? t('manualDownload.status.complete')
                              : status === 'checking'
                                ? t('manualDownload.status.checking')
                                : status === 'failed'
                                  ? t('manualDownload.status.failed')
                                  : t('manualDownload.status.waiting')}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!complete && (
                            <>
                              <button
                                type="button"
                                onClick={() => openManualDownload(item)}
                                className="flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-black text-slate-100 transition-colors duration-150 hover:border-blue-400/45 hover:bg-blue-500/15 hover:text-blue-100"
                              >
                                <ExternalLink size={14} />
                                {t('manualDownload.action.open')}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyManualDownloadLink(item)}
                                className="flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs font-black text-slate-100 transition-colors duration-150 hover:border-blue-400/45 hover:bg-blue-500/15 hover:text-blue-100"
                              >
                                <ClipboardCopy size={14} />
                                {t('manualDownload.action.copy')}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <footer className="flex flex-col gap-3 border-t border-slate-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 text-xs font-semibold text-slate-500">
                  <p>
                    {manualDownloadPendingCount > 0
                      ? tf('manualDownload.summary.remaining', {
                        done: manualDownloadCompleteCount,
                        total: manualDownloadItems.length,
                        remaining: manualDownloadPendingCount
                      })
                      : tf('manualDownload.summary.complete', {
                        done: manualDownloadCompleteCount,
                        total: manualDownloadItems.length
                      })}
                  </p>
                  {manualDownloadMessage && (
                    <p className="mt-1 truncate text-slate-300" data-tooltip={manualDownloadMessage}>{manualDownloadMessage}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.electron.openManualDownloadFolder().catch(() => undefined)}
                    className="flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800"
                  >
                    <FolderOpen size={15} />
                    {t('manualDownload.action.folder')}
                  </button>
                  {manualDownloadAllComplete ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const instance = manualDownloadInstance
                          closeManualDownloads()
                          handleLaunchOrStop(instance).catch(() => undefined)
                        }}
                        className="flex h-10 items-center gap-2 rounded-md bg-emerald-500 px-4 text-xs font-black text-white transition-colors duration-150 hover:bg-emerald-400"
                      >
                        <Play size={15} />
                        {t('manualDownload.ready.play')}
                      </button>
                      <button
                        type="button"
                        onClick={closeManualDownloads}
                        className="flex h-10 items-center rounded-md border border-slate-700 bg-slate-900 px-4 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800"
                      >
                        {t('manualDownload.ready.close')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={openAllManualDownloads}
                        disabled={manualDownloadPendingCount === 0}
                        className="flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/45 hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ExternalLink size={15} />
                        {t('manualDownload.action.openAll')}
                      </button>
                      <button
                        type="button"
                        onClick={closeManualDownloads}
                        className="flex h-10 items-center rounded-md border border-slate-700 bg-slate-900 px-4 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800"
                      >
                        {t('manualDownload.action.skip')}
                      </button>
                      <button
                        type="button"
                        onClick={cancelManualDownloadsAndDeleteInstance}
                        className="flex h-10 items-center rounded-md border border-red-400/30 bg-red-500/10 px-4 text-xs font-black text-red-100 transition-colors duration-150 hover:bg-red-500/18"
                      >
                        {t('manualDownload.action.cancel')}
                      </button>
                    </>
                  )}
                </div>
              </footer>
            </motion.div>
          </div>
        )}

        {showInstanceSettings && instanceSettingsTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-3 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !savingInstanceSettings) setShowInstanceSettings(false)
            }}
          >
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="instance-settings-title"
              className="flex max-h-[calc(100vh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-blue-400/20 bg-[#0d1526] shadow-2xl shadow-black/55"
            >
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-blue-400/15 bg-slate-950/18 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <InstanceIcon instance={{ ...instanceSettingsTarget, iconUrl: instanceSettingsDraft.iconUrl || null }} size="sm" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-400">
                      <span className="truncate">{instanceSettingsTarget.name}</span>
                      <ChevronRight size={14} className="shrink-0" />
                      <span id="instance-settings-title" className="text-white">{t('instance.settings.title')}</span>
                    </div>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                      {instanceSettingsDraft.loader} / Minecraft {instanceSettingsDraft.version}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={savingInstanceSettings}
                  onClick={() => setShowInstanceSettings(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800/80 text-slate-300 transition-colors hover:bg-red-500/15 hover:text-red-100 disabled:cursor-wait disabled:opacity-60"
                  data-tooltip={t('window.close')}
                  aria-label={t('window.close')}
                >
                  <X size={18} />
                </button>
              </header>

              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[220px_1fr]">
                <aside className="border-b border-blue-400/10 bg-slate-950/10 p-4 md:border-b-0 md:border-r md:border-blue-400/10">
                  {([
                    { id: 'general' as InstanceSettingsTab, label: t('instance.settings.general'), icon: Info },
                    { id: 'installation' as InstanceSettingsTab, label: t('instance.settings.installation'), icon: Wrench }
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setInstanceSettingsTab(tab.id)}
                      className={classNames(
                        'mb-2 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition-colors',
                        instanceSettingsTab === tab.id
                          ? 'border border-blue-400/25 bg-blue-500/18 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                      )}
                    >
                      <tab.icon size={16} />
                      {tab.label}
                    </button>
                  ))}
                </aside>

                <section className="min-h-0 overflow-y-auto p-6">
                  {instanceSettingsTab === 'general' ? (
                    <div className="grid gap-6 lg:grid-cols-[1fr_160px]">
                      <div className="space-y-6">
                        <label className="block">
                          <span className="mb-2 block text-sm font-black text-white">{t('instance.name')}</span>
                          <input
                            value={instanceSettingsDraft.name}
                            onChange={(event) => setInstanceSettingsDraft((prev) => ({ ...prev, name: event.target.value }))}
                            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/45 px-3 text-sm font-black text-white outline-none transition-colors focus:border-blue-400/70"
                          />
                        </label>

                        <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm font-semibold leading-6 text-amber-100/85">
                          {t('instance.settings.warning')}
                        </p>

                        <div>
                          <h3 className="text-base font-black text-white">{t('instance.delete.title')}</h3>
                          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{t('instance.settings.deleteHelp')}</p>
                          <button
                            type="button"
                            disabled={deletingInstanceId === instanceSettingsTarget.id || isInstanceBusy(instanceSettingsTarget.id) || checkingUpdates}
                            onClick={() => {
                              setShowInstanceSettings(false)
                              deleteInstance(instanceSettingsTarget)
                            }}
                            className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-black text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingInstanceId === instanceSettingsTarget.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            {t('instance.delete.confirm')}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-500">
                          {instanceSettingsDraft.iconUrl ? (
                            <CachedImage
                              src={instanceSettingsDraft.iconUrl}
                              alt=""
                              className="h-full w-full object-cover"
                              fallback={<Package size={34} />}
                            />
                          ) : (
                            <Package size={34} />
                          )}
                        </div>
                        <input
                          id="instance-settings-icon-file"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(event) => {
                            handleInstanceSettingsIconUpload(event.target.files?.[0])
                            event.currentTarget.value = ''
                          }}
                        />
                        <label
                          htmlFor="instance-settings-icon-file"
                          className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-slate-600 px-3 text-xs font-black text-slate-200 transition-colors hover:border-blue-400/60 hover:bg-blue-500/10 hover:text-blue-100"
                        >
                          <Upload size={14} />
                          {t('instance.settings.editIcon')}
                        </label>
                        {instanceSettingsDraft.iconUrl && (
                          <button
                            type="button"
                            onClick={() => setInstanceSettingsDraft((prev) => ({ ...prev, iconUrl: '' }))}
                            className="text-xs font-black text-slate-500 transition-colors hover:text-red-200"
                          >
                            {t('instance.icon.remove')}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-3xl space-y-6">
                      {!instanceSettingsEditingInstallation ? (
                        <>
                          <div>
                            <h3 className="text-base font-black text-white">{t('instance.settings.installationTitle')}</h3>
                            <div className="mt-4 rounded-2xl border border-blue-400/10 bg-slate-950/45 p-4 text-sm font-bold">
                              <div className="flex items-center justify-between gap-4 py-1">
                                <span className="text-slate-500">{t('instance.settings.platform')}</span>
                                <span className="flex items-center gap-2 capitalize text-white">
                                  <LoaderIcon loader={instanceSettingsDraft.loader} className="h-6 w-6" />
                                  {instanceSettingsDraft.loader === 'neoforge' ? 'NeoForge' : instanceSettingsDraft.loader}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 py-1">
                                <span className="text-slate-500">{t('instance.settings.gameVersion')}</span>
                                <span className="font-mono text-white">{instanceSettingsDraft.version}</span>
                              </div>
                              {instanceSettingsDraft.loader !== 'vanilla' && (
                                <div className="flex items-center justify-between gap-4 py-1">
                                  <span className="text-slate-500">{tf('instance.settings.loaderVersion', { loader: instanceSettingsDraft.loader })}</span>
                                  <span className="max-w-[340px] truncate font-mono text-white">{instanceSettingsDraft.loaderVersion || '-'}</span>
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={checkingUpdates}
                              onClick={() => {
                                setInstanceSettingsEditingInstallation(true)
                                void ensureMinecraftVersionList()
                              }}
                              className="mt-3 flex h-10 items-center gap-2 rounded-lg bg-blue-500 px-4 text-sm font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Wrench size={16} />
                              {t('instance.settings.editInstallation')}
                            </button>
                          </div>

                          <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm font-semibold leading-6 text-amber-100/85">
                            {t('instance.settings.warning')}
                          </p>

                          <div>
                            <h3 className="text-base font-black text-white">{t('instance.settings.repairTitle')}</h3>
                            <button
                              type="button"
                              disabled
                              className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/65 px-4 text-sm font-black text-slate-400"
                            >
                              <Wrench size={16} />
                              {t('instance.settings.repair')}
                            </button>
                            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                              {t('instance.settings.repairHelp')}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-2xl border border-blue-400/15 bg-slate-950/20 p-4">
                            <h3 className="text-base font-black text-white">{t('instance.settings.editInstallation')}</h3>
                            <div className="mt-4 space-y-4">
                              <div>
                                <span className="mb-2 block text-sm font-black text-white">{t('instance.settings.platform')}</span>
                                <div className="flex flex-wrap gap-2">
                                  {(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'] as LoaderType[]).map((loader) => (
                                    <button
                                      key={loader}
                                      type="button"
                                      onClick={() => setInstanceSettingsDraft((prev) => ({
                                        ...prev,
                                        loader,
                                        loaderVersion: loader === 'vanilla' ? '' : prev.loader === loader ? prev.loaderVersion : ''
                                      }))}
                                      className={classNames(
                                        'flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-black capitalize transition-colors',
                                        instanceSettingsDraft.loader === loader
                                          ? 'border-blue-300/70 bg-blue-500/18 text-blue-100'
                                          : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-blue-400/35 hover:bg-blue-500/10 hover:text-slate-100'
                                      )}
                                    >
                                      <LoaderIcon loader={loader} className="h-6 w-6" />
                                      {loader === 'neoforge' ? 'NeoForge' : loader}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <label className="block">
                                <span className="mb-2 block text-sm font-black text-white">{t('instance.settings.gameVersion')}</span>
                                <div className="relative">
                                  <select
                                    value={instanceSettingsDraft.version}
                                    onFocus={() => void ensureMinecraftVersionList()}
                                    onChange={(event) => setInstanceSettingsDraft((prev) => ({
                                      ...prev,
                                      version: event.target.value,
                                      loaderVersion: prev.loader === 'vanilla' ? '' : ''
                                    }))}
                                    className="h-11 w-full appearance-none rounded-lg border border-slate-700 bg-slate-950/55 px-3 pr-10 text-sm font-black text-white outline-none transition-colors focus:border-blue-400/70"
                                  >
                                    {instanceSettingsGameVersionOptions.map((version) => (
                                      <option key={version} value={version}>{version}</option>
                                    ))}
                                  </select>
                                  <ChevronRight size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-slate-500" />
                                </div>
                                <p className="mt-2 text-xs font-semibold text-slate-500">
                                  {minecraftVersionsLoading
                                    ? t('instance.settings.loadingVersions')
                                    : tf('instance.settings.versionCount', { count: instanceSettingsGameVersionOptions.length })}
                                </p>
                              </label>

                              {instanceSettingsDraft.loader !== 'vanilla' && (
                                <label className="block">
                                  <span className="mb-2 block text-sm font-black text-white">
                                    {tf('instance.settings.loaderVersion', { loader: instanceSettingsDraft.loader })}
                                  </span>
                                  <div className="relative">
                                    <select
                                      value={instanceSettingsDraft.loaderVersion}
                                      onChange={(event) => setInstanceSettingsDraft((prev) => ({ ...prev, loaderVersion: event.target.value }))}
                                      className="h-11 w-full appearance-none rounded-lg border border-slate-700 bg-slate-950/55 px-3 pr-10 text-sm font-black text-white outline-none transition-colors focus:border-blue-400/70 disabled:opacity-65"
                                      disabled={instanceSettingsLoaderVersionsLoading || instanceSettingsLoaderVersionOptions.length === 0}
                                    >
                                      {instanceSettingsLoaderVersionOptions.map((loaderId) => {
                                        const loader = instanceSettingsLoaderVersions.find((item) => item.id === loaderId)
                                        return (
                                          <option key={loaderId} value={loaderId}>
                                            {loader ? `${loader.id} (${loader.type})` : loaderId}
                                          </option>
                                        )
                                      })}
                                    </select>
                                    {instanceSettingsLoaderVersionsLoading ? (
                                      <Loader2 size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-200" />
                                    ) : (
                                      <ChevronRight size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-slate-500" />
                                    )}
                                  </div>
                                  <p className="mt-2 text-xs font-semibold text-slate-500">
                                    {instanceSettingsLoaderVersionsLoading
                                      ? t('instance.settings.loaderVersionsLoading')
                                      : tf('instance.settings.versionCount', { count: instanceSettingsLoaderVersionOptions.length })}
                                  </p>
                                </label>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  disabled={savingInstanceSettings || checkingUpdates}
                                  onClick={saveInstanceSettings}
                                  className="flex h-10 items-center gap-2 rounded-lg bg-blue-500 px-4 text-sm font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60"
                                >
                                  {savingInstanceSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                  {savingInstanceSettings ? t('instance.settings.saving') : t('instance.settings.save')}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingInstanceSettings}
                                  onClick={() => {
                                    resetInstanceSettingsDraft(instanceSettingsTarget)
                                    setInstanceSettingsEditingInstallation(false)
                                  }}
                                  className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                                >
                                  <X size={16} />
                                  {t('instance.settings.editCancel')}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h3 className="text-base font-black text-white">{t('instance.settings.repairTitle')}</h3>
                            <button
                              type="button"
                              disabled
                              className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/65 px-4 text-sm font-black text-slate-400"
                            >
                              <Wrench size={16} />
                              {t('instance.settings.repair')}
                            </button>
                            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                              {t('instance.settings.repairHelp')}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </section>
              </div>

              {instanceSettingsTab === 'general' && (
                <footer className="flex shrink-0 justify-end gap-2 border-t border-blue-400/10 px-5 py-4">
                  <button
                    type="button"
                    disabled={savingInstanceSettings || checkingUpdates}
                    onClick={() => setShowInstanceSettings(false)}
                    className="h-10 rounded-lg border border-slate-600 px-4 text-sm font-black text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {t('instance.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={savingInstanceSettings || checkingUpdates}
                    onClick={saveInstanceSettings}
                    className="flex h-10 items-center gap-2 rounded-lg bg-blue-500 px-4 text-sm font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60"
                  >
                    {savingInstanceSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {savingInstanceSettings ? t('instance.settings.saving') : t('instance.settings.save')}
                  </button>
                </footer>
              )}
            </motion.div>
          </div>
        )}

        {showInstanceModal && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (!importingMrpack) setShowInstanceModal(false)
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="max-h-[calc(100vh-24px)] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/40"
            >
              <div className="flex items-center justify-between border-b border-slate-800 p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-400/25 bg-blue-500/12 text-blue-200">
                    <Plus size={19} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-black">{t('instance.create.title')}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{t('instance.create.subtitle')}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (importingMrpack) {
                      cancelActiveInstall()
                      return
                    }
                    setShowInstanceModal(false)
                  }}
                  aria-label={importingMrpack ? t('mrpack.progress.cancel') : t('instance.creator.close')}
                  data-tooltip={importingMrpack ? t('mrpack.progress.cancelTooltip') : t('window.close')}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-red-500/15 hover:text-red-100"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="p-5">
              <div className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-400/20 bg-blue-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-300/20 bg-blue-500/15 text-blue-200">
                    <FileArchive size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-blue-100">{t('instance.import.title')}</p>
                    <p className="mt-1 text-xs font-semibold text-blue-100/60">
                      {t('instance.import.body')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={importingMrpack}
                  onClick={importLocalMrpack}
                  className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-500 px-3 text-xs font-black text-white transition-colors duration-150 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importingMrpack ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  {importingMrpack ? t('instance.import.importing') : t('instance.import.choose')}
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-950/25 p-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-blue-300">
                    {newInstance.iconUrl ? (
                      <CachedImage
                        src={newInstance.iconUrl}
                        alt=""
                        className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
                        fallback={<Package size={22} />}
                      />
                    ) : (
                      <Package size={22} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-100">{t('instance.icon.title')}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">{t('instance.icon.subtitle')}</p>
                  </div>
                  <input
                    id="instance-icon-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      handleInstanceIconUpload(event.target.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                  <label
                    htmlFor="instance-icon-file"
                    className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors duration-150 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                  >
                    <Upload size={15} />
                    {t('instance.icon.choose')}
                  </label>
                  {newInstance.iconUrl && (
                    <button
                      type="button"
                      onClick={() => setNewInstance((prev) => ({ ...prev, iconUrl: '' }))}
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors duration-150 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                      data-tooltip={t('instance.icon.remove')}
                      aria-label={t('instance.icon.remove')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{t('instance.name')}</span>
                  <input
                    value={newInstance.name}
                    onChange={(event) => setNewInstance({ ...newInstance, name: event.target.value })}
                    data-launcher-autofocus="true"
                    className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 text-sm font-black outline-none transition-colors duration-150 focus:border-blue-400/60"
                  />
                </label>
                <InstanceSelect
                  label={t('instance.loader')}
                  value={newInstance.loader}
                  options={[
                    { value: 'vanilla', label: 'Vanilla' },
                    { value: 'fabric', label: 'Fabric' },
                    { value: 'forge', label: 'Forge' },
                    { value: 'quilt', label: 'Quilt' },
                    { value: 'neoforge', label: 'NeoForge' }
                  ]}
                  onChange={(loader) => setNewInstance({ ...newInstance, loader: loader as LoaderType })}
                  renderIcon={(loader) => <LoaderIcon loader={loader} className="h-6 w-6" />}
                  testId="create-instance-loader-select"
                />
                <div className="space-y-2">
                  <InstanceSelect
                    label={t('instance.minecraft')}
                    value={newInstance.version}
                    options={newInstanceGameVersionOptions.map((version) => ({ value: version, label: version }))}
                    onOpen={() => void ensureMinecraftVersionList()}
                    onChange={(version) => setNewInstance({ ...newInstance, version })}
                    renderIcon={() => <Package size={18} className="text-emerald-300" />}
                    testId="create-instance-version-select"
                  />
                  {minecraftVersionsLoading && (
                    <p className="text-[11px] font-bold text-blue-200">{t('instance.settings.loadingVersions')}</p>
                  )}
                </div>
                {newInstance.loader !== 'vanilla' && (
                  <InstanceSelect
                    label={`${newInstance.loader} ${t('instance.loaderBuild')}`}
                    value={newInstance.loaderVersion}
                    options={loaderVersions.map((loader) => ({
                      value: loader.id,
                      label: loader.id,
                      detail: loader.type
                    }))}
                    onChange={(loaderVersion) => setNewInstance({ ...newInstance, loaderVersion })}
                    renderIcon={() => <LoaderIcon loader={newInstance.loader} className="h-6 w-6" />}
                    testId="create-instance-loader-build-select"
                  />
                )}
              </div>

              <aside className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-blue-300">
                  {newInstance.iconUrl ? (
                    <CachedImage
                      src={newInstance.iconUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      fallback={<Package size={24} />}
                    />
                  ) : (
                    <Package size={24} />
                  )}
                </div>
                <p className="mt-4 text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">{t('instance.summary.title')}</p>
                <h3 className="mt-2 truncate text-lg font-black text-white">{newInstance.name || 'New Instance'}</h3>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{t('instance.summary.body')}</p>
                <div className="mt-5 space-y-3 text-xs font-bold">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{t('instance.minecraft')}</span>
                    <span className="font-mono tabular-nums text-slate-200">{newInstance.version || latestVersion || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{t('instance.loader')}</span>
                    <span className="capitalize text-slate-200">{newInstance.loader}</span>
                  </div>
                  {newInstance.loader !== 'vanilla' && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600">{t('instance.loaderBuild')}</span>
                      <span className="max-w-[150px] truncate font-mono text-slate-200">{newInstance.loaderVersion || '-'}</span>
                    </div>
                  )}
                </div>
                <div className="mt-5 rounded-md border border-blue-400/15 bg-blue-500/[0.06] p-3 text-xs font-semibold leading-5 text-blue-100/70">
                  {t('instance.summary.runtime')}
                </div>
              </aside>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button disabled={importingMrpack} onClick={() => setShowInstanceModal(false)} className="h-11 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-300 transition-colors duration-150 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {t('instance.cancel')}
                </button>
                <button disabled={importingMrpack} onClick={createInstance} className="h-11 rounded-lg bg-blue-500 px-4 text-sm font-black text-white transition-colors duration-150 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60">
                  {t('instance.create.button')}
                </button>
              </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
