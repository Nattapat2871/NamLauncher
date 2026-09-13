export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'quilt' | 'neoforge'

export type LoaderVersionOption = {
  id: string
  type: 'stable' | 'unstable'
}

export const MODDED_LOADERS: Exclude<LoaderType, 'vanilla'>[] = [
  'fabric',
  'forge',
  'quilt',
  'neoforge'
]

export const normalizeLoader = (loader?: string): LoaderType => (
  MODDED_LOADERS.includes(loader as Exclude<LoaderType, 'vanilla'>)
    ? loader as Exclude<LoaderType, 'vanilla'>
    : 'vanilla'
)

const loaderVersionComparer = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export const isUnstableLoaderVersion = (version: string) => /(?:alpha|beta|rc|snapshot)/i.test(version)

export const sortLoaderVersions = (versions: string[]): LoaderVersionOption[] => (
  [...new Set(versions.filter(Boolean))]
    .map((id) => ({
      id,
      type: isUnstableLoaderVersion(id) ? 'unstable' as const : 'stable' as const
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'stable' ? -1 : 1
      return loaderVersionComparer.compare(right.id, left.id)
    })
)

export const getNeoForgeVersionPrefix = (minecraftVersion: string) => {
  const normalized = minecraftVersion.trim()
  const legacyMatch = /^1\.(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (legacyMatch) return `${Number(legacyMatch[1])}.${Number(legacyMatch[2] || 0)}.`

  const calendarMatch = /^(\d{2})\.(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (!calendarMatch) return null
  return `${Number(calendarMatch[1])}.${Number(calendarMatch[2])}.${Number(calendarMatch[3] || 0)}.`
}

export const parseNeoForgeMetadata = (metadataXml: string, minecraftVersion: string) => {
  const prefix = getNeoForgeVersionPrefix(minecraftVersion)
  if (!prefix) return []

  const versions = Array.from(metadataXml.matchAll(/<version>([^<]+)<\/version>/g), (match) => match[1].trim())
    .filter((version) => version.startsWith(prefix))
  return sortLoaderVersions(versions)
}
