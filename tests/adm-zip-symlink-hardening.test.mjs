// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

test('pins dependency releases which include the YAML and ZIP extraction fixes', () => {
  assert.equal(packageJson.overrides['js-yaml'], '^4.3.2')
  assert.equal(packageJson.dependencies['adm-zip'], '^0.6.1')
  assert.equal(packageJson.overrides['adm-zip'], '^0.6.1')
  assert.equal(packageLock.packages['node_modules/adm-zip'].version, '0.6.1')
})

test('adm-zip extraction refuses a pre-existing linked directory below its target', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-adm-zip-'))
  const target = path.join(root, 'target')
  const outside = path.join(root, 'outside')
  await mkdir(target)
  await mkdir(outside)

  try {
    try {
      await symlink(outside, path.join(target, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOSYS') {
        context.skip('Creating a directory link is not permitted on this host.')
        return
      }
      throw error
    }

    const archive = new AdmZip()
    archive.addFile('linked/payload.txt', Buffer.from('must-not-escape', 'utf8'))
    assert.throws(
      () => archive.extractAllTo(target, true),
      /(?:symbolic link|file in the way)/i
    )
    await assert.rejects(readFile(path.join(outside, 'payload.txt')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adm-zip extraction still writes ordinary nested files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-adm-zip-normal-'))
  try {
    const archive = new AdmZip()
    archive.addFile('nested/payload.txt', Buffer.from('verified', 'utf8'))
    archive.extractAllTo(root, true)
    assert.equal(await readFile(path.join(root, 'nested', 'payload.txt'), 'utf8'), 'verified')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
