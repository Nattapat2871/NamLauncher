// Author/creator: nattapat2871 (https://nattapat2871.me)

export const LIBRARY_SORTS = ['relevance', 'downloads', 'updated', 'newest'] as const
export const LIBRARY_LOADERS = ['fabric', 'forge', 'quilt', 'neoforge'] as const
export const LIBRARY_ENVIRONMENTS = ['all', 'client', 'server', 'both'] as const
export const LIBRARY_SEARCH_QUERY_MAX_LENGTH = 100
export const LIBRARY_SEARCH_MAX_OFFSET = 10_000
export const LIBRARY_SEARCH_DEFAULT_LIMIT = 10
export const LIBRARY_SEARCH_MAX_LIMIT = 50

export type LibrarySort = typeof LIBRARY_SORTS[number]
export type LibraryLoader = typeof LIBRARY_LOADERS[number]
export type LibraryEnvironment = typeof LIBRARY_ENVIRONMENTS[number]
export type LibraryProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader'
export type LibraryProvider = 'modrinth' | 'curseforge'

export type LibrarySearchFilters = {
  sort: LibrarySort
  gameVersion: string
  loader: '' | LibraryLoader
  environment: LibraryEnvironment
  openSourceOnly: boolean
  compatibleOnly: boolean
}

export type ResolvedLibrarySearchFilters = Omit<LibrarySearchFilters, 'compatibleOnly'>

const VERSION_PATTERN = /^[A-Za-z0-9._+\-]{1,40}$/

// These groups follow Modrinth's documented required, optional, and either-side
// environment meanings. Optional-side projects are supported on both sides.
const MODRINTH_CLIENT_ENVIRONMENTS = [
  'client_and_server',
  'client_only',
  'client_only_server_optional',
  'singleplayer_only',
  'server_only_client_optional',
  'client_or_server',
  'client_or_server_prefers_both'
] as const

const MODRINTH_SERVER_ENVIRONMENTS = [
  'client_and_server',
  'client_only_server_optional',
  'server_only',
  'server_only_client_optional',
  'dedicated_server_only',
  'client_or_server',
  'client_or_server_prefers_both'
] as const

const MODRINTH_BOTH_ENVIRONMENTS = [
  'client_and_server',
  'client_only_server_optional',
  'server_only_client_optional',
  'client_or_server',
  'client_or_server_prefers_both'
] as const

const toFiniteNumber = (value: unknown) => {
  try {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  } catch {
    return null
  }
}

const normalizeNonNegativeInteger = (value: unknown, fallback = 0) => {
  const fallbackNumber = toFiniteNumber(fallback)
  const safeFallback = fallbackNumber === null ? 0 : Math.max(0, Math.trunc(fallbackNumber))
  const number = toFiniteNumber(value)
  return number === null ? safeFallback : Math.max(0, Math.trunc(number))
}

export const normalizeLibrarySearchQuery = (value: unknown) => {
  let normalized = ''
  try {
    normalized = String(value ?? '').trim()
  } catch {
    return ''
  }
  return Array.from(normalized).slice(0, LIBRARY_SEARCH_QUERY_MAX_LENGTH).join('')
}

export const normalizeLibrarySearchOffset = (value: unknown) => (
  Math.min(normalizeNonNegativeInteger(value), LIBRARY_SEARCH_MAX_OFFSET)
)

export const normalizeLibrarySearchLimit = (value: unknown) => {
  const number = toFiniteNumber(value)
  const normalized = number === null || number === 0
    ? LIBRARY_SEARCH_DEFAULT_LIMIT
    : Math.trunc(number)
  return Math.min(LIBRARY_SEARCH_MAX_LIMIT, Math.max(1, normalized))
}

export const normalizeLibraryTotalHits = (value: unknown, fallback = 0) => {
  const normalizedFallback = Math.min(
    normalizeNonNegativeInteger(fallback),
    Number.MAX_SAFE_INTEGER
  )
  const number = toFiniteNumber(value)
  if (number === null) return normalizedFallback
  return Math.min(Math.max(0, Math.trunc(number)), Number.MAX_SAFE_INTEGER)
}

export const DEFAULT_LIBRARY_SEARCH_FILTERS: LibrarySearchFilters = {
  sort: 'downloads',
  gameVersion: '',
  loader: '',
  environment: 'all',
  openSourceOnly: false,
  compatibleOnly: true
}

export const isLibrarySort = (value: unknown): value is LibrarySort => (
  LIBRARY_SORTS.includes(String(value || '').trim().toLowerCase() as LibrarySort)
)

export const isLibraryLoader = (value: unknown): value is LibraryLoader => (
  LIBRARY_LOADERS.includes(String(value || '').trim().toLowerCase() as LibraryLoader)
)

export const isLibraryEnvironment = (value: unknown): value is LibraryEnvironment => (
  LIBRARY_ENVIRONMENTS.includes(String(value || '').trim().toLowerCase() as LibraryEnvironment)
)

export const normalizeLibraryGameVersion = (value: unknown) => {
  const normalized = String(value || '').trim()
  return VERSION_PATTERN.test(normalized) ? normalized : ''
}

export const normalizeLibrarySearchFilters = (value?: Partial<LibrarySearchFilters> | null): LibrarySearchFilters => {
  const rawSort = String(value?.sort || '').trim().toLowerCase()
  const rawLoader = String(value?.loader || '').trim().toLowerCase()
  const rawEnvironment = String(value?.environment || '').trim().toLowerCase()

  return {
    sort: isLibrarySort(rawSort) ? rawSort : DEFAULT_LIBRARY_SEARCH_FILTERS.sort,
    gameVersion: normalizeLibraryGameVersion(value?.gameVersion),
    loader: isLibraryLoader(rawLoader) ? rawLoader : '',
    environment: isLibraryEnvironment(rawEnvironment) ? rawEnvironment : 'all',
    openSourceOnly: value?.openSourceOnly === true,
    compatibleOnly: value?.compatibleOnly !== false
  }
}

export const resolveLibrarySearchFilters = (
  filters: LibrarySearchFilters,
  instance?: { version?: unknown; loader?: unknown } | null
): ResolvedLibrarySearchFilters => {
  const normalized = normalizeLibrarySearchFilters(filters)
  if (!normalized.compatibleOnly || !instance) {
    const { compatibleOnly: _compatibleOnly, ...resolved } = normalized
    return resolved
  }

  const instanceLoader = String(instance.loader || '').trim().toLowerCase()
  return {
    sort: normalized.sort,
    gameVersion: normalizeLibraryGameVersion(instance.version),
    loader: isLibraryLoader(instanceLoader) ? instanceLoader : '',
    environment: normalized.environment,
    openSourceOnly: normalized.openSourceOnly
  }
}

export const isLibraryInstanceCompatibilityAvailable = (
  projectType: LibraryProjectType,
  instance?: { version?: unknown; loader?: unknown } | null
) => {
  if (!instance || projectType === 'modpack') return false
  if (!normalizeLibraryGameVersion(instance.version)) return false
  return projectType !== 'mod' || isLibraryLoader(instance.loader)
}

export const isLibraryLoaderFilterAvailable = (
  provider: LibraryProvider,
  projectType: LibraryProjectType
) => projectType === 'mod' || (provider === 'modrinth' && projectType === 'modpack')

const getEnvironmentFacetValues = (environment: LibraryEnvironment) => {
  if (environment === 'client') return MODRINTH_CLIENT_ENVIRONMENTS
  if (environment === 'server') return MODRINTH_SERVER_ENVIRONMENTS
  if (environment === 'both') return MODRINTH_BOTH_ENVIRONMENTS
  return []
}

export const buildModrinthSearchFacets = (
  projectType: LibraryProjectType,
  filters: ResolvedLibrarySearchFilters
) => {
  const facets: string[][] = [[`project_type:${projectType}`]]
  const gameVersion = normalizeLibraryGameVersion(filters.gameVersion)
  if (gameVersion) facets.push([`versions:${gameVersion}`])

  if ((projectType === 'mod' || projectType === 'modpack') && isLibraryLoader(filters.loader)) {
    facets.push([`categories:${filters.loader}`])
  }

  if (projectType === 'mod' && isLibraryEnvironment(filters.environment)) {
    const values = getEnvironmentFacetValues(filters.environment)
    if (values.length > 0) facets.push(values.map((value) => `environment:${value}`))
  }

  if (filters.openSourceOnly) facets.push(['open_source:true'])
  return facets
}

export const countActiveLibraryFilters = (filters: LibrarySearchFilters) => {
  const normalized = normalizeLibrarySearchFilters(filters)
  return Number(normalized.sort !== 'downloads')
    + Number(normalized.compatibleOnly)
    + Number(!normalized.compatibleOnly && Boolean(normalized.gameVersion))
    + Number(!normalized.compatibleOnly && Boolean(normalized.loader))
    + Number(normalized.environment !== 'all')
    + Number(normalized.openSourceOnly)
}
