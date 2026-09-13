// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CONTENT_FILES_CHANGED_ERROR,
  reconcileMatchingContentFileCollision
} from '../electron/contentFileCollision.ts'

const withTempDirectory = async (callback) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-content-collision-'))
  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('removes only the selected duplicate when enabled and disabled files have identical bytes', async () => {
  await withTempDirectory(async (directory) => {
    const sourcePath = path.join(directory, 'example.jar.disable')
    const targetPath = path.join(directory, 'example.jar')
    const contents = Buffer.alloc(256 * 1024, 0x5a)
    await writeFile(sourcePath, contents)
    await writeFile(targetPath, contents)

    assert.equal(await reconcileMatchingContentFileCollision(sourcePath, targetPath), true)
    assert.equal(existsSync(sourcePath), false)
    assert.deepEqual(await readFile(targetPath), contents)
  })
})

test('preserves both files when a same-size enabled or disabled collision has different bytes', async () => {
  await withTempDirectory(async (directory) => {
    const sourcePath = path.join(directory, 'example.jar')
    const targetPath = path.join(directory, 'example.jar.disable')
    await writeFile(sourcePath, Buffer.alloc(128 * 1024, 0x11))
    await writeFile(targetPath, Buffer.alloc(128 * 1024, 0x22))

    assert.equal(await reconcileMatchingContentFileCollision(sourcePath, targetPath), false)
    assert.equal(existsSync(sourcePath), true)
    assert.equal(existsSync(targetPath), true)
  })
})

test('preserves both files when the collision sizes differ', async () => {
  await withTempDirectory(async (directory) => {
    const sourcePath = path.join(directory, 'example.jar')
    const targetPath = path.join(directory, 'example.jar.disable')
    await writeFile(sourcePath, Buffer.from('first'))
    await writeFile(targetPath, Buffer.from('second-file'))

    assert.equal(await reconcileMatchingContentFileCollision(sourcePath, targetPath), false)
    assert.equal(existsSync(sourcePath), true)
    assert.equal(existsSync(targetPath), true)
  })
})

test('rejects a non-regular collision target without removing the source', async () => {
  await withTempDirectory(async (directory) => {
    const sourcePath = path.join(directory, 'example.jar')
    const targetPath = path.join(directory, 'example.jar.disable')
    await writeFile(sourcePath, Buffer.from('safe-content'))
    await mkdir(targetPath)

    await assert.rejects(
      reconcileMatchingContentFileCollision(sourcePath, targetPath),
      new RegExp(CONTENT_FILES_CHANGED_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
    assert.equal(existsSync(sourcePath), true)
    assert.equal(existsSync(targetPath), true)
  })
})
