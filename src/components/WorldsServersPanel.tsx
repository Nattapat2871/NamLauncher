// Author/creator: nattapat2871 (https://nattapat2871.me)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'
import { MinecraftServerMotd, type MinecraftServerPing } from './MinecraftServerMotd'
import {
  hasUsableLocalLanEndpoint,
  mergeLanServerSummaries,
  resolveLanDiscoveryViewState,
  type DiscoveredLanServerSummary,
  type LanReadinessSummary
} from '../../shared/lanPresentation'

export type InstancePlacesTarget = {
  id: string
  name: string
  version: string
  loader: string
}

export type LanReadinessResult = LanReadinessSummary

export type DiscoveredLanServer = DiscoveredLanServerSummary

export type LanSessionDetected = {
  instanceId: string
  port: number
}

export type InstancePlaceQuickPlay =
  | { type: 'server'; address: string }
  | { type: 'world'; folderName: string }

export type MinecraftWorldPlace = {
  folderName: string
  displayName: string
  iconDataUrl: string | null
  recoveredFromBackup: boolean
  lastPlayedAt: number | null
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator' | 'unknown'
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard' | 'unknown'
  hardcore: boolean
  allowCommands: boolean
  minecraftVersion: string | null
  dataVersion: number | null
}

export type MinecraftServerPlace = {
  index: number
  name: string
  address: string
  canonicalKey: string | null
  hidden: boolean
  acceptsServerResourcePack: boolean | null
  iconDataUrl: string | null
}

type InstancePlacesResult = {
  worlds: MinecraftWorldPlace[]
  worldFailures: Array<{ folderName: string; message: string }>
  servers: MinecraftServerPlace[]
}

type ServerMutationResult = {
  changed: boolean
  servers: MinecraftServerPlace[]
}

export type InstancePlacesApi = {
  getInstancePlaces: (instance: InstancePlacesTarget) => Promise<InstancePlacesResult>
  getLanReadiness: (request: { instance: InstancePlacesTarget }) => Promise<LanReadinessResult>
  discoverLanServers: () => Promise<DiscoveredLanServer[]>
  onLanSessionDetected?: (callback: (payload: LanSessionDetected) => void) => () => void
  pingInstanceServers: (instance: InstancePlacesTarget, addresses?: readonly string[]) => Promise<MinecraftServerPing[]>
  addInstanceServer: (request: { instance: InstancePlacesTarget; name: string; address: string }) => Promise<ServerMutationResult>
  removeInstanceServer: (request: { instance: InstancePlacesTarget; index: number; expectedCanonicalKey: string }) => Promise<ServerMutationResult>
  copyToClipboard: (value: string) => Promise<{ success: boolean }>
}

type PlaceFilter = 'all' | 'singleplayer' | 'online' | 'offline'

type WorldsServersPanelProps = {
  instance: InstancePlacesTarget
  api: InstancePlacesApi
  language: 'en' | 'th'
  busy: boolean
  t: (key: string) => string
  tf: (key: string, values: Record<string, string | number>) => string
  onPlay: (quickPlay: InstancePlaceQuickPlay, label: string) => Promise<void> | void
  confirmRemoval: (server: MinecraftServerPlace, onConfirm: () => Promise<void>) => void
  onStatus: (message: string) => void
}

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

const supportsWorldQuickPlay = (version: string) => {
  const normalized = String(version || '').trim()
  const calendarVersion = normalized.match(/^(\d{2,})(?:\.|$)/)
  if (calendarVersion) return Number(calendarVersion[1]) >= 26
  const weeklySnapshot = normalized.match(/^(\d{2})w\d{2}[a-z](?:_or_[a-z])?$/i)
  if (weeklySnapshot) return Number(weeklySnapshot[1]) >= 23
  const releaseVersion = normalized.match(/^1\.(\d+)/)
  return Boolean(releaseVersion && Number(releaseVersion[1]) >= 20)
}

const formatWorldDate = (timestamp: number | null, language: 'en' | 'th', neverLabel: string) => {
  if (!timestamp || !Number.isFinite(timestamp)) return neverLabel
  try {
    return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp))
  } catch {
    return neverLabel
  }
}

const WorldsServersPanel: React.FC<WorldsServersPanelProps> = ({
  instance,
  api,
  language,
  busy,
  t,
  tf,
  onPlay,
  confirmRemoval,
  onStatus
}) => {
  const [places, setPlaces] = useState<InstancePlacesResult>({ worlds: [], worldFailures: [], servers: [] })
  const [serverPings, setServerPings] = useState<Record<number, MinecraftServerPing>>({})
  const [loading, setLoading] = useState(true)
  const [pingLoading, setPingLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PlaceFilter>('all')
  const [showAddServer, setShowAddServer] = useState(false)
  const [serverName, setServerName] = useState('')
  const [serverAddress, setServerAddress] = useState('')
  const [mutationBusy, setMutationBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const requestIdRef = useRef(0)
  const lanRequestIdRef = useRef(0)
  const [lanReadiness, setLanReadiness] = useState<LanReadinessResult | null>(null)
  const [discoveredLanServers, setDiscoveredLanServers] = useState<DiscoveredLanServer[]>([])
  const [lanLoading, setLanLoading] = useState(true)
  const [lanError, setLanError] = useState('')
  const [copiedEndpoint, setCopiedEndpoint] = useState('')

  const refreshPings = useCallback(async (requestId: number) => {
    setPingLoading(true)
    try {
      const pings = await api.pingInstanceServers(instance)
      if (requestId !== requestIdRef.current) return
      setServerPings(Object.fromEntries(pings.map((ping) => [ping.index, ping])))
    } catch (pingError) {
      if (requestId !== requestIdRef.current) return
      setServerPings({})
      console.error('[NamLauncher] Could not ping instance servers', pingError)
    } finally {
      if (requestId === requestIdRef.current) setPingLoading(false)
    }
  }, [api, instance])

  const refreshPlaces = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError('')
    setServerPings({})
    try {
      const result = await api.getInstancePlaces(instance)
      if (requestId !== requestIdRef.current) return
      setPlaces(result)
      setLoading(false)
      await refreshPings(requestId)
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      console.error('[NamLauncher] Could not read instance worlds and servers', loadError)
      setError(loadError instanceof Error ? loadError.message : String(loadError || 'Unknown error'))
      setLoading(false)
    }
  }, [api, instance, refreshPings])

  const refreshLanServers = useCallback(async () => {
    const requestId = lanRequestIdRef.current + 1
    lanRequestIdRef.current = requestId
    setLanLoading(true)
    setLanError('')
    const [localResult, discoveryResult] = await Promise.allSettled([
      api.getLanReadiness({ instance }),
      api.discoverLanServers()
    ])
    if (requestId !== lanRequestIdRef.current) return

    setLanReadiness(localResult.status === 'fulfilled' ? localResult.value : null)
    setDiscoveredLanServers(discoveryResult.status === 'fulfilled' ? discoveryResult.value : [])
    const hasLocalEndpoint = localResult.status === 'fulfilled' && hasUsableLocalLanEndpoint(localResult.value)
    if (discoveryResult.status === 'rejected' && !hasLocalEndpoint) {
      console.error('[NamLauncher] LAN discovery is unavailable')
      setLanError('lan.error')
    }
    setLanLoading(false)
  }, [api, instance])

  useEffect(() => {
    void refreshPlaces()
    return () => {
      requestIdRef.current += 1
    }
  }, [refreshPlaces])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshLanServers(), 180)
    return () => {
      window.clearTimeout(timeout)
      lanRequestIdRef.current += 1
    }
  }, [refreshLanServers])

  useEffect(() => {
    if (!api.onLanSessionDetected) return
    return api.onLanSessionDetected((payload) => {
      if (payload.instanceId !== instance.id) return
      onStatus(tf('lan.detected', { port: payload.port }))
      void refreshLanServers()
    })
  }, [api, instance.id, onStatus, refreshLanServers, tf])

  const normalizedQuery = query.trim().toLocaleLowerCase(language === 'th' ? 'th-TH' : 'en-US')
  const visibleWorlds = useMemo(() => {
    if (filter !== 'all' && filter !== 'singleplayer') return []
    return places.worlds.filter((world) => !normalizedQuery || [
      world.displayName,
      world.folderName,
      world.gameMode,
      world.minecraftVersion || ''
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
  }, [filter, normalizedQuery, places.worlds])

  const visibleServers = useMemo(() => {
    if (filter === 'singleplayer') return []
    return places.servers.filter((server) => {
      const ping = serverPings[server.index]
      if (filter === 'online' && ping?.online !== true) return false
      if (filter === 'offline' && (pingLoading || ping?.online !== false)) return false
      const motd = ping?.status?.motd?.plainText || ''
      return !normalizedQuery || [server.name, server.address, motd, ping?.status?.version?.name || '']
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    })
  }, [filter, normalizedQuery, pingLoading, places.servers, serverPings])

  const visibleCount = visibleWorlds.length + visibleServers.length
  const worldQuickPlaySupported = supportsWorldQuickPlay(instance.version)
  const visibleLanServers = useMemo(
    () => mergeLanServerSummaries(discoveredLanServers, lanReadiness),
    [discoveredLanServers, lanReadiness]
  )
  const lanViewState = resolveLanDiscoveryViewState({
    loading: lanLoading,
    hasError: Boolean(lanError),
    resultCount: visibleLanServers.length
  })

  const copyLanEndpoint = async (endpoint: string) => {
    try {
      const result = await api.copyToClipboard(endpoint)
      if (result?.success === false) throw new Error('Clipboard write failed')
      setCopiedEndpoint(endpoint)
      onStatus(tf('lan.endpoint.copiedStatus', { endpoint }))
    } catch (copyError) {
      console.error('[NamLauncher] Could not copy LAN endpoint', copyError)
      onStatus(t('lan.endpoint.copyFailed'))
    }
  }

  const submitServer = async (event: React.FormEvent) => {
    event.preventDefault()
    if (mutationBusy) return
    setMutationBusy(true)
    setFormError('')
    try {
      const result = await api.addInstanceServer({
        instance,
        name: serverName,
        address: serverAddress
      })
      setPlaces((current) => ({ ...current, servers: result.servers }))
      setServerName('')
      setServerAddress('')
      setShowAddServer(false)
      onStatus(t('places.add.success'))
      const requestId = requestIdRef.current
      await refreshPings(requestId)
    } catch (mutationError) {
      setFormError(mutationError instanceof Error ? mutationError.message : String(mutationError || t('places.add.error')))
    } finally {
      setMutationBusy(false)
    }
  }

  const removeServer = (server: MinecraftServerPlace) => {
    if (!server.canonicalKey || mutationBusy) return
    confirmRemoval(server, async () => {
      setMutationBusy(true)
      try {
        const result = await api.removeInstanceServer({
          instance,
          index: server.index,
          expectedCanonicalKey: server.canonicalKey!
        })
        setPlaces((current) => ({ ...current, servers: result.servers }))
        setServerPings({})
        onStatus(t('places.remove.success'))
        const requestId = requestIdRef.current
        await refreshPings(requestId)
      } finally {
        setMutationBusy(false)
      }
    })
  }

  return (
    <div className="space-y-4" data-testid="worlds-servers-panel">
      <section aria-labelledby="lan-discovery-title" className="overflow-hidden rounded-xl border border-blue-400/20 bg-slate-950/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex flex-col gap-4 border-b border-slate-800 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-400/25 bg-blue-500/10 text-blue-200">
              <Wifi size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 id="lan-discovery-title" className="text-sm font-black text-white">{t('lan.title')}</h4>
                <span
                  className={classNames(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase',
                    lanViewState === 'error'
                      ? 'border-red-400/30 bg-red-500/10 text-red-200'
                      : lanViewState === 'loading'
                        ? 'border-blue-400/30 bg-blue-500/10 text-blue-100'
                        : lanViewState === 'found'
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-slate-700 bg-slate-900/60 text-slate-400'
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {lanViewState === 'error' ? <AlertTriangle size={11} aria-hidden="true" />
                    : lanViewState === 'loading' ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                      : lanViewState === 'found' ? <CheckCircle2 size={11} aria-hidden="true" />
                        : <WifiOff size={11} aria-hidden="true" />}
                  {lanViewState === 'error'
                    ? t('lan.status.unavailable')
                    : lanViewState === 'loading'
                      ? t('lan.status.checking')
                      : lanViewState === 'found'
                        ? tf('lan.status.found', { count: visibleLanServers.length })
                        : t('lan.status.empty')}
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-slate-500">{t('lan.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshLanServers()}
            disabled={lanLoading}
            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={14} className={classNames(lanLoading ? 'animate-spin' : '')} aria-hidden="true" />
            {lanLoading ? t('lan.refreshing') : t('lan.refresh')}
          </button>
        </div>

        <div className="p-4" aria-live="polite" aria-busy={lanLoading}>
          {lanViewState === 'error' ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-3 text-red-200" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-[11px] font-semibold leading-5">{t(lanError)}</p>
            </div>
          ) : lanViewState === 'loading' ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              {t('lan.scanning')}
            </div>
          ) : lanViewState === 'found' ? (
            <ul className="space-y-2" aria-label={t('lan.list.label')}>
              {visibleLanServers.map((server) => (
                <li key={server.endpoint} className="flex min-w-0 flex-col gap-3 rounded-lg border border-blue-400/15 bg-blue-500/[0.05] p-3 sm:flex-row sm:items-center">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-200">
                    <Wifi size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-100">
                      {server.local ? t('lan.server.local') : t('lan.server.remote')}
                    </p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <code className="nam-selectable break-all font-mono text-xs font-black text-blue-100">{server.endpoint}</code>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-black text-slate-300">
                        {tf('lan.port.detected', { port: server.port })}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyLanEndpoint(server.endpoint)}
                    aria-label={tf('lan.endpoint.copyLabel', { endpoint: server.endpoint })}
                    className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-blue-400/25 px-3 text-[11px] font-black text-blue-100 transition-colors hover:border-blue-300/50 hover:bg-blue-500/15"
                  >
                    {copiedEndpoint === server.endpoint ? <CheckCircle2 size={13} aria-hidden="true" /> : <ClipboardCopy size={13} aria-hidden="true" />}
                    {copiedEndpoint === server.endpoint ? t('lan.endpoint.copied') : t('lan.endpoint.copy')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex min-h-24 items-center gap-3 rounded-lg border border-dashed border-slate-700 px-4 py-4 text-slate-500">
              <Info size={18} className="shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-black text-slate-300">{t('lan.empty.title')}</p>
                <p className="mt-1 text-[11px] font-semibold leading-5">{t('lan.empty.detail')}</p>
              </div>
            </div>
          )}
          <p className="mt-3 text-[10px] font-semibold leading-4 text-slate-600">{t('lan.scope')}</p>
        </div>
        <p className="sr-only" aria-live="polite">{copiedEndpoint ? tf('lan.endpoint.copiedStatus', { endpoint: copiedEndpoint }) : ''}</p>
      </section>

      {!worldQuickPlaySupported && places.worlds.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 text-amber-100">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-xs font-semibold leading-5">{t('places.world.legacyHelp')}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 transition-colors focus-within:border-blue-400/60 focus-within:bg-slate-950">
          <Search size={16} className="shrink-0 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tf('places.search', { count: places.worlds.length + places.servers.length })}
            aria-label={t('places.search.label')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('content.search.clear')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setShowAddServer(true)}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-black text-slate-100 transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100 disabled:cursor-not-allowed disabled:opacity-50 lg:flex-none"
          >
            <Plus size={15} />
            {t('places.add.button')}
          </button>
          <button
            type="button"
            onClick={() => void refreshPlaces()}
            disabled={loading || pingLoading}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 text-xs font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60 lg:flex-none"
          >
            <RefreshCw size={15} className={classNames(loading || pingLoading ? 'animate-spin' : '')} />
            {t('places.refresh')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('places.filter.label')}>
          {(['all', 'singleplayer', 'online', 'offline'] as const).map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
              className={classNames(
                'h-9 rounded-full border px-3 text-xs font-black transition-colors',
                filter === option
                  ? 'border-blue-300/60 bg-blue-500/15 text-blue-100'
                  : 'border-slate-800 bg-slate-950/30 text-slate-500 hover:border-slate-700 hover:text-slate-200'
              )}
            >
              {t(`places.filter.${option}`)}
            </button>
          ))}
        </div>
        <span className="text-xs font-bold tabular-nums text-slate-500">{tf('places.count', { count: visibleCount })}</span>
      </div>

      {places.worldFailures.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <p className="text-xs font-black text-amber-100">{tf('places.world.failure.title', { count: places.worldFailures.length })}</p>
            <p className="mt-1 text-[11px] font-semibold text-amber-200/65">{t('places.world.failure.body')}</p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/15" aria-live="polite">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm font-bold text-slate-500">
            <Loader2 size={18} className="animate-spin" />
            {t('places.loading')}
          </div>
        ) : error ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <AlertTriangle size={30} className="text-red-300" />
            <p className="mt-3 text-sm font-black text-slate-200">{t('places.error.title')}</p>
            <p className="mt-1 max-w-xl break-words text-xs font-semibold text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => void refreshPlaces()}
              className="mt-4 flex h-10 items-center gap-2 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-200 hover:border-blue-400/50 hover:bg-blue-500/10"
            >
              <RefreshCw size={14} />
              {t('places.retry')}
            </button>
          </div>
        ) : visibleCount === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <Search size={30} className="text-slate-700" />
            <p className="mt-3 text-sm font-black text-slate-400">{t('places.empty.title')}</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{query ? t('places.empty.search') : t('places.empty.body')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800" role="list">
            {visibleWorlds.map((world) => (
              <article key={`world:${world.folderName}`} className="flex flex-col gap-3 bg-slate-950/20 p-4 transition-colors hover:bg-blue-500/[0.04] sm:flex-row sm:items-center" role="listitem">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-blue-300">
                    {world.iconDataUrl ? <img src={world.iconDataUrl} alt="" className="h-full w-full object-cover" /> : <Box size={20} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4 className="max-w-full truncate text-sm font-black text-slate-100" title={world.displayName}>{world.displayName}</h4>
                      <span className="rounded bg-blue-500/12 px-1.5 py-0.5 text-[10px] font-black uppercase text-blue-200">{t('places.singleplayer')}</span>
                      {world.hardcore && <span className="rounded bg-red-500/12 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-200">{t('places.world.hardcore')}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                      <span className="capitalize">{t(`places.world.mode.${world.gameMode}`)}</span>
                      {world.minecraftVersion && <span className="font-mono text-slate-400">{world.minecraftVersion}</span>}
                      <span className="flex items-center gap-1"><Clock3 size={12} />{formatWorldDate(world.lastPlayedAt, language, t('places.neverPlayed'))}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPlay({ type: 'world', folderName: world.folderName }, world.displayName)}
                  className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-500 px-4 text-xs font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                  title={!worldQuickPlaySupported ? t('places.world.legacyHelp') : undefined}
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Box size={15} />}
                  {worldQuickPlaySupported ? t('places.play') : t('places.openInstance')}
                </button>
              </article>
            ))}

            {visibleServers.map((server) => {
              const ping = serverPings[server.index]
              const status = ping?.status
              const online = ping?.online === true
              const icon = status?.faviconDataUrl || server.iconDataUrl
              return (
                <article key={`server:${server.index}:${server.canonicalKey || server.address}`} className="flex flex-col gap-3 bg-slate-950/20 p-4 transition-colors hover:bg-blue-500/[0.04] lg:flex-row lg:items-center" role="listitem">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-blue-300">
                      {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : <Server size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h4 className="max-w-full truncate text-sm font-black text-slate-100" title={server.name}>{server.name}</h4>
                        {pingLoading && !ping ? (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500"><Loader2 size={11} className="animate-spin" />{t('places.checking')}</span>
                        ) : online ? (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300"><CheckCircle2 size={11} />{t('places.online')}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-red-300"><WifiOff size={11} />{t('places.offline')}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                        <span className="font-mono text-slate-400">{server.address}</span>
                        {online && status?.players && (
                          <span className="flex items-center gap-1 text-emerald-300"><Users size={12} />{status.players.online}/{status.players.max}</span>
                        )}
                        {online && <span className="font-mono tabular-nums text-slate-400">{Math.round(status?.latencyMs || 0)} ms</span>}
                        {status?.version?.name && <span className="max-w-full truncate">{status.version.name}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex-[1.25] text-center font-mono text-xs font-semibold leading-5 text-slate-300 lg:px-4">
                    {online ? (
                      <MinecraftServerMotd
                        motd={status?.motd}
                        fallback={t('places.motd.empty')}
                        className="whitespace-pre-line break-words text-slate-300"
                      />
                    ) : (
                      <p className="text-red-300/85">{ping?.errorMessage || t('places.cannotConnect')}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy || mutationBusy || !server.canonicalKey}
                      onClick={() => removeServer(server)}
                      aria-label={tf('places.remove.label', { name: server.name })}
                      title={!server.canonicalKey ? t('places.remove.invalid') : undefined}
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-500 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={busy || !server.canonicalKey}
                      onClick={() => void onPlay({ type: 'server', address: server.address }, server.name)}
                      className="flex h-10 min-w-24 items-center justify-center gap-2 rounded-md bg-blue-500 px-4 text-xs font-black text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Server size={15} />}
                      {t('places.play')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {showAddServer && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mutationBusy) setShowAddServer(false)
          }}
        >
          <form
            onSubmit={submitServer}
            className="w-full max-w-md rounded-xl border border-slate-700 bg-[#0d1526] p-5 shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-instance-server-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="add-instance-server-title" className="text-lg font-black text-white">{t('places.add.title')}</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">{t('places.add.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddServer(false)}
                disabled={mutationBusy}
                aria-label={t('places.add.close')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
              >
                <X size={17} />
              </button>
            </div>
            <label className="mt-5 block text-xs font-black text-slate-300">
              {t('places.add.name')}
              <input
                autoFocus
                required
                maxLength={128}
                value={serverName}
                onChange={(event) => setServerName(event.target.value)}
                placeholder={t('places.add.namePlaceholder')}
                className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950/55 px-3 text-sm font-semibold text-white outline-none transition-colors focus:border-blue-400/60"
              />
            </label>
            <label className="mt-4 block text-xs font-black text-slate-300">
              {t('places.add.address')}
              <input
                required
                maxLength={512}
                value={serverAddress}
                onChange={(event) => setServerAddress(event.target.value)}
                placeholder="play.example.com"
                spellCheck={false}
                autoCapitalize="none"
                className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950/55 px-3 font-mono text-sm font-semibold text-white outline-none transition-colors focus:border-blue-400/60"
              />
            </label>
            {formError && (
              <p className="mt-4 rounded-lg border border-red-400/20 bg-red-500/[0.07] px-3 py-2 text-xs font-semibold text-red-200" role="alert">{formError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddServer(false)}
                disabled={mutationBusy}
                className="h-10 rounded-md border border-slate-700 px-4 text-xs font-black text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                {t('instance.cancel')}
              </button>
              <button
                type="submit"
                disabled={mutationBusy || !serverName.trim() || !serverAddress.trim()}
                className="flex h-10 items-center gap-2 rounded-md bg-blue-500 px-4 text-xs font-black text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutationBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {t('places.add.confirm')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default WorldsServersPanel
