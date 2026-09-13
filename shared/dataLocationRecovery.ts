// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'node:fs'
import path from 'node:path'

const COMMON_WINDOWS_DATA_RELATIVE_PATHS = [
  'NamLauncher-data',
  path.win32.join('NamLauncher', 'NamLauncher-data'),
  path.win32.join('Minecraft', 'NamLauncher-data'),
  path.win32.join('Minecraft', 'NamLauncher', 'NamLauncher-data'),
  path.win32.join('Games', 'NamLauncher-data'),
  path.win32.join('Games', 'NamLauncher', 'NamLauncher-data'),
  path.win32.join('Programs', 'NamLauncher', 'NamLauncher-data')
]

const normalizePathForCompare = (value: string) => {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const isPlainDirectory = (directoryPath: string) => {
  try {
    const stat = fs.lstatSync(directoryPath)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const hasSavedAccounts = (dataPath: string) => {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(dataPath, 'accounts.json'), 'utf8'))
    return Array.isArray(value) && value.length > 0
  } catch {
    return false
  }
}

export const hasLauncherInstances = (dataPath: string) => {
  const instancesPath = path.join(dataPath, 'instances')
  if (!isPlainDirectory(instancesPath)) return false

  try {
    return fs.readdirSync(instancesPath, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return false
      const instancePath = path.join(instancesPath, entry.name)
      if (!isPlainDirectory(instancePath)) return false

      return fs.existsSync(path.join(instancePath, 'namlauncher-instance.json'))
        || isPlainDirectory(path.join(instancePath, 'game'))
    })
  } catch {
    return false
  }
}

export const hasMeaningfulLauncherData = (dataPath: string) => {
  if (!isPlainDirectory(dataPath)) return false
  return hasLauncherInstances(dataPath) || hasSavedAccounts(dataPath)
}

export const listCommonWindowsLauncherDataCandidates = (driveRoots: string[]) => {
  const candidates = new Map<string, string>()

  for (const driveRoot of driveRoots) {
    if (!/^[A-Za-z]:[\\/]$/.test(driveRoot)) continue
    for (const relativePath of COMMON_WINDOWS_DATA_RELATIVE_PATHS) {
      const candidate = path.win32.resolve(driveRoot, relativePath)
      candidates.set(normalizePathForCompare(candidate), candidate)
    }
  }

  return [...candidates.values()]
}

export const selectUniqueLegacyLauncherDataPath = ({
  defaultDataPath,
  candidatePaths,
  excludedPaths = []
}: {
  defaultDataPath: string
  candidatePaths: string[]
  excludedPaths?: string[]
}) => {
  if (hasLauncherInstances(defaultDataPath)) return ''

  const excluded = new Set(
    [defaultDataPath, ...excludedPaths].map((value) => normalizePathForCompare(value))
  )
  const validCandidates = new Map<string, string>()
  for (const candidatePath of candidatePaths) {
    const normalized = normalizePathForCompare(candidatePath)
    if (excluded.has(normalized) || validCandidates.has(normalized)) continue
    if (hasLauncherInstances(candidatePath)) validCandidates.set(normalized, path.resolve(candidatePath))
  }

  return validCandidates.size === 1 ? [...validCandidates.values()][0] : ''
}
