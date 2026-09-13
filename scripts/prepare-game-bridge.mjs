// Author/creator: nattapat2871 (https://nattapat2871.me)

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const BUNDLE_ROOT = path.join(PROJECT_ROOT, 'build', 'game-bridge')
const MANIFEST_NAME = 'game-bridge-manifest.json'
const AUTHOR = 'nattapat2871 (https://nattapat2871.me)'
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MOD_ICON_ENTRY = 'assets/namlauncher/textures/font/badge.png'
const MANAGED_FILE = /^(?:game-bridge-manifest\.json|namlauncher-(?:branding-bridge|game-companion)-[A-Za-z0-9.+-]+\.jar)$/

const packageJson = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))

const digest = async (filePath) => createHash('sha256').update(await readFile(filePath)).digest('hex')

const assertPlainDirectory = async (directory, label) => {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a file or symbolic link.`)
  }
  return realpath(directory)
}

const verifyJarIdentity = (jarPath, artifact) => {
  const archive = new AdmZip(jarPath)
  const icon = archive.getEntry(MOD_ICON_ENTRY)
  const protectedIcon = archive.getEntry('namlauncher-internal/badge.png')
  if (!icon || icon.isDirectory || !protectedIcon || protectedIcon.isDirectory) {
    throw new Error(`${artifact.filename} is missing the protected NamLauncher icon resources.`)
  }

  if (artifact.loader === 'fabric') {
    const metadataEntry = archive.getEntry('fabric.mod.json')
    const metadata = metadataEntry && !metadataEntry.isDirectory
      ? JSON.parse(archive.readAsText(metadataEntry, 'utf8'))
      : null
    if (!['namlauncher-game-companion', 'namlauncher-branding-bridge'].includes(metadata?.id)) {
      throw new Error(`${artifact.filename} has an unexpected Fabric mod identity.`)
    }
    return
  }

  const metadataName = artifact.loader === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml'
  const metadataEntry = archive.getEntry(metadataName)
  const metadata = metadataEntry && !metadataEntry.isDirectory
    ? archive.readAsText(metadataEntry, 'utf8')
    : ''
  if (!/modId\s*=\s*["']namlauncher_game_companion["']/.test(metadata)) {
    throw new Error(`${artifact.filename} has an unexpected ${artifact.loader} mod identity.`)
  }
}

const verifyBundle = async () => {
  const bundleReal = await assertPlainDirectory(BUNDLE_ROOT, 'Bundled companion directory')
  const manifestPath = path.join(bundleReal, MANIFEST_NAME)
  const manifestInfo = await lstat(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
    throw new Error('Game companion manifest must be a regular file.')
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 2 || manifest.launcherVersion !== packageJson.version || manifest.author !== AUTHOR) {
    throw new Error('Game companion manifest does not match this launcher source version and author.')
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Game companion manifest contains no artifacts.')
  }

  const expectedNames = new Set([MANIFEST_NAME])
  for (const artifact of manifest.artifacts) {
    if (!artifact || artifact.author !== AUTHOR || artifact.launcherVersion !== packageJson.version
      || !MANAGED_FILE.test(artifact.filename) || expectedNames.has(artifact.filename)
      || !['fabric', 'forge', 'neoforge'].includes(artifact.loader)
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`Invalid game companion manifest entry: ${artifact?.filename || 'unknown'}`)
    }
    expectedNames.add(artifact.filename)

    const artifactPath = path.join(bundleReal, artifact.filename)
    const artifactInfo = await stat(artifactPath)
    if (!artifactInfo.isFile() || artifactInfo.size !== artifact.size || await digest(artifactPath) !== artifact.sha256) {
      throw new Error(`Game companion integrity verification failed: ${artifact.filename}`)
    }
    verifyJarIdentity(artifactPath, artifact)
  }

  const actualNames = (await readdir(bundleReal)).filter((name) => MANAGED_FILE.test(name)).sort()
  const declaredNames = [...expectedNames].sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(declaredNames)) {
    throw new Error('Bundled game companion files do not exactly match the signed manifest inventory.')
  }

  console.log(`Verified ${manifest.artifacts.length} bundled game companion artifacts for NamLauncher ${packageJson.version}.`)
}

const exportFromPrivateSource = async (sourceValue) => {
  const sourceRoot = await realpath(path.resolve(sourceValue))
  if (sourceRoot === await realpath(PROJECT_ROOT)) {
    throw new Error('NAMLAUNCHER_COMPANIONS_SOURCE must point to the separate companion repository.')
  }
  const exportScript = path.join(sourceRoot, 'scripts', 'export-launcher-bundle.mjs')
  const exportInfo = await lstat(exportScript)
  if (!exportInfo.isFile() || exportInfo.isSymbolicLink()) {
    throw new Error('Companion export script is missing or unsafe.')
  }

  const forwarded = ['--destination', BUNDLE_ROOT]
  for (const flag of ['--skip-build', '--incremental', '--low-memory', '--clean-after-stage']) {
    if (process.argv.includes(flag)) forwarded.push(flag)
  }
  const result = spawnSync(process.execPath, [exportScript, ...forwarded], {
    cwd: sourceRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Companion export failed with exit code ${result.status}.`)
}

const sourceRoot = String(process.env.NAMLAUNCHER_COMPANIONS_SOURCE || '').trim()
if (sourceRoot) await exportFromPrivateSource(sourceRoot)
await verifyBundle()
