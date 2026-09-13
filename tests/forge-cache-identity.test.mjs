// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
const require = createRequire(import.meta.url)
const Handler = require('minecraft-launcher-core/components/handler.js')
const AdmZip = require('adm-zip')

test('Forge cache is tied to verified installer content, not only the Minecraft version or filename', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-forge-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const installer = path.join(root, 'installer.jar')
  const cachedPath = path.join(root, 'forge', '1.20.1', 'version.json')
  await mkdir(path.dirname(cachedPath), { recursive: true })
  const createInstaller = async forgeVersion => {
    const zip = new AdmZip()
    zip.addFile('version.json', Buffer.from(JSON.stringify({ id: 'forge-' + forgeVersion, inheritsFrom: '1.20.1',
      libraries: [{ name: 'net.minecraftforge:forge:1.20.1-' + forgeVersion, downloads: { artifact: {
        path: 'forge.jar', url: 'https://example.invalid/forge.jar'
      } } }], mainClass: 'forge.Main' })))
    zip.addFile('install_profile.json', Buffer.from('{"libraries":[]}'))
    await writeFile(installer, zip.toBuffer())
  }
  const makeHandler = () => {
    const client = { options: { root, forge: installer, mcPath: 'minecraft.jar', overrides: {
      fw: { version: '1.6.0', baseUrl: 'https://example.invalid/', sh1: '0'.repeat(40), size: 1 },
      url: { mavenForge: 'https://example.invalid/' }
    } }, emit() {} }
    const handler = new Handler(client)
    handler.version = { id: '1.20.1' }
    return handler
  }
  await createInstaller('47.4.10')
  await writeFile(cachedPath, JSON.stringify({ id: 'stale-unverified-cache', forgeWrapperVersion: '1.6.0' }))
  const first = await makeHandler().getForgedWrapped()
  assert.equal(first.id, 'forge-47.4.10')
  assert.equal(first.namlauncherInstallerSha256, crypto.createHash('sha256').update(await readFile(installer)).digest('hex'))
  const again = await makeHandler().getForgedWrapped()
  assert.equal(again.id, first.id)
  await createInstaller('47.4.23')
  const upgraded = await makeHandler().getForgedWrapped()
  assert.equal(upgraded.id, 'forge-47.4.23')
  assert.notEqual(upgraded.namlauncherInstallerSha256, first.namlauncherInstallerSha256)
  assert.equal(JSON.parse(await readFile(cachedPath, 'utf8')).id, upgraded.id)
})
