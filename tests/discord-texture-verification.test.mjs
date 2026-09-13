// Author: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MAX_DISCORD_TEXTURE_FILE_BYTES,
  normalizeMinecraftTextureId,
  verifyMinecraftTextureFile
} from '../electron/minecraft/discordTexture.ts'

const withTextureRoot = async (callback) => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-discord-texture-'))
  try {
    await callback(rootDirectory)
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
}

const getTextureId = (contents) => crypto.createHash('sha256').update(contents).digest('hex')

test('accepts only a regular texture file whose exact contents match the texture id', async () => {
  await withTextureRoot(async (rootDirectory) => {
    const contents = Buffer.from('verified Minecraft skin texture')
    const textureId = getTextureId(contents)
    await writeFile(path.join(rootDirectory, 'skin.png'), contents)

    assert.equal(verifyMinecraftTextureFile({
      rootDirectory,
      fileName: 'skin.png',
      textureId: textureId.toUpperCase()
    }), textureId)
    assert.equal(normalizeMinecraftTextureId(textureId.toUpperCase()), textureId)
  })
})

test('fails closed for an invalid id, hash mismatch, missing file, or unsafe direct filename', async () => {
  await withTextureRoot(async (rootDirectory) => {
    const contents = Buffer.from('selected skin')
    const textureId = getTextureId(contents)
    await writeFile(path.join(rootDirectory, 'skin.png'), contents)

    const rejectedCases = [
      { fileName: 'skin.png', textureId: 'not-a-texture-id' },
      { fileName: 'skin.png', textureId: getTextureId(Buffer.from('different skin')) },
      { fileName: 'missing.png', textureId },
      { fileName: '', textureId },
      { fileName: ' skin.png', textureId },
      { fileName: 'skin.png ', textureId },
      { fileName: '.', textureId },
      { fileName: '..', textureId },
      { fileName: '../skin.png', textureId },
      { fileName: `nested${path.sep}skin.png`, textureId },
      { fileName: '/absolute/skin.png', textureId },
      { fileName: String.raw`C:\absolute\skin.png`, textureId },
      { fileName: 'skin.png:alternate-stream', textureId }
    ]

    for (const options of rejectedCases) {
      assert.equal(verifyMinecraftTextureFile({ rootDirectory, ...options }), null)
    }
  })
})

test('rejects directories and files larger than the bounded Discord artwork limit', async () => {
  await withTextureRoot(async (rootDirectory) => {
    const textureId = 'a'.repeat(64)
    await mkdir(path.join(rootDirectory, 'directory.png'))
    assert.equal(verifyMinecraftTextureFile({
      rootDirectory,
      fileName: 'directory.png',
      textureId
    }), null)

    const oversizedContents = Buffer.alloc(MAX_DISCORD_TEXTURE_FILE_BYTES + 1, 0x61)
    await writeFile(path.join(rootDirectory, 'oversized.png'), oversizedContents)
    assert.equal(verifyMinecraftTextureFile({
      rootDirectory,
      fileName: 'oversized.png',
      textureId: getTextureId(oversizedContents)
    }), null)
  })
})

test('rejects a symbolic-link texture even when its target has the expected hash', async (t) => {
  await withTextureRoot(async (rootDirectory) => {
    const contents = Buffer.from('symlink target skin')
    const textureId = getTextureId(contents)
    await writeFile(path.join(rootDirectory, 'target.png'), contents)

    try {
      await symlink('target.png', path.join(rootDirectory, 'linked.png'), 'file')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('Creating file symlinks is not permitted on this Windows host.')
        return
      }
      throw error
    }

    assert.equal(verifyMinecraftTextureFile({
      rootDirectory,
      fileName: 'linked.png',
      textureId
    }), null)
  })
})

test('filesystem failures never escape the optional Discord texture verifier', () => {
  const missingRoot = path.join(os.tmpdir(), `namlauncher-missing-${crypto.randomUUID()}`)
  assert.doesNotThrow(() => verifyMinecraftTextureFile({
    rootDirectory: missingRoot,
    fileName: 'skin.png',
    textureId: 'b'.repeat(64)
  }))
  assert.equal(verifyMinecraftTextureFile({
    rootDirectory: missingRoot,
    fileName: 'skin.png',
    textureId: 'b'.repeat(64)
  }), null)
})
