/// <reference types="vite/client" />

declare module '*.css'

declare module 'msmc' {
  export type MsmcPrompt = 'login' | 'none' | 'consent' | 'select_account'
  export type MsmcFramework = 'electron' | 'nwjs' | 'raw'

  export type MsmcUpdate = {
    type: 'Starting' | 'Loading' | 'Error'
    data?: string
    percent?: number
    error?: MsmcResult
  }

  export type MsmcResult = {
    type: 'Success' | 'DemoUser' | 'Authentication' | 'Cancelled' | 'Unknown'
    access_token?: string
    profile?: {
      id: string
      name: string
      skins?: unknown[]
      capes?: unknown[]
      xuid: string
    }
    reason?: string
    data?: Response
    translationString?: string
    [key: string]: unknown
  }

  export type MclcUser = {
    access_token: string
    client_token?: string
    uuid: string
    name?: string
    meta?: { type: 'mojang' | 'xbox'; xuid?: string; demo?: boolean }
    user_properties?: unknown
  }

  export type MsmcWindowProperties = {
    width: number
    height: number
    resizable?: boolean
    suppress?: boolean
    [key: string]: unknown
  }

  export function fastLaunch(
    type: MsmcFramework,
    updates?: (info: MsmcUpdate) => void,
    prompt?: MsmcPrompt,
    properties?: MsmcWindowProperties
  ): Promise<MsmcResult>

  export function errorCheck(result: MsmcResult): boolean

  export function getMCLC(): {
    getAuth: (info: MsmcResult) => MclcUser
    validate: (profile: MclcUser) => Promise<boolean>
    refresh: (
      profile: MclcUser,
      updates?: (info: MsmcUpdate) => void
    ) => Promise<MclcUser>
  }
}
