// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'

import {
  isManagedBrandingBridgeFile,
  listManagedBrandingBridgeFiles,
  parseBrandingBridgeManifest,
  provisionBrandingBridge
} from '../electron/minecraft/brandingBridge.ts'

const sourceBundle = path.resolve('build', 'game-bridge')
const modIconEntry = 'assets/namlauncher/textures/font/badge.png'
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const readSourceManifest = async () => parseBrandingBridgeManifest(JSON.parse(await readFile(
  path.join(sourceBundle, 'game-bridge-manifest.json'), 'utf8'
)))

const withFixture = async (callback) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-bridge-'))
  try {
    const bundleRoot = path.join(root, 'bundle')
    await mkdir(bundleRoot, { recursive: true })
    const manifest = await readSourceManifest()
    assert.ok(manifest)
    await copyFile(path.join(sourceBundle, 'game-bridge-manifest.json'), path.join(bundleRoot, 'game-bridge-manifest.json'))
    await Promise.all(manifest.artifacts.map((artifact) => copyFile(
      path.join(sourceBundle, artifact.filename), path.join(bundleRoot, artifact.filename)
    )))
    await callback({ root, bundleRoot, manifest })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const makeInstance = async (root, name) => {
  const instanceRoot = path.join(root, name)
  const gameDirectory = path.join(instanceRoot, 'game')
  await mkdir(gameDirectory, { recursive: true })
  return { instanceRoot, gameDirectory }
}

test('stages a unique, SHA-256 pinned artifact matrix for launcher 1.2.3', async () => {
  const manifest = await readSourceManifest()
  assert.ok(manifest)
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.launcherVersion, '1.2.3')
  assert.equal(manifest.artifacts.length, 10)
  assert.equal(new Set(manifest.artifacts.map((artifact) => `${artifact.loader}:${artifact.minecraftVersion}`)).size, 10)

  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(sourceBundle, artifact.filename))
    assert.equal(bytes.length, artifact.size)
    assert.equal(digest(bytes), artifact.sha256)
    if (['1.20.1', '1.21.1'].includes(artifact.minecraftVersion)) {
      assert.equal(artifact.supportStatus, 'legacy-frozen')
      assert.match(artifact.version, /^1\.1\.16\+/)
    } else {
      assert.equal(artifact.supportStatus, 'maintained')
      assert.match(artifact.version, /^1\.2\.3\+/)
    }
  }
})

test('declares the canonical NamLauncher icon in every managed mod artifact', async () => {
  const manifest = await readSourceManifest()
  const expectedIcon = await readFile(path.resolve('NamLauncher-icon.png'))
  assert.ok(manifest)

  for (const artifact of manifest.artifacts) {
    const archive = new AdmZip(path.join(sourceBundle, artifact.filename))
    const iconEntry = archive.getEntry(modIconEntry)
    assert.ok(iconEntry && !iconEntry.isDirectory, `${artifact.filename} must contain the NamLauncher icon`)
    assert.deepEqual(archive.readFile(iconEntry), expectedIcon, `${artifact.filename} must use the canonical icon bytes`)
    assert.deepEqual(archive.readFile('namlauncher-internal/badge.png'), expectedIcon, `${artifact.filename} must protect its own icon from resource packs`)
    const mixinEntry = archive.getEntries().find(entry => entry.entryName.endsWith('.mixins.json'))
    assert.ok(mixinEntry)
    const mixins = JSON.parse(archive.readAsText(mixinEntry))
    assert.equal(mixins.required, false)
    assert.equal(mixins.injectors.defaultRequire, 0)
    assert.ok(mixins.client.includes('BadgeResourceManagerMixin'))

    if (artifact.loader === 'fabric') {
      const metadata = JSON.parse(archive.readAsText('fabric.mod.json', 'utf8'))
      assert.equal(metadata.icon, modIconEntry, `${artifact.filename} must declare its Fabric icon`)
      continue
    }

    const metadataEntry = artifact.loader === 'forge'
      ? 'META-INF/mods.toml'
      : 'META-INF/neoforge.mods.toml'
    const metadata = archive.readAsText(metadataEntry, 'utf8')
    assert.match(
      metadata,
      /^\s*logoFile\s*=\s*["']assets\/namlauncher\/textures\/font\/badge\.png["']\s*$/m,
      `${artifact.filename} must declare its mod logo`
    )
  }
})

test('ships the player chat badge hook in every maintained companion', async () => {
  const manifest = await readSourceManifest()
  assert.ok(manifest)

  for (const artifact of manifest.artifacts.filter((entry) => entry.supportStatus === 'maintained')) {
    const archive = new AdmZip(path.join(sourceBundle, artifact.filename))
    assert.ok(
      archive.getEntry('com/namlauncher/bridge/badge/PlayerChatBadge.class'),
      `${artifact.filename} is missing the shared chat decorator`
    )
    assert.ok(
      archive.getEntry('com/namlauncher/bridge/mixin/ChatListenerMixin.class'),
      `${artifact.filename} is missing the chat rendering hook`
    )
    const mixinEntry = archive.getEntries().find((entry) => entry.entryName.endsWith('.mixins.json'))
    assert.ok(mixinEntry, `${artifact.filename} is missing its Mixin config`)
    const mixinConfig = JSON.parse(mixinEntry.getData().toString('utf8'))
    assert.ok(mixinConfig.client.includes('ChatListenerMixin'))
  }
})

test('rejects malformed, duplicate, or partly tampered artifact manifests', async () => {
  const manifest = await readSourceManifest()
  assert.ok(manifest)
  assert.equal(parseBrandingBridgeManifest({ ...manifest, launcherVersion: '1.1.5' }), null)
  assert.equal(parseBrandingBridgeManifest({
    ...manifest,
    artifacts: manifest.artifacts.map((artifact, index) => index === 0 ? { ...artifact, sha256: 'g'.repeat(64) } : artifact)
  }), null)
  assert.equal(parseBrandingBridgeManifest({ ...manifest, artifacts: [...manifest.artifacts, manifest.artifacts[0]] }), null)
})

test('selects artifacts by exact loader and Minecraft version and removes them for Vanilla', async () => {
  await withFixture(async ({ root, bundleRoot, manifest }) => {
    for (const [index, target] of [
      { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' },
      { loader: 'forge', minecraftVersion: '1.20.1' },
      { loader: 'neoforge', minecraftVersion: '1.21.11' }
    ].entries()) {
      const { instanceRoot, gameDirectory } = await makeInstance(root, `instance-${index}`)
      const artifact = manifest.artifacts.find((candidate) => candidate.loader === target.loader && candidate.minecraftVersion === target.minecraftVersion)
      assert.ok(artifact)
      const installed = provisionBrandingBridge({ instanceRoot, gameDirectory, target, bundleRoots: [bundleRoot] })
      assert.equal(installed.status, 'installed')
      assert.equal(installed.filename, artifact.filename)
      assert.equal(digest(await readFile(path.join(gameDirectory, 'mods', artifact.filename))), artifact.sha256)
      assert.equal(provisionBrandingBridge({ instanceRoot, gameDirectory, target, bundleRoots: [bundleRoot] }).status, 'current')
      const removed = provisionBrandingBridge({
        instanceRoot,
        gameDirectory,
        target: { loader: 'vanilla', minecraftVersion: target.minecraftVersion },
        bundleRoots: [bundleRoot]
      })
      assert.equal(removed.status, 'removed')
      await assert.rejects(readFile(path.join(gameDirectory, 'mods', artifact.filename)), { code: 'ENOENT' })
    }
  })
})

test('accepts compatible Fabric loaders and rejects old or malformed resolved versions', async () => {
  await withFixture(async ({ root, bundleRoot }) => {
    const current = await makeInstance(root, 'fabric-loader-current')
    const accepted = provisionBrandingBridge({
      ...current,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.5' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(accepted.status, 'installed')

    const old = await makeInstance(root, 'fabric-loader-old')
    const rejectedOld = provisionBrandingBridge({
      ...old,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.2' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(rejectedOld.status, 'unavailable')
    const malformed = await makeInstance(root, 'fabric-loader-malformed')
    assert.equal(provisionBrandingBridge({
      ...malformed,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.5-beta/unsafe' },
      bundleRoots: [bundleRoot]
    }).status, 'unavailable')
  })
})

test('preserves a same-named user file and rejects an artifact whose bytes do not match the manifest', async () => {
  await withFixture(async ({ root, bundleRoot, manifest }) => {
    const { instanceRoot, gameDirectory } = await makeInstance(root, 'instance')
    const artifact = manifest.artifacts.find((candidate) => candidate.loader === 'fabric' && candidate.minecraftVersion === '26.2')
    assert.ok(artifact)
    const collisionPath = path.join(gameDirectory, 'mods', artifact.filename)
    await mkdir(path.dirname(collisionPath), { recursive: true })
    const archive = new AdmZip()
    archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'user-owned-mod' })))
    archive.writeZip(collisionPath)
    const original = await readFile(collisionPath)
    const collision = provisionBrandingBridge({
      instanceRoot,
      gameDirectory,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(collision.status, 'collision')
    assert.deepEqual(await readFile(collisionPath), original)

    await rm(collisionPath)
    await writeFile(path.join(bundleRoot, artifact.filename), Buffer.from('tampered'))
    const unavailable = provisionBrandingBridge({
      instanceRoot,
      gameDirectory,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(unavailable.status, 'unavailable')
  })
})

test('upgrades a launcher-owned legacy bridge without touching user mods', async () => {
  await withFixture(async ({ root, bundleRoot, manifest }) => {
    const { instanceRoot, gameDirectory } = await makeInstance(root, 'instance')
    const modsDirectory = path.join(gameDirectory, 'mods')
    await mkdir(modsDirectory, { recursive: true })
    const previousFilename = 'namlauncher-branding-bridge-1.1.4+26.2.jar'
    const previousPath = path.join(modsDirectory, previousFilename)
    const archive = new AdmZip()
    archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'namlauncher-branding-bridge', version: '1.1.4+26.2' })))
    archive.writeZip(previousPath)
    const previousDigest = digest(await readFile(previousPath))
    await writeFile(path.join(instanceRoot, 'namlauncher-managed-game-bridge.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'namlauncher-branding-bridge',
      version: '1.1.4+26.2',
      filename: previousFilename,
      sha256: previousDigest,
      managedBy: 'NamLauncher',
      author: 'nattapat2871 (https://nattapat2871.me)'
    }))
    const userMod = path.join(modsDirectory, 'player-owned-helper.jar')
    await writeFile(userMod, Buffer.from('player-owned-mod'))

    const upgraded = provisionBrandingBridge({
      instanceRoot,
      gameDirectory,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(upgraded.status, 'installed')
    assert.equal(upgraded.removed, 1)
    await assert.rejects(readFile(previousPath), { code: 'ENOENT' })
    assert.deepEqual(await readFile(userMod), Buffer.from('player-owned-mod'))
    const current = manifest.artifacts.find((artifact) => artifact.loader === 'fabric' && artifact.minecraftVersion === '26.2')
    assert.equal(digest(await readFile(path.join(modsDirectory, current.filename))), current.sha256)
  })
})

test('replaces an orphaned same-ID companion and leaves no duplicate managed JAR', async () => {
  await withFixture(async ({ root, bundleRoot, manifest }) => {
    const { instanceRoot, gameDirectory } = await makeInstance(root, 'orphaned-companion')
    const modsDirectory = path.join(gameDirectory, 'mods')
    await mkdir(modsDirectory, { recursive: true })
    const orphanPath = path.join(modsDirectory, 'namlauncher-branding-bridge-1.1.6+26.2.jar')
    const archive = new AdmZip()
    archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({
      id: 'namlauncher-branding-bridge', version: '1.1.6+26.2'
    })))
    archive.writeZip(orphanPath)

    const result = provisionBrandingBridge({
      instanceRoot,
      gameDirectory,
      target: { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' },
      bundleRoots: [bundleRoot]
    })
    assert.equal(result.status, 'installed')
    assert.equal(result.removed, 1)
    const { readdir } = await import('node:fs/promises')
    const managedJars = (await readdir(modsDirectory)).filter((name) => /^namlauncher-.*\.jar$/.test(name))
    const current = manifest.artifacts.find((artifact) => artifact.loader === 'fabric' && artifact.minecraftVersion === '26.2')
    assert.deepEqual(managedJars, [current.filename])
  })
})

test('managed companion stays hidden, cannot be mutated through content IPC, and is restored before launch', async () => {
  await withFixture(async ({ root, bundleRoot, manifest }) => {
    const { instanceRoot, gameDirectory } = await makeInstance(root, 'managed-content-protection')
    const target = { loader: 'fabric', minecraftVersion: '26.2', fabricLoaderVersion: '0.19.3' }
    const artifact = manifest.artifacts.find((candidate) => candidate.loader === target.loader && candidate.minecraftVersion === target.minecraftVersion)
    assert.ok(artifact)
    assert.equal(provisionBrandingBridge({ instanceRoot, gameDirectory, target, bundleRoots: [bundleRoot] }).status, 'installed')
    const installedPath = path.join(gameDirectory, 'mods', artifact.filename)
    assert.deepEqual(listManagedBrandingBridgeFiles({ instanceRoot, gameDirectory }), [installedPath])
    assert.equal(isManagedBrandingBridgeFile({ instanceRoot, gameDirectory, filePath: installedPath }), true)

    const disabledPath = `${installedPath}.disable`
    const { rename } = await import('node:fs/promises')
    await rename(installedPath, disabledPath)
    assert.deepEqual(listManagedBrandingBridgeFiles({ instanceRoot, gameDirectory }), [disabledPath])

    await rm(disabledPath)
    assert.equal(listManagedBrandingBridgeFiles({ instanceRoot, gameDirectory }).length, 0)
    assert.equal(provisionBrandingBridge({ instanceRoot, gameDirectory, target, bundleRoots: [bundleRoot] }).status, 'installed')
    assert.equal(digest(await readFile(installedPath)), artifact.sha256)
  })

  const mainSource = await readFile(path.resolve('electron', 'main.ts'), 'utf8')
  assert.match(mainSource, /getInstanceContent[\s\S]*listManagedBrandingBridgeFiles[\s\S]*managedFiles\.has\(path\.resolve\(filePath\)\)/)
  assert.match(mainSource, /assertContentFileIsNotLauncherManaged[\s\S]*toggleInstanceContent[\s\S]*assertContentFileIsNotLauncherManaged/)
  assert.match(mainSource, /deleteInstanceContent[\s\S]*assertContentFileIsNotLauncherManaged/)
  assert.match(mainSource, /status === 'unavailable'[\s\S]*throw new Error\('The required NamLauncher game companion/)
  assert.match(mainSource, /status === 'collision'[\s\S]*throw new Error\(`A different file is blocking the required NamLauncher game companion/)
  assert.match(mainSource, /Could not restore the required NamLauncher game companion before launch/)
})

test('packages the whole verified matrix and provisions after loader resolution', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
  assert.ok(packageJson.build.extraResources.some((entry) => (
    entry.from === 'build/game-bridge' && entry.to === 'game-bridge'
      && entry.filter.includes('**/*.jar') && entry.filter.includes('game-bridge-manifest.json')
  )))
  for (const platform of ['win', 'linux', 'mac']) {
    assert.match(packageJson.scripts[`dist:${platform}`], /^npm run prepare:game-bridge && /)
  }
  const mainSource = await readFile(path.resolve('electron', 'main.ts'), 'utf8')
  assert.match(mainSource, /const loader = await prepareLoader[\s\S]*provisionBrandingBridge\(\{[\s\S]*minecraftVersion: instance\.version/)
})
