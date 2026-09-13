// Author: nattapat2871 (https://nattapat2871.me)
import DiscordRPC from 'discord-rpc'
import log from 'electron-log'

type DiscordSettings = {
  discordRpcEnabled: boolean
  discordClientId: string
  launcherVersion: string
}

type DiscordPresenceState = 'disabled' | 'suspended' | 'connecting' | 'connected' | 'error'

export const MINECRAFT_OFFICIAL_APPLICATION_ID = '1402418491272986635'
const DISCORD_ACTIVITY_IMAGE_URL = 'https://namlauncher.nattapat2871.me/assets/namlauncher-icon.png'
const DISCORD_ACTIVITY_URL = 'https://namlauncher.nattapat2871.me'
const DISCORD_RECONNECT_DELAYS_MS = [5000, 15000, 30000] as const
const DISCORD_RECONNECT_COOLDOWN_MS = 120000

const getDiscordPlatformLabel = () => process.platform === 'darwin'
  ? 'macOS'
  : process.platform === 'win32'
    ? 'Windows'
    : 'Linux'

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : String(err || 'Unknown error')

const isDiscordTransportFailure = (err: unknown) => {
  return /(?:connection|socket|pipe).{0,40}(?:closed|destroyed|ended|reset)|not connected|write after end/i.test(
    getErrorMessage(err)
  )
}

export const getDiscordLargeImageText = (launcherVersion: unknown) => {
  const normalizedVersion = String(launcherVersion || '').trim().replace(/^v\.?/i, '')
  return normalizedVersion
    ? `NamLauncher For Minecraft v.${normalizedVersion}`
    : 'NamLauncher For Minecraft'
}

const isBenignDiscordDestroyError = (err: unknown) => {
  return /Cannot read properties of null \(reading 'write'\)/i.test(getErrorMessage(err))
}

const MINECRAFT_TEXTURE_ID_PATTERN = /^[a-f0-9]{64}$/i
const MINECRAFT_UUID_PATTERN = /^[a-f0-9]{32}$/i
const MINECRAFT_PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

export const getPlayerHeadUrl = (uuid: string, playerName: string, textureId?: string | null) => {
  const normalizedTextureId = String(textureId || '').trim().toLowerCase()
  if (MINECRAFT_TEXTURE_ID_PATTERN.test(normalizedTextureId)) {
    // Texture IDs are immutable content hashes, so a skin change also changes the
    // Discord image URL instead of reusing MCHeads' long-lived UUID/name cache.
    return `https://mc-heads.net/head/${normalizedTextureId}/64.png`
  }

  // Launch flow passes null when it cannot prove that a public texture matches
  // the selected local skin. In that case a UUID/name fallback could show a
  // different cached head, so omit the image instead.
  if (textureId !== undefined) return null

  const compactUuid = String(uuid || '').replace(/-/g, '').toLowerCase()
  if (MINECRAFT_UUID_PATTERN.test(compactUuid)) {
    return `https://mc-heads.net/head/${compactUuid}/64.png`
  }

  const fallbackName = String(playerName || '').trim()
  if (MINECRAFT_PLAYER_NAME_PATTERN.test(fallbackName)) {
    return `https://mc-heads.net/head/${encodeURIComponent(fallbackName)}/64.png`
  }

  return null
}

const getPlayerHeadPresence = (uuid: string, playerName: string, textureId?: string | null) => {
  const playerHeadUrl = getPlayerHeadUrl(uuid, playerName, textureId)
  if (!playerHeadUrl) return {}

  return {
    smallImageKey: playerHeadUrl,
    smallImageText: playerName
  }
}

type PresenceInput = DiscordRPC.Presence & {
  pid?: number
}

export class DiscordManager {
  private rpc: DiscordRPC.Client | null = null
  private settings: DiscordSettings | null = null
  private startTimestamp: number | null = null
  private launcherStartedAt = Date.now()
  private isConnected = false
  private lastActivity: (() => Promise<void>) | null = null
  private lastActivityName: string | null = null
  private lastActivityAt: string | null = null
  private lastActivityPid: number | null = null
  private lastActivitySignature: string | null = null
  private lastError: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private retryCooldown = false
  private hasLoggedUnavailable = false
  private suspended = false
  private connectionGeneration = 0

  public configure(settings: DiscordSettings) {
    this.suspended = false
    const previousEnabled = Boolean(this.settings?.discordRpcEnabled)
    const previousClientId = this.settings?.discordClientId?.trim() || ''
    const previousLauncherVersion = this.settings?.launcherVersion?.trim() || ''
    const nextClientId = settings.discordClientId?.trim() || ''
    const nextLauncherVersion = settings.launcherVersion?.trim() || ''
    const settingsChanged = previousEnabled !== settings.discordRpcEnabled
      || previousClientId !== nextClientId
      || previousLauncherVersion !== nextLauncherVersion
    this.settings = settings

    if (settingsChanged) {
      log.info(
        `Discord RPC configure: ${settings.discordRpcEnabled ? 'enabled' : 'disabled'}`
        + `${nextClientId ? ' with bundled app id' : ''} via ${getDiscordPlatformLabel()} IPC`
      )
    }

    if (!settings.discordRpcEnabled || !nextClientId) {
      this.lastActivity = null
      this.lastActivityName = null
      this.lastActivityAt = null
      this.lastActivitySignature = null
      this.lastError = null
      this.reconnectAttempts = 0
      this.retryCooldown = false
      this.hasLoggedUnavailable = false
      this.disconnect(true)
      return
    }

    if (previousClientId !== nextClientId) {
      this.reconnectAttempts = 0
      this.retryCooldown = false
      this.hasLoggedUnavailable = false
    }

    if (this.rpc && this.isConnected && previousClientId === nextClientId) {
      if (this.lastActivity) {
        this.lastActivity().catch((err) => log.debug('Failed to refresh Discord activity after configure', getErrorMessage(err)))
      } else {
        this.setIdleStatus()
      }
      return
    }

    if (settingsChanged || (!this.rpc && !this.reconnectTimer)) this.connect()
  }

  private connect() {
    if (this.suspended) return
    const clientId = this.settings?.discordClientId?.trim()
    if (!clientId) return

    this.disconnect(true)
    this.lastError = null
    if (this.reconnectAttempts === 0 && !this.retryCooldown) {
      log.info(`Discord RPC connecting over ${getDiscordPlatformLabel()} IPC with application id ${clientId}`)
    }

    const rpc = new DiscordRPC.Client({ transport: 'ipc' })
    this.rpc = rpc

    rpc.on('ready', () => {
      if (this.rpc !== rpc) return
      log.info('Discord RPC connected.')
      this.isConnected = true
      this.reconnectAttempts = 0
      this.retryCooldown = false
      this.hasLoggedUnavailable = false
      this.lastError = null
      const restoreActivity = this.lastActivity
      if (restoreActivity) {
        restoreActivity().catch((err) => log.debug('Failed to restore Discord activity after connect', getErrorMessage(err)))
      } else {
        this.setIdleStatus()
      }
    })

    rpc.on('disconnected', () => {
      if (this.rpc !== rpc) return
      if (this.isConnected) {
        log.warn('Discord RPC disconnected; reconnecting quietly in the background.')
        this.hasLoggedUnavailable = true
      }
      this.isConnected = false
      this.lastError = 'Discord disconnected'
      this.scheduleReconnect()
    })

    rpc.login({ clientId }).catch((err) => {
      if (this.rpc !== rpc) return
      const errorMessage = getErrorMessage(err)
      this.lastError = errorMessage || 'Discord RPC unavailable'
      this.isConnected = false

      if (!this.hasLoggedUnavailable) {
        log.warn(
          `Discord RPC unavailable on ${getDiscordPlatformLabel()}: ${this.lastError}. `
          + 'Presence will retry quietly when Discord becomes reachable.'
        )
        this.hasLoggedUnavailable = true
      }

      this.rpc = null
      rpc.destroy().catch((destroyError) => {
        if (!isBenignDiscordDestroyError(destroyError)) {
          log.debug('Discord RPC failed-client cleanup:', getErrorMessage(destroyError))
        }
      })
      this.scheduleReconnect()
    })
  }

  private disconnect(clearActivity = false) {
    this.connectionGeneration += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const rpc = this.rpc
    const shouldClear = clearActivity && this.isConnected
    const activityPid = this.lastActivityPid || process.pid

    // Invalidate callbacks before clearing/destroying the old IPC transport.
    this.rpc = null
    this.isConnected = false
    this.startTimestamp = null
    this.lastActivityPid = null
    this.lastActivitySignature = null

    if (rpc) {
      const destroy = () => rpc.destroy().catch((err) => {
        if (!isBenignDiscordDestroyError(err)) log.debug('Discord RPC destroy failed', getErrorMessage(err))
      })
      if (shouldClear) {
        rpc.clearActivity(activityPid)
          .catch((err) => log.debug('Failed to clear Discord activity before disconnect', getErrorMessage(err)))
          .finally(destroy)
      } else {
        destroy()
      }
    }
  }

  private scheduleReconnect() {
    if (this.suspended || this.isConnected || !this.settings?.discordRpcEnabled || this.reconnectTimer) return

    let delayMs: number
    if (this.reconnectAttempts < DISCORD_RECONNECT_DELAYS_MS.length) {
      delayMs = DISCORD_RECONNECT_DELAYS_MS[this.reconnectAttempts]
      this.reconnectAttempts += 1
    } else {
      delayMs = DISCORD_RECONNECT_COOLDOWN_MS
      this.reconnectAttempts = 0
      this.retryCooldown = true
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.settings?.discordRpcEnabled && !this.isConnected) this.connect()
    }, delayMs)
  }

  private getActivitySignature(label: string, pid: number, presence: DiscordRPC.Presence) {
    return JSON.stringify({ label, pid, presence })
  }

  private async setActivity(label: string, activity: PresenceInput) {
    if (this.suspended || !this.settings?.discordRpcEnabled) return
    if (!this.isConnected || !this.rpc) {
      const activityChanged = this.lastActivityName !== label
      this.lastActivityName = label
      this.lastError = 'Waiting for Discord desktop connection'
      if (activityChanged) log.debug(`Discord RPC activity deferred: ${label}`)
      if (!this.rpc && !this.reconnectTimer) this.connect()
      return
    }

    const rpc = this.rpc
    const generation = this.connectionGeneration
    try {
      const { pid: activityPid, ...presenceInput } = activity
      const pid = activityPid || process.pid
      const presence = {
        ...presenceInput,
        buttons: presenceInput.buttons || [
          {
            label: 'NamLauncher Website',
            url: DISCORD_ACTIVITY_URL
          }
        ],
        instance: presenceInput.instance ?? true
      }
      const activitySignature = this.getActivitySignature(label, pid, presence)
      if (this.lastActivitySignature === activitySignature) {
        this.lastActivityName = label
        this.lastError = null
        return
      }

      // Remember the target before awaiting: tray sleep must clear even an in-flight publish.
      this.lastActivityPid = pid
      await rpc.setActivity(presence, pid)
      if (this.suspended || this.rpc !== rpc || generation !== this.connectionGeneration) return
      this.lastActivityName = label
      this.lastActivityAt = new Date().toISOString()
      this.lastActivityPid = pid
      this.lastActivitySignature = activitySignature
      this.lastError = null
    } catch (err) {
      if (this.suspended || this.rpc !== rpc || generation !== this.connectionGeneration) return
      this.lastError = err instanceof Error ? err.message : 'Discord RPC setActivity failed'
      log.warn(`Discord RPC setActivity failed: ${getErrorMessage(err)}`)
      if (isDiscordTransportFailure(err)) {
        this.disconnect(false)
        this.scheduleReconnect()
      }
    }
  }

  private replaceActivity(label: string, activity: PresenceInput) {
    if (this.suspended) return
    const generation = this.connectionGeneration
    const previousPid = this.lastActivityPid
    const nextPid = activity.pid || process.pid
    const publish = () => this.setActivity(label, activity)
    this.lastActivity = publish

    const transition = async () => {
      if (previousPid && previousPid !== nextPid && this.isConnected && this.rpc) {
        await this.rpc.clearActivity(previousPid)
          .catch((err) => log.debug(`Failed to clear previous Discord activity for pid ${previousPid}`, err))
      }
      if (this.suspended || generation !== this.connectionGeneration) return
      await publish()
    }

    transition().catch((err) => log.debug(`Failed to transition Discord activity to ${label}`, err))
  }

  public setIdleStatus() {
    if (this.suspended) return
    this.startTimestamp = null
    this.replaceActivity('Browsing instances', {
      details: 'Browsing instances',
      state: 'NamLauncher',
      startTimestamp: new Date(this.launcherStartedAt),
      largeImageKey: DISCORD_ACTIVITY_IMAGE_URL,
      largeImageText: getDiscordLargeImageText(this.settings?.launcherVersion),
      instance: true
    })
  }

  public clearActivity() {
    const activityPid = this.lastActivityPid || process.pid
    this.startTimestamp = null
    this.lastActivity = null
    this.lastActivityName = null
    this.lastActivityAt = null
    this.lastActivityPid = null
    this.lastActivitySignature = null
    if (!this.isConnected || !this.rpc) return
    this.rpc.clearActivity(activityPid).catch((err) => log.debug('Failed to clear Discord activity', err))
  }

  public getStatus() {
    const enabled = Boolean(this.settings?.discordRpcEnabled && this.settings?.discordClientId)
    const state: DiscordPresenceState = !enabled
      ? 'disabled'
      : this.suspended
        ? 'suspended'
        : this.isConnected
          ? 'connected'
          : this.retryCooldown
            ? 'error'
            : 'connecting'

    return {
      enabled,
      state,
      connected: this.isConnected,
      lastActivity: this.lastActivityName,
      lastActivityAt: this.lastActivityAt,
      applicationId: this.settings?.discordClientId || null,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts
    }
  }

  public waitUntilConnected(timeoutMs = 5000) {
    const startedAt = Date.now()
    return new Promise<boolean>((resolve) => {
      const check = () => {
        if (this.isConnected) {
          resolve(true)
          return
        }
        if (this.suspended || !this.settings?.discordRpcEnabled || Date.now() - startedAt >= timeoutMs) {
          resolve(false)
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

  public setInGameStatus(
    instanceName: string,
    _minecraftVersion: string,
    playerName: string,
    uuid: string,
    gamePid: number,
    textureId?: string | null
  ) {
    if (this.suspended) return
    this.startTimestamp = Date.now()
    this.replaceActivity('Minecraft', {
      details: instanceName,
      state: `Name : ${playerName}`,
      startTimestamp: new Date(this.startTimestamp),
      largeImageKey: DISCORD_ACTIVITY_IMAGE_URL,
      largeImageText: getDiscordLargeImageText(this.settings?.launcherVersion),
      ...getPlayerHeadPresence(uuid, playerName, textureId),
      pid: Number(gamePid) || process.pid,
      instance: true
    })
  }

  public setLauncherGameStatus(
    instanceName: string,
    _minecraftVersion: string,
    playerName: string,
    uuid: string,
    gamePid: number,
    textureId?: string | null
  ) {
    if (this.suspended) return
    this.startTimestamp = Date.now()
    this.replaceActivity('NamLauncher', {
      details: 'NamLauncher',
      state: instanceName,
      startTimestamp: new Date(this.startTimestamp),
      largeImageKey: DISCORD_ACTIVITY_IMAGE_URL,
      largeImageText: getDiscordLargeImageText(this.settings?.launcherVersion),
      ...getPlayerHeadPresence(uuid, playerName, textureId),
      pid: Number(gamePid) || process.pid,
      instance: true
    })
  }

  public shutdown() {
    this.suspended = true
    this.lastActivity = null
    this.lastActivityName = null
    this.lastActivityAt = null
    this.lastActivitySignature = null
    this.lastError = null
    this.reconnectAttempts = 0
    this.retryCooldown = false
    this.hasLoggedUnavailable = false
    this.disconnect(true)
  }
}

export const discordManager = new DiscordManager()
export const minecraftDiscordManager = new DiscordManager()
