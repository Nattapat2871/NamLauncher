// Author/creator: nattapat2871 (https://nattapat2871.me)

export const LAUNCHER_UPDATE_BLOCK_MESSAGES = {
  'minecraft-active': 'Close all running or launching Minecraft instances before installing a NamLauncher update.',
  'content-install-active': 'Wait for content installation tasks to finish before installing a NamLauncher update.',
  'update-in-progress': 'A NamLauncher update installation is already in progress.',
  'already-current': 'NamLauncher is already up to date.'
} as const

export type LauncherUpdateBlockReason = keyof typeof LAUNCHER_UPDATE_BLOCK_MESSAGES

export type LauncherUpdateFailureReason =
  | 'download-invalid'
  | 'download-failed'
  | 'installer-open-failed'
  | 'unknown'

export type LauncherUpdateInstallResult = {
  success: boolean
  blocked?: boolean
  blockReason?: LauncherUpdateBlockReason
  openedDownload?: boolean
  installerOpened?: boolean
  installerPath?: string
  willRestart?: boolean
  message?: string
}

export class LauncherUpdateBlockedError extends Error {
  readonly reason: LauncherUpdateBlockReason

  constructor(reason: LauncherUpdateBlockReason) {
    super(LAUNCHER_UPDATE_BLOCK_MESSAGES[reason])
    this.name = 'LauncherUpdateBlockedError'
    this.reason = reason
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export const getLauncherUpdateBlockedResult = (error: unknown): LauncherUpdateInstallResult | null => {
  if (!(error instanceof LauncherUpdateBlockedError)) return null
  return {
    success: false,
    blocked: true,
    blockReason: error.reason
  }
}

export const isExpectedLauncherUpdateBlockMessage = (message: string) => Object.values(
  LAUNCHER_UPDATE_BLOCK_MESSAGES
).some((expected) => message.includes(expected))

export const buildLauncherInstallerTempPath = (installerPath: string, uniqueToken: string) => {
  const normalizedPath = String(installerPath || '')
  const normalizedToken = String(uniqueToken || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 160)

  if (!/\.exe$/i.test(normalizedPath) || !normalizedToken) {
    throw new Error('A valid Windows installer path and temporary file token are required.')
  }

  return `${normalizedPath.slice(0, -4)}-download-${normalizedToken}.exe`
}

export const classifyLauncherUpdateFailureMessage = (message: string): LauncherUpdateFailureReason => {
  const normalizedMessage = String(message || '')
  if (
    /downloaded launcher installer is missing or invalid/i.test(normalizedMessage)
    || /launcher installer is not a valid size/i.test(normalizedMessage)
    || /launcher installer is not a Windows executable/i.test(normalizedMessage)
    || /installer failed SHA-256 integrity verification/i.test(normalizedMessage)
  ) return 'download-invalid'

  if (
    /Windows could not open the launcher installer/i.test(normalizedMessage)
    || /could not open the validated launcher installer/i.test(normalizedMessage)
  ) return 'installer-open-failed'

  if (
    /(?:network|timeout|timed out|ECONN|ENOTFOUND|certificate|status code [45]\d\d)/i.test(normalizedMessage)
  ) return 'download-failed'

  return 'unknown'
}
