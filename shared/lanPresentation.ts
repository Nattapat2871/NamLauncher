// Author/creator: nattapat2871 (https://nattapat2871.me)

export type LanReadinessSummary = {
  addresses: string[]
  detectedPort: number | null
}

export type DiscoveredLanServerSummary = {
  address: string
  port: number
  endpoint: string
}

export type VisibleLanServerSummary = DiscoveredLanServerSummary & {
  local: boolean
}

export type LanDiscoveryViewState = 'error' | 'loading' | 'found' | 'empty'

export const hasUsableLocalLanEndpoint = (readiness: LanReadinessSummary | null) => Boolean(
  readiness?.detectedPort && readiness.addresses.length > 0
)

export const mergeLanServerSummaries = (
  discoveredServers: readonly DiscoveredLanServerSummary[],
  readiness: LanReadinessSummary | null
): VisibleLanServerSummary[] => {
  const entries = new Map<string, VisibleLanServerSummary>()
  for (const server of discoveredServers) {
    entries.set(server.endpoint, { ...server, local: false })
  }

  if (readiness?.detectedPort) {
    for (const address of readiness.addresses) {
      const endpoint = `${address}:${readiness.detectedPort}`
      entries.set(endpoint, {
        address,
        port: readiness.detectedPort,
        endpoint,
        local: true
      })
    }
  }

  return [...entries.values()].sort(
    (left, right) => Number(right.local) - Number(left.local) || left.endpoint.localeCompare(right.endpoint)
  )
}

export const resolveLanDiscoveryViewState = (input: {
  loading: boolean
  hasError: boolean
  resultCount: number
}): LanDiscoveryViewState => {
  if (input.hasError) return 'error'
  if (input.loading && input.resultCount === 0) return 'loading'
  if (input.resultCount > 0) return 'found'
  return 'empty'
}
