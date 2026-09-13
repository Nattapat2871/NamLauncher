// Author/creator: nattapat2871 (https://nattapat2871.me)
export type StartupUpdateTarget = 'windows-x64' | 'macos-universal' | 'linux-appimage-x64' | 'linux-deb-x64' | 'linux-rpm-x64' | 'linux-pacman-x64'
export type StartupUpdateReason = 'check-failed' | 'install-failed' | 'unsupported-package' | 'previous-attempt' | 'active-work'
export type StartupUpdateInfo = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  channel: string
  downloadUrl: string
  mandatory?: boolean
  error?: string
  installerSha256?: string | null
  notes?: string[]
}
export type StartupUpdateResult = {
  outcome: 'current' | 'disabled' | 'handoff' | 'fallback'
  update: StartupUpdateInfo
  reason?: StartupUpdateReason
}

export const WINDOWS_AUTO_INSTALLER_STATUS_SCHEMA = 1 as const
export type WindowsAutoInstallerState = 'ready' | 'installing' | 'installed' | 'failed'
export type WindowsAutoInstallerStatus = {
  schemaVersion: typeof WINDOWS_AUTO_INSTALLER_STATUS_SCHEMA
  attemptId: string
  nonce: string
  state: WindowsAutoInstallerState
  detail: string
  at: string
  helperPid: number
  installerPid?: number
}

export type WindowsAutoInstallerExpectation = {
  attemptId: string
  nonce: string
  helperPid: number
}

const WINDOWS_AUTO_INSTALLER_ATTEMPT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WINDOWS_AUTO_INSTALLER_NONCE_PATTERN = /^[0-9a-f]{64}$/i
const WINDOWS_AUTO_INSTALLER_STATES = new Set<WindowsAutoInstallerState>(['ready', 'installing', 'installed', 'failed'])

// The status file is an untrusted, user-writable handoff boundary. A status
// only belongs to this launch when every correlation value matches exactly.
export const normalizeWindowsAutoInstallerStatus = (
  value: unknown,
  expected: WindowsAutoInstallerExpectation
): WindowsAutoInstallerStatus | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const status = value as Record<string, unknown>
  if (status.schemaVersion !== WINDOWS_AUTO_INSTALLER_STATUS_SCHEMA
    || typeof status.attemptId !== 'string'
    || !WINDOWS_AUTO_INSTALLER_ATTEMPT_PATTERN.test(status.attemptId)
    || status.attemptId !== expected.attemptId
    || typeof status.nonce !== 'string'
    || !WINDOWS_AUTO_INSTALLER_NONCE_PATTERN.test(status.nonce)
    || status.nonce !== expected.nonce
    || typeof status.state !== 'string'
    || !WINDOWS_AUTO_INSTALLER_STATES.has(status.state as WindowsAutoInstallerState)
    || typeof status.detail !== 'string'
    || status.detail.length > 1_000
    || typeof status.at !== 'string'
    || !Number.isFinite(Date.parse(status.at))
    || !Number.isSafeInteger(status.helperPid)
    || Number(status.helperPid) < 1
    || status.helperPid !== expected.helperPid) return null

  if (status.installerPid !== undefined
    && (!Number.isSafeInteger(status.installerPid) || Number(status.installerPid) < 1)) return null

  return {
    schemaVersion: WINDOWS_AUTO_INSTALLER_STATUS_SCHEMA,
    attemptId: status.attemptId,
    nonce: status.nonce,
    state: status.state as WindowsAutoInstallerState,
    detail: status.detail,
    at: status.at,
    helperPid: status.helperPid,
    ...(status.installerPid === undefined ? {} : { installerPid: status.installerPid as number })
  }
}

export const selectStartupUpdateTarget = (platform: string, arch: string, packageType = '', appImage = '', flatpak = false): StartupUpdateTarget | null => {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'macos-universal'
  if (arch !== 'x64') return null
  if (platform === 'win32') return 'windows-x64'
  if (platform !== 'linux' || flatpak) return null
  if (appImage) return 'linux-appimage-x64'
  if (packageType === 'deb') return 'linux-deb-x64'
  if (packageType === 'rpm') return 'linux-rpm-x64'
  if (packageType === 'pacman') return 'linux-pacman-x64'
  return null
}

export const STARTUP_UPDATE_RETRY_DELAY_MS = 6 * 60 * 60 * 1000

// One promise per main process, not per renderer mount. A reload or StrictMode
// must never start a second installer, and failures always reach the manual UI.
export const createStartupUpdateController = (options: {
  check: () => Promise<StartupUpdateInfo>
  enabled: () => boolean
  target: () => StartupUpdateTarget | null
  activeWork: () => boolean
  previousAttempt: () => { version: string; at: number } | null
  recordAttempt: (version: string, at: number) => void
  install: (update: StartupUpdateInfo, target: StartupUpdateTarget) => Promise<void>
  logFailure: (error: unknown) => void
  now?: () => number
}) => {
  let task: Promise<StartupUpdateResult> | null = null
  return () => {
    if (task) return task
    task = (async (): Promise<StartupUpdateResult> => {
      const update = await options.check()
      if (update.error) return { outcome: 'fallback', update, reason: 'check-failed' }
      if (!update.updateAvailable) return { outcome: 'current', update }
      if (!options.enabled()) return { outcome: 'disabled', update }
      const target = options.target()
      if (!target) return { outcome: 'fallback', update, reason: 'unsupported-package' }
      if (options.activeWork()) return { outcome: 'fallback', update, reason: 'active-work' }
      const now = options.now?.() ?? Date.now()
      const previous = options.previousAttempt()
      if (previous?.version === update.latestVersion && now - previous.at < STARTUP_UPDATE_RETRY_DELAY_MS) {
        return { outcome: 'fallback', update, reason: 'previous-attempt' }
      }
      try {
        options.recordAttempt(update.latestVersion, now)
        await options.install(update, target)
        return { outcome: 'handoff', update }
      } catch (error) {
        options.logFailure(error)
        return { outcome: 'fallback', update, reason: 'install-failed' }
      }
    })()
    return task
  }
}
