// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const stageSource = await readFile(new URL('../scripts/stage-release-artifacts.mjs', import.meta.url), 'utf8')
const aurSource = await readFile(new URL('../scripts/generate-aur-metadata.mjs', import.meta.url), 'utf8')
const fixtureVersion = '9.8.7-integrity-test'

const artifactNames = {
  win: [`NamLauncher-${fixtureVersion}-Installer.exe`],
  linux: [
    `NamLauncher-${fixtureVersion}-Linux-x64.AppImage`,
    `NamLauncher-${fixtureVersion}-Linux-x64.deb`,
    `NamLauncher-${fixtureVersion}-Linux-x64.rpm`,
    `NamLauncher-${fixtureVersion}-Linux-x64.flatpak`,
    `NamLauncher-${fixtureVersion}-Linux-x64.pkg.tar.zst`
  ]
}

const digest = (contents) => createHash('sha256').update(contents).digest('hex')

const runStageScript = (fixtureRoot, target) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/stage-release-artifacts.mjs', target], {
    cwd: fixtureRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.once('error', reject)
  child.once('exit', (code) => resolve({ code, stderr, stdout }))
})

const createStageFixture = async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'namlauncher-release-integrity-'))
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'release'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'website', 'downloads'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'website', 'static', 'assets'), { recursive: true })
  await writeFile(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify({ version: fixtureVersion }),
    'utf8'
  )
  await writeFile(path.join(fixtureRoot, 'scripts', 'stage-release-artifacts.mjs'), stageSource, 'utf8')
  await writeFile(path.join(fixtureRoot, 'scripts', 'generate-aur-metadata.mjs'), aurSource, 'utf8')
  await writeFile(
    path.join(fixtureRoot, 'website', 'static', 'assets', 'namlauncher-icon.png'),
    Buffer.alloc(2048, 0x69)
  )
  return fixtureRoot
}

const expectedChecksum = (fileName, bytes) => `${digest(bytes)}  ${fileName}\n`

test('stages Windows artifacts and checksums immutably', async (context) => {
  const fixtureRoot = await createStageFixture()
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  const fileName = artifactNames.win[0]
  const releaseArtifact = path.join(fixtureRoot, 'release', fileName)
  const downloadArtifact = path.join(fixtureRoot, 'website', 'downloads', fileName)
  const manifestName = `NamLauncher-${fixtureVersion}-Windows-SHA256SUMS.txt`
  const releaseManifest = path.join(fixtureRoot, 'release', manifestName)
  const downloadManifest = path.join(fixtureRoot, 'website', 'downloads', manifestName)
  const firstBytes = Buffer.alloc(4096, 0x57)
  const checksum = expectedChecksum(fileName, firstBytes)
  await writeFile(releaseArtifact, firstBytes)

  const firstRun = await runStageScript(fixtureRoot, 'win')
  assert.equal(firstRun.code, 0, firstRun.stderr)
  assert.deepEqual(await readFile(downloadArtifact), firstBytes)
  assert.equal(await readFile(`${releaseArtifact}.sha256`, 'utf8'), checksum)
  assert.equal(await readFile(`${downloadArtifact}.sha256`, 'utf8'), checksum)
  assert.equal(await readFile(releaseManifest, 'utf8'), checksum)
  assert.equal(await readFile(downloadManifest, 'utf8'), checksum)

  const identicalRun = await runStageScript(fixtureRoot, 'win')
  assert.equal(identicalRun.code, 0, identicalRun.stderr)
  assert.match(identicalRun.stdout, /Already staged immutable/)

  await writeFile(releaseArtifact, Buffer.alloc(4096, 0x58))
  const conflictingRun = await runStageScript(fixtureRoot, 'win')
  assert.notEqual(conflictingRun.code, 0)
  assert.match(conflictingRun.stderr, /Refusing to overwrite a non-identical release checksum/)
  assert.deepEqual(await readFile(downloadArtifact), firstBytes)
  assert.equal(await readFile(`${downloadArtifact}.sha256`, 'utf8'), checksum)
  assert.equal(await readFile(downloadManifest, 'utf8'), checksum)

  const remainingNames = await readdir(path.join(fixtureRoot, 'website', 'downloads'))
  assert.equal(remainingNames.some((name) => name.endsWith('.tmp') || name.endsWith('.stage.lock')), false)
})

test('stages every Linux package with per-file checksums, a manifest, and AUR metadata', async (context) => {
  const fixtureRoot = await createStageFixture()
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  const expectedLines = []
  for (const [index, fileName] of artifactNames.linux.entries()) {
    const bytes = Buffer.alloc(4096 + index, 0x41 + index)
    await writeFile(path.join(fixtureRoot, 'release', fileName), bytes)
    expectedLines.push(expectedChecksum(fileName, bytes).trimEnd())
  }
  const expectedManifest = `${expectedLines.join('\n')}\n`
  const manifestName = `NamLauncher-${fixtureVersion}-Linux-SHA256SUMS.txt`
  const releaseManifest = path.join(fixtureRoot, 'release', manifestName)
  const downloadManifest = path.join(fixtureRoot, 'website', 'downloads', manifestName)

  const firstRun = await runStageScript(fixtureRoot, 'linux')
  assert.equal(firstRun.code, 0, firstRun.stderr)
  assert.equal(await readFile(releaseManifest, 'utf8'), expectedManifest)
  assert.equal(await readFile(downloadManifest, 'utf8'), expectedManifest)

  for (const [index, fileName] of artifactNames.linux.entries()) {
    const bytes = Buffer.alloc(4096 + index, 0x41 + index)
    const releaseArtifact = path.join(fixtureRoot, 'release', fileName)
    const downloadArtifact = path.join(fixtureRoot, 'website', 'downloads', fileName)
    const checksum = expectedChecksum(fileName, bytes)
    assert.deepEqual(await readFile(downloadArtifact), bytes)
    assert.equal(await readFile(`${releaseArtifact}.sha256`, 'utf8'), checksum)
    assert.equal(await readFile(`${downloadArtifact}.sha256`, 'utf8'), checksum)
  }

  const appImageDigest = expectedLines[0].slice(0, 64)
  const pkgbuild = await readFile(path.join(fixtureRoot, 'packaging', 'aur', 'PKGBUILD'), 'utf8')
  assert.match(pkgbuild, new RegExp(appImageDigest))
  assert.match(pkgbuild, /depends=\('fuse3'/)
  assert.doesNotMatch(pkgbuild, /fuse2/)
  const srcinfo = await readFile(path.join(fixtureRoot, 'packaging', 'aur', '.SRCINFO'), 'utf8')
  assert.match(srcinfo, /depends = fuse3/)
  assert.doesNotMatch(srcinfo, /fuse2/)

  await writeFile(downloadManifest, 'tampered manifest\n', 'utf8')
  const conflictingManifestRun = await runStageScript(fixtureRoot, 'linux')
  assert.notEqual(conflictingManifestRun.code, 0)
  assert.match(conflictingManifestRun.stderr, /Refusing to overwrite a non-identical release checksum/)
  assert.equal(await readFile(downloadManifest, 'utf8'), 'tampered manifest\n')
})

test('preflights all Linux outputs before staging any package', async (context) => {
  const fixtureRoot = await createStageFixture()
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  for (const [index, fileName] of artifactNames.linux.slice(0, -1).entries()) {
    await writeFile(path.join(fixtureRoot, 'release', fileName), Buffer.alloc(4096 + index, 0x61 + index))
  }

  const run = await runStageScript(fixtureRoot, 'linux')
  assert.notEqual(run.code, 0)
  assert.match(run.stderr, /Release artifact is missing or invalid/)
  assert.deepEqual(await readdir(path.join(fixtureRoot, 'website', 'downloads')), [])
})
