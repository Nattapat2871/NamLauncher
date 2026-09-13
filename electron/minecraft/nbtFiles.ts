// Author/creator: nattapat2871 (https://nattapat2871.me)

import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import type { NBT } from 'prismarine-nbt'
import * as nbt from 'prismarine-nbt'

export const DEFAULT_MAX_COMPRESSED_NBT_BYTES = 8 * 1024 * 1024
export const DEFAULT_MAX_UNCOMPRESSED_NBT_BYTES = 32 * 1024 * 1024

export type NbtCompression = 'gzip' | 'none'

export type ReadNbtFileOptions = Readonly<{
  maxCompressedBytes?: number
  maxUncompressedBytes?: number
}>

export type ReadNbtFileResult = Readonly<{
  root: NBT
  compression: NbtCompression
  compressedBytes: number
  uncompressedBytes: number
}>

export type AtomicNbtWriteResult = Readonly<{
  backupPath: string | null
  bytesWritten: number
}>

export class MinecraftNbtFileError extends Error {
  readonly code: 'NOT_A_FILE' | 'FILE_TOO_LARGE' | 'DECOMPRESSED_TOO_LARGE' | 'INVALID_NBT' | 'TRAILING_DATA'

  constructor(code: MinecraftNbtFileError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MinecraftNbtFileError'
    this.code = code
  }
}

const isGzip = (buffer: Buffer) => buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b

const gunzipBounded = (buffer: Buffer, maxOutputLength: number) => new Promise<Buffer>((resolve, reject) => {
  gunzip(buffer, { maxOutputLength }, (error, result) => {
    if (error) {
      const code = (error as NodeJS.ErrnoException).code
      reject(new MinecraftNbtFileError(
        code === 'ERR_BUFFER_TOO_LARGE' ? 'DECOMPRESSED_TOO_LARGE' : 'INVALID_NBT',
        code === 'ERR_BUFFER_TOO_LARGE'
          ? `NBT data exceeds the ${maxOutputLength}-byte decompression limit.`
          : 'NBT gzip data is invalid.',
        { cause: error }
      ))
      return
    }
    resolve(result)
  })
})

const gzipBuffer = (buffer: Buffer) => new Promise<Buffer>((resolve, reject) => {
  gzip(buffer, { level: 6 }, (error, result) => {
    if (error) reject(error)
    else resolve(result)
  })
})

const parseJavaNbt = async (buffer: Buffer) => {
  try {
    const result = await nbt.parse(buffer, 'big')
    if (result.metadata.size !== buffer.length) {
      throw new MinecraftNbtFileError('TRAILING_DATA', 'NBT file contains trailing data.')
    }
    if (result.parsed.type !== 'compound') {
      throw new MinecraftNbtFileError('INVALID_NBT', 'NBT root must be a compound tag.')
    }
    return result.parsed
  } catch (error) {
    if (error instanceof MinecraftNbtFileError) throw error
    throw new MinecraftNbtFileError('INVALID_NBT', 'NBT data could not be parsed.', { cause: error })
  }
}

const assertPositiveLimit = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`)
}

export const readJavaNbtFile = async (
  filePath: string,
  options: ReadNbtFileOptions = {}
): Promise<ReadNbtFileResult> => {
  const maxCompressedBytes = options.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_NBT_BYTES
  const maxUncompressedBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_NBT_BYTES
  assertPositiveLimit(maxCompressedBytes, 'maxCompressedBytes')
  assertPositiveLimit(maxUncompressedBytes, 'maxUncompressedBytes')

  const info = await lstat(filePath)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new MinecraftNbtFileError('NOT_A_FILE', 'NBT path must point to a regular file.')
  }
  if (info.size > maxCompressedBytes) {
    throw new MinecraftNbtFileError('FILE_TOO_LARGE', `NBT file exceeds the ${maxCompressedBytes}-byte input limit.`)
  }

  const encoded = await readFile(filePath)
  if (encoded.length > maxCompressedBytes) {
    throw new MinecraftNbtFileError('FILE_TOO_LARGE', `NBT file exceeds the ${maxCompressedBytes}-byte input limit.`)
  }

  const compression: NbtCompression = isGzip(encoded) ? 'gzip' : 'none'
  const decoded = compression === 'gzip' ? await gunzipBounded(encoded, maxUncompressedBytes) : encoded
  if (decoded.length > maxUncompressedBytes) {
    throw new MinecraftNbtFileError('DECOMPRESSED_TOO_LARGE', `NBT data exceeds the ${maxUncompressedBytes}-byte parsing limit.`)
  }

  return Object.freeze({
    root: await parseJavaNbt(decoded),
    compression,
    compressedBytes: encoded.length,
    uncompressedBytes: decoded.length
  })
}

export const encodeJavaNbt = async (root: NBT, compression: NbtCompression = 'gzip') => {
  let uncompressed: Buffer
  try {
    uncompressed = nbt.writeUncompressed(root, 'big')
  } catch (error) {
    throw new MinecraftNbtFileError('INVALID_NBT', 'NBT value could not be encoded.', { cause: error })
  }
  return compression === 'gzip' ? gzipBuffer(uncompressed) : uncompressed
}

const createBackupPath = async (filePath: string) => {
  const parsed = path.parse(filePath)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt}`
    const candidate = path.join(parsed.dir, `${parsed.base}.namlauncher-${timestamp}${suffix}.bak`)
    try {
      await copyFile(filePath, candidate, fsConstants.COPYFILE_EXCL)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Unable to allocate a unique NBT backup filename.')
}

export const writeJavaNbtFileAtomic = async (
  filePath: string,
  root: NBT,
  compression: NbtCompression = 'gzip'
): Promise<AtomicNbtWriteResult> => {
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true })
  const encoded = await encodeJavaNbt(root, compression)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let temporaryCreated = false

  try {
    const temporary = await open(temporaryPath, 'wx', 0o600)
    temporaryCreated = true
    try {
      await temporary.writeFile(encoded)
      await temporary.sync()
    } finally {
      await temporary.close()
    }

    let backupPath: string | null = null
    try {
      const current = await lstat(filePath)
      if (!current.isFile() || current.isSymbolicLink()) {
        throw new MinecraftNbtFileError('NOT_A_FILE', 'Existing NBT path must be a regular file.')
      }
      backupPath = await createBackupPath(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await rename(temporaryPath, filePath)
    temporaryCreated = false
    return Object.freeze({ backupPath, bytesWritten: encoded.length })
  } finally {
    if (temporaryCreated) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
