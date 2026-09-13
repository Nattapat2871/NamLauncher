// Author/creator: nattapat2871 (https://nattapat2871.me)

import fs from 'node:fs'
import path from 'node:path'

export class UnsafeFilesystemPathError extends Error {
  constructor(message = 'Path resolves outside the allowed directory.') {
    super(message)
    this.name = 'UnsafeFilesystemPathError'
  }
}

const comparablePath = (value: string) => {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const isContainedPath = (rootPath: string, targetPath: string, allowRoot: boolean) => {
  const root = comparablePath(rootPath)
  const target = comparablePath(targetPath)
  if (target === root) return allowRoot
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return target.startsWith(rootWithSeparator)
}

const physicalCandidate = (filePath: string) => {
  let existingPath = path.resolve(filePath)
  const missingSegments: string[] = []

  while (true) {
    try {
      fs.lstatSync(existingPath)
      const physicalAncestor = fs.realpathSync(existingPath)
      return path.resolve(physicalAncestor, ...missingSegments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parentPath = path.dirname(existingPath)
      if (parentPath === existingPath) throw error
      missingSegments.unshift(path.basename(existingPath))
      existingPath = parentPath
    }
  }
}

const assertNoSymlinkBelowRoot = (rootPath: string, targetPath: string) => {
  try {
    if (fs.lstatSync(rootPath).isSymbolicLink()) {
      throw new UnsafeFilesystemPathError('Allowed directory must not be a symbolic link or junction.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  if (!relative) return

  let currentPath = path.resolve(rootPath)
  for (const segment of relative.split(path.sep)) {
    currentPath = path.join(currentPath, segment)
    try {
      const info = fs.lstatSync(currentPath)
      if (info.isSymbolicLink()) {
        throw new UnsafeFilesystemPathError('Path must not pass through a symbolic link or junction.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

export const assertPathWithinRoot = (
  rootPath: string,
  targetPath: string,
  options: Readonly<{ allowRoot?: boolean }> = {}
) => {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const allowRoot = options.allowRoot ?? false

  if (!isContainedPath(root, target, allowRoot)) {
    throw new UnsafeFilesystemPathError()
  }

  assertNoSymlinkBelowRoot(root, target)
  const physicalRoot = physicalCandidate(root)
  const physicalTarget = physicalCandidate(target)
  if (!isContainedPath(physicalRoot, physicalTarget, allowRoot)) {
    throw new UnsafeFilesystemPathError('Path resolves outside the allowed directory.')
  }
}
