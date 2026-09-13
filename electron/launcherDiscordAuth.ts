// Author/creator: nattapat2871 (https://nattapat2871.me)
import axios from 'axios'
import { retryAfterMilliseconds } from './networkRetry.ts'

export type LauncherDiscordProfile = {
  id: string
  username: string
  displayName: string
  avatarUrl: string
  expiresAt: string | null
}

export type LauncherDiscordLinkResult = {
  sessionToken: string
  profile: LauncherDiscordProfile
}

const requestHeaders = (ingestToken: string, identityToken?: string) => ({
  Authorization: `Bearer ${ingestToken}`,
  ...(identityToken ? { 'X-NamLauncher-Identity': identityToken } : {})
})

const parseProfile = (value: any): LauncherDiscordProfile => {
  const id = String(value?.id || '').trim()
  const username = String(value?.username || '').trim()
  const displayName = String(value?.display_name || username).trim()
  const avatarUrl = String(value?.avatar_url || '').trim()
  const expiresAt = value?.expires_at ? String(value.expires_at) : null
  if (!/^[0-9]{17,20}$/.test(id) || !username || !displayName) {
    throw new Error('NamLauncher received an invalid Discord profile.')
  }
  const avatar = new URL(avatarUrl)
  if (avatar.protocol !== 'https:' || avatar.hostname !== 'cdn.discordapp.com') {
    throw new Error('NamLauncher received an unsafe Discord avatar URL.')
  }
  return { id, username, displayName, avatarUrl: avatar.toString(), expiresAt }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const isTransientAuthFailure = (error: unknown) => axios.isAxiosError(error) && (
  (!error.response && error.code !== 'ERR_CANCELED')
  || [408, 429, 502, 503, 504].includes(error.response?.status || 0)
)

export const startLauncherDiscordLink = async (
  apiBase: string, ingestToken: string, runtime = { now: Date.now, sleep: delay }
) => {
  const deadline = runtime.now() + 45_000
  let response
  for (let attempt = 0; ; attempt++) {
    try {
      response = await axios.post(`${apiBase}/api/v1/launcher-auth/discord/start`, null, {
        headers: requestHeaders(ingestToken),
        timeout: Math.min(15_000, Math.max(1, deadline - runtime.now())),
        maxContentLength: 16 * 1024,
        maxBodyLength: 16 * 1024
      })
      break
    } catch (error) {
      // A lost start response can leave only an expiring, unauthorised transaction.
      // Never open the browser until one validated response has arrived.
      if (attempt >= 2 || !isTransientAuthFailure(error)) throw error
      const pause = retryAfterMilliseconds(
        axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined,
        1000 * 2 ** attempt, runtime.now()
      )
      if (runtime.now() + pause >= deadline) throw error
      await runtime.sleep(pause)
    }
  }
  const authorizeUrl = String(response.data?.authorize_url || '').trim()
  const requestToken = String(response.data?.request_token || '').trim()
  const parsed = new URL(authorizeUrl)
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'discord.com'
    || parsed.pathname !== '/oauth2/authorize'
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== '443')
  ) throw new Error('NamLauncher refused an unsafe Discord authorization URL.')
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(requestToken)) {
    throw new Error('NamLauncher received an invalid Discord authorization transaction.')
  }
  return { authorizeUrl: parsed.toString(), requestToken }
}

export const waitForLauncherDiscordLink = async (
  apiBase: string,
  ingestToken: string,
  requestToken: string,
  timeoutMs = 10 * 60_000,
  runtime = { now: Date.now, sleep: delay }
): Promise<LauncherDiscordLinkResult> => {
  const deadline = runtime.now() + Math.max(30_000, Math.min(timeoutMs, 10 * 60_000))
  let consecutiveFailures = 0
  while (runtime.now() < deadline) {
    let response
    try {
      response = await axios.post(
      `${apiBase}/api/v1/launcher-auth/discord/poll`,
      { request_token: requestToken },
      {
        headers: requestHeaders(ingestToken),
        timeout: Math.min(15_000, Math.max(1, deadline - runtime.now())),
        maxContentLength: 32 * 1024,
        maxBodyLength: 32 * 1024
      }
      )
      consecutiveFailures = 0
    } catch (error) {
      if (!isTransientAuthFailure(error) || ++consecutiveFailures > 5) throw error
      const pause = retryAfterMilliseconds(
        axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined,
        Math.min(15_000, 1000 * 2 ** consecutiveFailures), runtime.now()
      )
      if (runtime.now() + pause >= deadline) break
      await runtime.sleep(pause)
      continue
    }
    const status = String(response.data?.status || '')
    if (status === 'pending') {
      await runtime.sleep(Math.min(2500, Math.max(0, deadline - runtime.now())))
      continue
    }
    if (status === 'authorized') {
      const sessionToken = String(response.data?.session_token || '').trim()
      if (!/^[A-Za-z0-9_-]{48,256}$/.test(sessionToken)) {
        throw new Error('NamLauncher received an invalid Discord session.')
      }
      return { sessionToken, profile: parseProfile(response.data?.profile) }
    }
    if (status === 'expired') throw new Error('Discord sign-in expired. Please try again.')
    if (status === 'consumed') throw new Error('This Discord sign-in was already completed. Please try again.')
    throw new Error('Discord sign-in returned an unexpected state.')
  }
  throw new Error('Discord sign-in timed out. Please try again.')
}

export const validateLauncherDiscordSession = async (
  apiBase: string,
  ingestToken: string,
  sessionToken: string
) => {
  const response = await axios.get(`${apiBase}/api/v1/launcher-auth/discord/session`, {
    headers: requestHeaders(ingestToken, sessionToken),
    timeout: 12_000,
    maxContentLength: 32 * 1024,
    maxBodyLength: 32 * 1024
  })
  return parseProfile(response.data?.profile)
}

export const revokeLauncherDiscordSession = async (
  apiBase: string,
  ingestToken: string,
  sessionToken: string
) => {
  await axios.post(`${apiBase}/api/v1/launcher-auth/discord/logout`, null, {
    headers: requestHeaders(ingestToken, sessionToken),
    timeout: 12_000,
    maxContentLength: 16 * 1024,
    maxBodyLength: 16 * 1024
  })
}
