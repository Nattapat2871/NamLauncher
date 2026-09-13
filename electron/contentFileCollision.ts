// Author/creator: nattapat2871 (https://nattapat2871.me)
import crypto from 'node:crypto'
import fs from 'node:fs'

export const CONTENT_FILES_CHANGED_ERROR = 'Content files changed while their enabled state was being updated. Refresh and try again.'

type ContentFileIdentity = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

const getContentFileIdentity = (filePath: string): ContentFileIdentity => {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile()) throw new Error(CONTENT_FILES_CHANGED_ERROR)
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  }
}

const identitiesMatch = (left: ContentFileIdentity, right: ContentFileIdentity) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mtimeMs === right.mtimeMs
  && left.ctimeMs === right.ctimeMs
)

const hashFile = (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolve(hash.digest('hex')))
})

const readStableIdentity = (filePath: string) => {
  try {
    return getContentFileIdentity(filePath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new Error(CONTENT_FILES_CHANGED_ERROR)
    throw error
  }
}

export const reconcileMatchingContentFileCollision = async (sourcePath: string, targetPath: string) => {
  const sourceBefore = readStableIdentity(sourcePath)
  const targetBefore = readStableIdentity(targetPath)
  if (sourceBefore.size !== targetBefore.size) return false

  const [sourceDigest, targetDigest] = await Promise.all([
    hashFile(sourcePath),
    hashFile(targetPath)
  ])

  const sourceAfter = readStableIdentity(sourcePath)
  const targetAfter = readStableIdentity(targetPath)
  if (!identitiesMatch(sourceBefore, sourceAfter) || !identitiesMatch(targetBefore, targetAfter)) {
    throw new Error(CONTENT_FILES_CHANGED_ERROR)
  }
  if (sourceDigest !== targetDigest) return false

  const sourceBeforeRemoval = readStableIdentity(sourcePath)
  const targetBeforeRemoval = readStableIdentity(targetPath)
  if (!identitiesMatch(sourceAfter, sourceBeforeRemoval) || !identitiesMatch(targetAfter, targetBeforeRemoval)) {
    throw new Error(CONTENT_FILES_CHANGED_ERROR)
  }

  fs.rmSync(sourcePath)
  return true
}
