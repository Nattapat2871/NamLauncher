// Author/creator: nattapat2871 (https://nattapat2871.me)

export type ModpackClientRequirement = 'required' | 'optional' | 'unsupported'

export type ModpackFileForCompatibility = {
  path: string
  env?: {
    client?: ModpackClientRequirement
    server?: ModpackClientRequirement
  }
  downloads?: string[]
}

export type ModrinthVersionCompatibility = {
  id: string
  game_versions?: string[]
}

export type ModrinthPackFileIdentity = {
  projectId: string
  versionId: string
}

export const getModrinthPackFileIdentity = (
  file: Pick<ModpackFileForCompatibility, 'downloads'>
): ModrinthPackFileIdentity | null => {
  for (const download of file.downloads || []) {
    try {
      const parsed = new URL(download)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.modrinth.com') continue

      const parts = parsed.pathname.split('/').filter(Boolean)
      const dataIndex = parts.indexOf('data')
      const versionsIndex = parts.indexOf('versions')
      const projectId = dataIndex >= 0 ? parts[dataIndex + 1] : ''
      const versionId = versionsIndex >= 0 ? parts[versionsIndex + 1] : ''
      if (projectId && versionId && versionsIndex > dataIndex) {
        return { projectId, versionId }
      }
    } catch {
      // Ignore malformed mirrors and try the next declared download.
    }
  }

  return null
}

export const planModpackClientFiles = <T extends ModpackFileForCompatibility>(
  files: readonly T[],
  minecraftVersion: string,
  versionsById: ReadonlyMap<string, ModrinthVersionCompatibility>
) => {
  const installableFiles: T[] = []
  const skippedIncompatibleFiles: T[] = []
  const skippedUnsupportedFiles: T[] = []

  for (const file of files) {
    const clientRequirement = file.env?.client
    if (clientRequirement === 'unsupported') {
      skippedUnsupportedFiles.push(file)
      continue
    }

    const identity = getModrinthPackFileIdentity(file)
    const declaredVersion = identity ? versionsById.get(identity.versionId) : undefined
    const declaredGameVersions = Array.isArray(declaredVersion?.game_versions)
      ? declaredVersion.game_versions
      : []
    const isKnownIncompatibleOptional = clientRequirement === 'optional'
      && declaredGameVersions.length > 0
      && !declaredGameVersions.includes(minecraftVersion)

    if (isKnownIncompatibleOptional) {
      skippedIncompatibleFiles.push(file)
      continue
    }

    installableFiles.push(file)
  }

  return {
    installableFiles,
    skippedIncompatibleFiles,
    skippedUnsupportedFiles
  }
}
