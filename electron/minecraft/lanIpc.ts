// Author/creator: nattapat2871 (https://nattapat2871.me)
import type { MinecraftLanServer } from './lanDiscovery.ts'

export type MinecraftLanServerSummary = Pick<MinecraftLanServer, 'address' | 'port' | 'endpoint'>

type RendererWindowLike = {
  isDestroyed: () => boolean
  webContents: {
    isDestroyed: () => boolean
  }
}

export const isTrustedRendererSender = (
  window: RendererWindowLike | null,
  sender: unknown
) => Boolean(
  window
  && !window.isDestroyed()
  && !window.webContents.isDestroyed()
  && sender === window.webContents
)

export const summarizeMinecraftLanServers = (
  servers: readonly MinecraftLanServer[]
): MinecraftLanServerSummary[] => servers.map(({ address, port, endpoint }) => ({
  address,
  port,
  endpoint
}))

export const createLanDiscoveryCoordinator = (
  discover: () => Promise<readonly MinecraftLanServer[]>
) => {
  let active: Promise<MinecraftLanServerSummary[]> | null = null

  return () => {
    if (active) return active
    const request = Promise.resolve()
      .then(discover)
      .then(summarizeMinecraftLanServers)
      .finally(() => {
        if (active === request) active = null
      })
    active = request
    return request
  }
}

export const shouldPublishLanSessionPort = (currentPort: unknown, detectedPort: unknown) => {
  const port = Number(detectedPort)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 && port !== Number(currentPort)
}
