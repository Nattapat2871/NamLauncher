// Author/creator: nattapat2871 (https://nattapat2871.me)
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { isOfflineUsernameValidationError } from '../shared/offlineUsername.ts'
import { isExpectedLauncherUpdateBlockMessage } from '../shared/launcherUpdate.ts'

const isExpectedUserFacingError = (context: string, message: string) => {
  if (!context.startsWith('ipc:')) return false
  if (context === 'ipc:login-offline' && isOfflineUsernameValidationError(message)) return true
  if (context === 'ipc:install-launcher-update' && isExpectedLauncherUpdateBlockMessage(message)) return true
  // Exhausted provider throttling is actionable user feedback, not an IPC defect.
  // Match only the provider's known response on its content channels.
  if (/^ipc:(?:install|search|get|update|check)-curseforge-/.test(context)
    && /(?:^|:\s*)The NamLauncher CurseForge service is busy\. Please wait a moment and try again\.(?:\s|$)/.test(message)) return true
  // The trusted main-process launch handler owns classification, player context,
  // and reporting. Re-reporting the rejected IPC promise loses that context and
  // creates a second report for the same failure.
  if (context === 'ipc:launch-minecraft') return true
  if (['ipc:save-skin-preset', 'ipc:save-default-skin-preset'].includes(context)
    && /Skin texture must be a PNG file\./i.test(message)) return true
  if (['ipc:import-skin-by-name', 'ipc:import-offline-skin-by-name'].includes(context)
    && /Enter a Minecraft player name or a valid NameMC profile link\./i.test(message)) return true
  if (['ipc:toggle-instance-content', 'ipc:delete-instance-content', 'ipc:import-instance-content-files'].includes(context)
    && /Stop Minecraft before changing (?:mods|resource packs|shaders) in this instance\./i.test(message)) return true
  if (context === 'ipc:toggle-instance-content' && /Content file was not found\./i.test(message)) return true

  return [
    /A required Modrinth dependency has no compatible version/i,
    /No compatible .* version/i,
    /No installable file found/i,
    /Modpacks need a separate instance importer/i,
    /requires a Fabric, Forge, Quilt, or NeoForge instance/i,
    /disabled third-party downloads/i,
    /Could not log into Minecraft/i,
    /Microsoft sign-in .*Minecraft services/i,
    /Microsoft login did not return a refresh token/i,
    /Xbox Live rejected this Microsoft account/i,
    /The account (?:doesn't|does not) have an Xbox account/i,
    /Microsoft session .*?(expired|missing its refresh token|invalid|incomplete)/i,
    /Your Microsoft session expired/i,
    /Minecraft launch returned no process/i,
    /Minecraft server address is invalid/i,
    /Server name must contain/i,
    /server is already in the list/i,
    /server list changed before removal/i,
    /Refresh the instance (?:server|world) list/i,
    /Minecraft is already (?:running|launching)/i,
    /Stop Minecraft before deleting this instance/i,
    /Stop Minecraft before changing servers in this instance/i,
    /Minecraft exited with code/i,
    /Content selection is no longer current/i,
    /A different file already uses the target enabled\/disabled name/i,
    /Content files changed while their enabled state was being updated/i,
    /Path resolves outside the allowed directory/i,
    /Path must not pass through a symbolic link or junction/i,
    /Allowed directory must not be a symbolic link or junction/i,
    /Launch cancelled by user/i
  ].some((pattern) => pattern.test(message))
}

const isExplicitUserCancellation = (message: string) => [
  /(?:^|:\s*)Install cancelled by user\.?$/i,
  /(?:^|:\s*)Launch cancelled by user\.?$/i,
  /(?:^|:\s*)Microsoft login was cancelled\.?$/i
].some((pattern) => pattern.test(message.trim()))

const reportRendererError = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error')
  if (isExplicitUserCancellation(message)) return
  if (isExpectedUserFacingError(context, message)) return
  ipcRenderer.send('launcher-error-observed', {
    context,
    message,
    stack: error instanceof Error ? error.stack : undefined
  })
}

const invoke = async (channel: string, ...args: any[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    if (channel !== 'copy-error-report' && channel !== 'submit-error-report') reportRendererError(`ipc:${channel}`, error)
    throw error
  }
}

const isMissingIpcReplyError = (error: unknown) => /reply was never sent/i.test(
  error instanceof Error ? error.message : String(error || '')
)

// Author/creator: nattapat2871 (https://nattapat2871.me)
const launchMinecraftWithRecovery = async (request: any) => {
  try {
    return await ipcRenderer.invoke('launch-minecraft', request)
  } catch (error) {
    if (!isMissingIpcReplyError(error)) {
      reportRendererError('ipc:launch-minecraft', error)
      throw error
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const state = await ipcRenderer.invoke('get-game-state')
      const instanceId = String(request?.instance?.id || '')
      const running = Array.isArray(state?.running)
        && state.running.some((entry: any) => String(entry?.instanceId || '') === instanceId)
      if (running) return { success: true, alreadyRunning: true, instanceId }
      const launching = Array.isArray(state?.launching)
        && state.launching.some((entry: any) => String(entry?.instanceId || '') === instanceId)
      if (launching) return { success: false, alreadyLaunching: true, instanceId }

      return await ipcRenderer.invoke('launch-minecraft', request)
    } catch (recoveryError) {
      reportRendererError('ipc:launch-minecraft', recoveryError)
      throw recoveryError
    }
  }
}

window.addEventListener('error', (event) => {
  reportRendererError('renderer:error', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('renderer:unhandled-rejection', event.reason)
})

contextBridge.exposeInMainWorld('electron', {
  getAccounts: () => invoke('get-accounts'),
  setActiveAccountContext: (accountId: string | null) => invoke('set-active-account-context', accountId),
  removeAccount: (accountId: string) => invoke('remove-account', accountId),
  getSkinLibrary: (accountId: string) => invoke('get-skin-library', accountId),
  refreshSkinLibrary: (accountId: string) => invoke('refresh-skin-library', accountId),
  saveSkinPreset: (request: any) => invoke('save-skin-preset', request),
  saveDefaultSkinPreset: (request: any) => invoke('save-default-skin-preset', request),
  importSkinByName: (request: any) => invoke('import-skin-by-name', request),
  importOfflineSkinByName: (request: any) => invoke('import-offline-skin-by-name', request),
  activateSkinPreset: (request: any) => invoke('activate-skin-preset', request),
  deleteSkinPreset: (request: any) => invoke('delete-skin-preset', request),
  resetActiveSkin: (request: any) => invoke('reset-active-skin', request),
  getLoaderVersions: (loader: string, mcVersion: string) => invoke('get-loader-versions', loader, mcVersion),
  getLoaderCompatibility: (loader: string, mcVersion: string) => invoke('get-loader-compatibility', loader, mcVersion),
  getGameState: () => invoke('get-game-state'),
  hydrateInstances: (instances: any[]) => invoke('hydrate-instances', instances),
  updateInstance: (request: any) => invoke('update-instance', request),
  provisionInstance: (instance: any) => invoke('provision-instance', { instance }),
  getInstancePlaces: (instance: any) => invoke('get-instance-places', { instance }),
  getLanReadiness: (request: any) => invoke('get-lan-readiness', request),
  discoverLanServers: () => invoke('discover-lan-servers'),
  pingInstanceServers: (instance: any, addresses?: readonly string[]) => invoke('ping-instance-servers', { instance, addresses }),
  addInstanceServer: (request: any) => invoke('add-instance-server', request),
  removeInstanceServer: (request: any) => invoke('remove-instance-server', request),
  cacheImageUrl: (url: string) => invoke('cache-image-url', url),
  rendererReady: () => invoke('renderer-ready'),
  getInstanceUpdateSummary: (instance: any) => invoke('get-instance-update-summary', { instance }),
  getLauncherVersion: () => invoke('get-launcher-version'),
  checkLauncherUpdate: () => invoke('check-launcher-update'),
  runStartupLauncherUpdate: () => invoke('run-startup-launcher-update'),
  installLauncherUpdate: () => invoke('install-launcher-update'),
  getLauncherStats: () => invoke('get-launcher-stats'),
  getLegalDocument: (language: 'en' | 'th') => invoke('get-legal-document', language),
  getLauncherDataLocation: () => invoke('get-launcher-data-location'),
  chooseLauncherDataLocation: (options?: any) => invoke('choose-launcher-data-location', options),
  getDiscordSettings: () => invoke('get-discord-settings'),
  getDiscordStatus: () => invoke('get-discord-status'),
  setDiscordSettings: (settings: any) => invoke('set-discord-settings', settings),
  getLauncherDiscordAccount: () => invoke('get-launcher-discord-account'),
  connectLauncherDiscordAccount: () => invoke('connect-launcher-discord-account'),
  disconnectLauncherDiscordAccount: () => invoke('disconnect-launcher-discord-account'),
  getInstanceMods: (instance: any) => invoke('get-instance-mods', { instance }),
  getInstanceContent: (options: any) => invoke('get-instance-content', options),
  getInstanceRunLog: (instance: any) => invoke('get-instance-run-log', { instance }),
  toggleInstanceContent: (options: any) => invoke('toggle-instance-content', options),
  deleteInstanceContent: (options: any) => invoke('delete-instance-content', options),
  importInstanceContentFiles: (options: any) => invoke('import-instance-content-files', options),
  revealInstanceContentFile: (options: any) => invoke('reveal-instance-content-file', options),
  getDroppedFilePaths: (files: File[]) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  openInstanceFolder: (instance: any) => invoke('open-instance-folder', { instance }),
  deleteInstance: (instance: any) => invoke('delete-instance', { instance }),
  openManualDownloadFolder: () => invoke('open-manual-download-folder'),
  copyToClipboard: (value: string) => invoke('copy-to-clipboard', value),
  importCurseForgeManualDownload: (options: any) => invoke('import-curseforge-manual-download', options),
  getModrinthContentStatus: (options: any) => invoke('get-modrinth-content-status', options),
  getCurseForgeConfig: () => invoke('get-curseforge-config'),
  getHomeModpacks: () => invoke('get-home-modpacks'),
  searchModrinth: (options: any) => invoke('search-modrinth', options),
  searchCurseForge: (options: any) => invoke('search-curseforge', options),
  getCurseForgeContentStatus: (options: any) => invoke('get-curseforge-content-status', options),
  getCurseForgeProjectVersions: (options: any) => invoke('get-curseforge-project-versions', options),
  installCurseForgeContent: (options: any) => invoke('install-curseforge-content', options),
  getCurseForgeModpackVersions: (options: any) => invoke('get-curseforge-modpack-versions', options),
  installCurseForgeModpack: (options: any) => invoke('install-curseforge-modpack', options),
  getModrinthProjectVersions: (options: any) => invoke('get-modrinth-project-versions', options),
  installModrinthContent: (options: any) => invoke('install-modrinth-content', options),
  installModrinthModpack: (options: any) => invoke('install-modrinth-modpack', options),
  installLocalMrpack: (options?: any) => invoke('install-local-mrpack', options),
  cancelInstallTask: (taskId: string) => invoke('cancel-install-task', taskId),
  exportInstanceMrpack: (instance: any) => invoke('export-instance-mrpack', { instance }),
  launchMinecraft: (options: any) => launchMinecraftWithRecovery(options),
  stopMinecraft: (instance?: any) => invoke('stop-minecraft', instance ? { instance } : {}),
  loginMicrosoft: () => invoke('login-microsoft'),
  loginOffline: (username: string) => invoke('login-offline', username),
  copyErrorReport: (report: string) => invoke('copy-error-report', report),
  submitErrorReport: (request: any) => invoke('submit-error-report', request),
  onLaunchProgress: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
    ipcRenderer.on('launch-progress', listener)
    return () => ipcRenderer.removeListener('launch-progress', listener)
  },
  onLaunchError: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('launch-error', listener)
    return () => ipcRenderer.removeListener('launch-error', listener)
  },
  onLauncherErrorReport: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, report: any) => callback(report)
    ipcRenderer.on('launcher-error-report', listener)
    return () => ipcRenderer.removeListener('launcher-error-report', listener)
  },
  onMinecraftGameIssue: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, issue: any) => callback(issue)
    ipcRenderer.on('minecraft-game-issue', listener)
    return () => ipcRenderer.removeListener('minecraft-game-issue', listener)
  },
  onLauncherUpdate: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, update: any) => callback(update)
    ipcRenderer.on('launcher-update', listener)
    return () => ipcRenderer.removeListener('launcher-update', listener)
  },
  onLauncherUpdateProgress: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
    ipcRenderer.on('launcher-update-progress', listener)
    return () => ipcRenderer.removeListener('launcher-update-progress', listener)
  },
  onLanSessionDetected: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload)
    ipcRenderer.on('lan-session-detected', listener)
    return () => ipcRenderer.removeListener('lan-session-detected', listener)
  },
  onAccountSessionExpired: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload)
    ipcRenderer.on('account-session-expired', listener)
    return () => ipcRenderer.removeListener('account-session-expired', listener)
  },
  onGameState: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, state: any) => callback(state)
    ipcRenderer.on('game-state', listener)
    return () => ipcRenderer.removeListener('game-state', listener)
  },
  onGameLog: (callback: any) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: any) => callback(entry)
    ipcRenderer.on('game-log', listener)
    return () => ipcRenderer.removeListener('game-log', listener)
  },
  windowControl: (action: string) => ipcRenderer.send('window-control', action),
  openLogs: () => ipcRenderer.send('open-logs'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url)
})
