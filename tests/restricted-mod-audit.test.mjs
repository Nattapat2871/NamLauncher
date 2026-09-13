// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'

import { scanRestrictedMods } from '../electron/minecraft/restrictedModAudit.ts'

const writeFabricMod = (filePath, metadata) => {
  const archive = new AdmZip()
  archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify(metadata), 'utf8'))
  archive.writeZip(filePath)
}

test('detects an exact metadata id without uploading a local path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-restricted-mod-'))
  try {
    await mkdir(path.join(root, 'mods'))
    writeFabricMod(path.join(root, 'mods', 'renamed.jar'), {
      schemaVersion: 1,
      id: 'meteor-client',
      name: 'Meteor Client',
      version: '0.5.9'
    })
    const result = scanRestrictedMods(root)
    assert.equal(result.scannedFiles, 1)
    assert.deepEqual(result.observations, [{
      detectorId: 'meteor-client',
      category: 'combat-client',
      displayName: 'Meteor Client',
      modVersion: '0.5.9',
      source: 'metadata-id'
    }])
    assert.equal(JSON.stringify(result).includes(root), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uses a conservative filename fallback for missing or disguised metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-restricted-filename-'))
  try {
    await mkdir(path.join(root, 'mods'))
    await writeFile(path.join(root, 'mods', 'baritone-1.10.jar'), 'not-a-zip')
    await writeFile(path.join(root, 'mods', 'anti-meteor-overlay.jar'), 'not-a-zip')
    writeFabricMod(path.join(root, 'mods', 'wurst-client.jar'), {
      schemaVersion: 1,
      id: 'totally-unrelated-id',
      name: 'Disguised client',
      version: '1.0.0'
    })
    const result = scanRestrictedMods(root)
    assert.deepEqual(result.observations.map(({ detectorId, source }) => ({ detectorId, source })), [
      { detectorId: 'baritone', source: 'filename' },
      { detectorId: 'wurst-client', source: 'filename' }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prioritizes known filename signals before the bounded metadata scan limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-restricted-priority-'))
  try {
    await mkdir(path.join(root, 'mods'))
    for (let index = 0; index < 300; index += 1) {
      await writeFile(path.join(root, 'mods', `a-benign-${String(index).padStart(3, '0')}.jar`), 'not-a-zip')
    }
    await writeFile(path.join(root, 'mods', 'meteor-client.jar'), 'not-a-zip')
    const result = scanRestrictedMods(root)
    assert.equal(result.scannedFiles, 300)
    assert.equal(result.truncated, true)
    assert.equal(result.observations.some(({ detectorId }) => detectorId === 'meteor-client'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a symlinked mods directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-restricted-safe-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-restricted-outside-'))
  try {
    await symlink(outside, path.join(root, 'mods'), 'junction')
    assert.throws(() => scanRestrictedMods(root), /not a safe local directory/)
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') t.skip('Symlink creation is unavailable')
    else throw error
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
