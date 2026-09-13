// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertPathWithinRoot,
  UnsafeFilesystemPathError
} from '../electron/pathSafety.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')

const withTemporaryDirectory = async (callback) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-path-safety-'))
  try {
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('accepts missing descendants but rejects lexical traversal and sibling prefixes', async () => {
  await withTemporaryDirectory(async (directory) => {
    const root = path.join(directory, 'instances')
    await mkdir(root)

    assert.doesNotThrow(() => assertPathWithinRoot(root, path.join(root, 'My Instance', 'game', 'servers.dat')))
    assert.throws(
      () => assertPathWithinRoot(root, root),
      (error) => error instanceof UnsafeFilesystemPathError
    )
    assert.throws(
      () => assertPathWithinRoot(root, path.join(directory, 'instances-escape', 'servers.dat')),
      (error) => error instanceof UnsafeFilesystemPathError
    )
  })
})

test('rejects a symlink or Windows junction anywhere below the trusted root', async (context) => {
  await withTemporaryDirectory(async (directory) => {
    const root = path.join(directory, 'instances')
    const outside = path.join(directory, 'outside')
    const linkedInstance = path.join(root, 'Linked Instance')
    await Promise.all([mkdir(root), mkdir(outside)])

    try {
      await symlink(outside, linkedInstance, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        context.skip('Creating a Windows junction is not permitted in this environment.')
        return
      }
      throw error
    }

    assert.throws(
      () => assertPathWithinRoot(root, path.join(linkedInstance, 'game', 'servers.dat')),
      (error) => error instanceof UnsafeFilesystemPathError
        && /symbolic link|junction/.test(error.message)
    )
  })
})

test('rejects a symlinked trusted-root directory instead of blessing its outside target', async (context) => {
  await withTemporaryDirectory(async (directory) => {
    const physicalRoot = path.join(directory, 'physical-instances')
    const linkedRoot = path.join(directory, 'instances')
    await mkdir(physicalRoot)

    try {
      await symlink(physicalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        context.skip('Creating a Windows junction is not permitted in this environment.')
        return
      }
      throw error
    }

    assert.throws(
      () => assertPathWithinRoot(linkedRoot, path.join(linkedRoot, 'Instance')),
      (error) => error instanceof UnsafeFilesystemPathError
        && /Allowed directory/.test(error.message)
    )
  })
})

test('instance and Worlds & Servers paths use physical containment checks before access', () => {
  assert.match(mainSource, /import \{ assertPathWithinRoot \} from '\.\/pathSafety'/)
  assert.match(mainSource, /const toSafePaths = [\s\S]*assertInstancePathIsSafe\(instanceRoot\)[\s\S]*assertChildPathIsSafe\(instanceRoot, gameDirectory\)/)
  assert.match(mainSource, /const readInstanceMarker = [\s\S]*assertChildPathIsSafe\(instanceRoot, markerPath\)/)
  assert.match(mainSource, /const provisionPartnerServers = [\s\S]*assertChildPathIsSafe\(instanceRoot, markerPath\)/)
  assert.match(mainSource, /const getInstancePlacesPaths = [\s\S]*assertChildPathIsSafe\(instanceRoot, serversPath\)[\s\S]*assertChildPathIsSafe\(instanceRoot, savesDirectory\)/)
})
