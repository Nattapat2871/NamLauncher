// Author: nattapat2871 (https://nattapat2871.me)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MAX_DISCORD_TEXTURE_FILE_BYTES = 2 * 1024 * 1024
export const MINECRAFT_TEXTURE_ID_PATTERN = /^[a-f0-9]{64}$/i

export const normalizeMinecraftTextureId = (value?: unknown) => {
  const normalized = String(value || '').trim().toLowerCase()
  return MINECRAFT_TEXTURE_ID_PATTERN.test(normalized) ? normalized : null
}

const normalizeDirectTextureFileName = (value: unknown) => {
  const fileName = typeof value === 'string' ? value : ''
  if (fileName !== fileName.trim()) return null
  if (!fileName || fileName === '.' || fileName === '..') return null
  if (fileName.includes('\0') || /[\\/:]/.test(fileName)) return null
  if (path.basename(fileName) !== fileName) return null
  if (path.posix.isAbsolute(fileName) || path.win32.isAbsolute(fileName)) return null
  return fileName
}

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
}

const hasSameFileIdentity = (left: fs.Stats, right: fs.Stats) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mtimeMs === right.mtimeMs
  && left.ctimeMs === right.ctimeMs
)

/**
 * Returns a texture ID only when the direct child is a stable, regular file
 * whose bounded contents exactly match that immutable Mojang texture hash.
 * Every filesystem failure is intentionally reduced to null: Discord artwork
 * is optional and must never abort a Minecraft launch.
 */
export const verifyMinecraftTextureFile = (options: {
  rootDirectory: string
  fileName: unknown
  textureId: unknown
}) => {
  const expectedTextureId = normalizeMinecraftTextureId(options.textureId)
  const fileName = normalizeDirectTextureFileName(options.fileName)
  if (!expectedTextureId || !fileName) return null

  let fileDescriptor: number | null = null
  try {
    const rootPath = path.resolve(options.rootDirectory)
    const rootStats = fs.statSync(rootPath)
    if (!rootStats.isDirectory()) return null

    const realRootPath = fs.realpathSync.native(rootPath)
    const candidatePath = path.resolve(rootPath, fileName)
    if (!isPathInsideRoot(rootPath, candidatePath)) return null

    const beforeOpenStats = fs.lstatSync(candidatePath)
    if (beforeOpenStats.isSymbolicLink() || !beforeOpenStats.isFile()) return null
    if (
      !Number.isSafeInteger(beforeOpenStats.size)
      || beforeOpenStats.size <= 0
      || beforeOpenStats.size > MAX_DISCORD_TEXTURE_FILE_BYTES
    ) return null

    const realCandidatePath = fs.realpathSync.native(candidatePath)
    if (!isPathInsideRoot(realRootPath, realCandidatePath)) return null

    fileDescriptor = fs.openSync(candidatePath, fs.constants.O_RDONLY)
    const openedStats = fs.fstatSync(fileDescriptor)
    if (!openedStats.isFile() || !hasSameFileIdentity(beforeOpenStats, openedStats)) return null

    // Re-check the directory entry after opening. This catches a final-component
    // symlink or replacement introduced between lstat and open on platforms
    // where O_NOFOLLOW is unavailable (notably Windows).
    const afterOpenStats = fs.lstatSync(candidatePath)
    if (
      afterOpenStats.isSymbolicLink()
      || !afterOpenStats.isFile()
      || !hasSameFileIdentity(openedStats, afterOpenStats)
      || fs.realpathSync.native(candidatePath) !== realCandidatePath
    ) return null

    const contents = Buffer.allocUnsafe(openedStats.size)
    let offset = 0
    while (offset < contents.length) {
      const bytesRead = fs.readSync(fileDescriptor, contents, offset, contents.length - offset, offset)
      if (bytesRead <= 0) return null
      offset += bytesRead
    }

    const extraByte = Buffer.allocUnsafe(1)
    if (fs.readSync(fileDescriptor, extraByte, 0, 1, offset) !== 0) return null

    const afterReadStats = fs.fstatSync(fileDescriptor)
    if (!hasSameFileIdentity(openedStats, afterReadStats)) return null

    const actualTextureId = crypto.createHash('sha256').update(contents).digest('hex')
    return actualTextureId === expectedTextureId ? expectedTextureId : null
  } catch {
    return null
  } finally {
    if (fileDescriptor !== null) {
      try {
        fs.closeSync(fileDescriptor)
      } catch {
        // Optional Discord artwork must never affect the game process.
      }
    }
  }
}
