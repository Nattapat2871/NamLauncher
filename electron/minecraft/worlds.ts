// Author/creator: nattapat2871 (https://nattapat2871.me)

import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { NBT } from 'prismarine-nbt'
import { readJavaNbtFile } from './nbtFiles.ts'

type NbtTag = { type: string; value: unknown }
type NbtCompoundValue = Record<string, NbtTag | undefined>

export type MinecraftGameMode = 'survival' | 'creative' | 'adventure' | 'spectator' | 'unknown'
export type MinecraftDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard' | 'unknown'

export type MinecraftWorldSummary = Readonly<{
  folderName: string
  displayName: string
  directory: string
  iconPath: string | null
  levelDataPath: string
  recoveredFromBackup: boolean
  lastPlayedAt: number | null
  gameMode: MinecraftGameMode
  difficulty: MinecraftDifficulty
  hardcore: boolean
  allowCommands: boolean
  minecraftVersion: string | null
  dataVersion: number | null
}>

export type MinecraftWorldScanFailure = Readonly<{
  folderName: string
  directory: string
  message: string
}>

export type MinecraftWorldScanResult = Readonly<{
  worlds: readonly MinecraftWorldSummary[]
  failures: readonly MinecraftWorldScanFailure[]
}>

const WORLD_SCAN_CONCURRENCY = 8

const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  worker: (value: Input) => Promise<Output>
) => {
  const output = new Array<Output>(values.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      output[index] = await worker(values[index])
    }
  })
  await Promise.all(runners)
  return output
}

const asCompound = (tag: NbtTag | undefined): NbtCompoundValue | null => (
  tag?.type === 'compound' && typeof tag.value === 'object' && tag.value !== null
    ? tag.value as NbtCompoundValue
    : null
)

const readString = (tag: NbtTag | undefined) => (
  tag?.type === 'string' && typeof tag.value === 'string' ? tag.value : null
)

const readNumber = (tag: NbtTag | undefined) => (
  ['byte', 'short', 'int', 'float', 'double'].includes(tag?.type || '') && typeof tag?.value === 'number'
    ? tag.value
    : null
)

export const nbtLongToSafeNumber = (tag: NbtTag | undefined) => {
  if (tag?.type !== 'long' || !Array.isArray(tag.value) || tag.value.length !== 2) return null
  const [high, low] = tag.value
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null
  const combined = (BigInt.asIntN(32, BigInt(high)) << 32n) | BigInt.asUintN(32, BigInt(low))
  if (combined > BigInt(Number.MAX_SAFE_INTEGER) || combined < BigInt(Number.MIN_SAFE_INTEGER)) return null
  return Number(combined)
}

const GAME_MODES: Record<number, MinecraftGameMode> = {
  0: 'survival',
  1: 'creative',
  2: 'adventure',
  3: 'spectator'
}

const DIFFICULTIES: Record<number, MinecraftDifficulty> = {
  0: 'peaceful',
  1: 'easy',
  2: 'normal',
  3: 'hard'
}

const findWorldIcon = async (worldDirectory: string) => {
  const candidate = path.join(worldDirectory, 'icon.png')
  try {
    const info = await lstat(candidate)
    return info.isFile() && !info.isSymbolicLink() && info.size <= 512 * 1024 ? candidate : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const summarizeWorldNbt = async (
  root: NBT,
  worldDirectory: string,
  levelDataPath: string,
  recoveredFromBackup: boolean
): Promise<MinecraftWorldSummary> => {
  const data = asCompound(root.value.Data as NbtTag | undefined)
  if (!data) throw new Error('World level data does not contain a Data compound.')
  const version = asCompound(data.Version)
  const folderName = path.basename(worldDirectory)
  const gameType = readNumber(data.GameType)
  const difficulty = readNumber(data.Difficulty)
  const dataVersion = readNumber(data.DataVersion)
  const displayName = readString(data.LevelName)?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256)
  const minecraftVersion = readString(version?.Name)?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128)

  return Object.freeze({
    folderName,
    displayName: displayName || folderName,
    directory: worldDirectory,
    iconPath: await findWorldIcon(worldDirectory),
    levelDataPath,
    recoveredFromBackup,
    lastPlayedAt: nbtLongToSafeNumber(data.LastPlayed),
    gameMode: GAME_MODES[gameType ?? -1] ?? 'unknown',
    difficulty: DIFFICULTIES[difficulty ?? -1] ?? 'unknown',
    hardcore: readNumber(data.hardcore) === 1,
    allowCommands: readNumber(data.allowCommands) === 1,
    minecraftVersion: minecraftVersion || null,
    dataVersion: Number.isInteger(dataVersion) ? dataVersion : null
  })
}

export const readMinecraftWorldSummary = async (worldDirectory: string) => {
  const info = await lstat(worldDirectory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('World path must be a regular directory.')
  let primaryError: unknown = null
  for (const [filename, recoveredFromBackup] of [['level.dat', false], ['level.dat_old', true]] as const) {
    const levelDataPath = path.join(worldDirectory, filename)
    try {
      const levelInfo = await lstat(levelDataPath)
      if (!levelInfo.isFile() || levelInfo.isSymbolicLink()) throw new Error(`${filename} must be a regular file.`)
      const parsed = await readJavaNbtFile(levelDataPath, {
        maxCompressedBytes: 16 * 1024 * 1024,
        maxUncompressedBytes: 64 * 1024 * 1024
      })
      return summarizeWorldNbt(parsed.root, worldDirectory, levelDataPath, recoveredFromBackup)
    } catch (error) {
      if (!recoveredFromBackup) primaryError = error
      else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AggregateError(
          primaryError ? [primaryError, error] : [error],
          'Both level.dat and level.dat_old are unreadable.'
        )
      }
    }
  }
  if (primaryError && (primaryError as NodeJS.ErrnoException).code !== 'ENOENT') throw primaryError
  throw new Error('World does not contain level.dat or level.dat_old.')
}

export const scanMinecraftWorlds = async (instanceDirectory: string): Promise<MinecraftWorldScanResult> => {
  const savesDirectory = path.join(instanceDirectory, 'saves')
  let entries
  try {
    entries = await readdir(savesDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ worlds: Object.freeze([]), failures: Object.freeze([]) })
    }
    throw error
  }

  const savesRoot = await realpath(savesDirectory)
  const candidates = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  const settled = await mapWithConcurrency(candidates, WORLD_SCAN_CONCURRENCY, async (entry) => {
    const directory = path.join(savesDirectory, entry.name)
    try {
      const resolved = await realpath(directory)
      const relative = path.relative(savesRoot, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('World resolves outside the saves directory.')
      return { world: await readMinecraftWorldSummary(resolved), failure: null }
    } catch (error) {
      return {
        world: null,
        failure: Object.freeze({
          folderName: entry.name,
          directory,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })

  const worlds = settled.flatMap((result) => result.world ? [result.world] : [])
    .sort((left, right) => (right.lastPlayedAt ?? 0) - (left.lastPlayedAt ?? 0))
  const failures = settled.flatMap((result) => result.failure ? [result.failure] : [])
  return Object.freeze({ worlds: Object.freeze(worlds), failures: Object.freeze(failures) })
}
