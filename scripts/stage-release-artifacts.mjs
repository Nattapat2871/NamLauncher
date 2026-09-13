// Author/creator: nattapat2871 (https://nattapat2871.me)
import { constants, createReadStream } from 'node:fs'
import { copyFile, link, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const target = String(process.argv[2] || 'all').toLowerCase()
const artifactNames = {
  win: [`NamLauncher-${version}-Installer.exe`],
  mac: [`NamLauncher-${version}-macOS-universal.dmg`],
  'mac-auto': [`NamLauncher-${version}-macOS-universal.zip`],
  linux: [
    `NamLauncher-${version}-Linux-x64.AppImage`,
    `NamLauncher-${version}-Linux-x64.deb`,
    `NamLauncher-${version}-Linux-x64.rpm`,
    `NamLauncher-${version}-Linux-x64.flatpak`,
    `NamLauncher-${version}-Linux-x64.pkg.tar.zst`
  ]
}
const targetLabels = {
  win: 'Windows',
  mac: 'macOS',
  'mac-auto': 'macOS-AutoUpdate',
  linux: 'Linux'
}

if (target !== 'all' && !artifactNames[target]) {
  throw new Error(`Unknown release target: ${target}`)
}

const selectedTargets = target === 'all' ? ['win', 'mac', 'linux'] : [target]
const releaseDir = path.join(projectRoot, 'release')
const downloadDir = path.join(projectRoot, 'website', 'downloads')
await mkdir(downloadDir, { recursive: true })

const optionalStat = async (filePath) => {
  try {
    return await stat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const sha256 = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const input = createReadStream(filePath)
  input.once('error', reject)
  input.on('data', (chunk) => hash.update(chunk))
  input.once('end', () => resolve(hash.digest('hex')))
})

const temporaryPathFor = (destination) => path.join(
  path.dirname(destination),
  `.${path.basename(destination)}.${process.pid}-${randomUUID()}.tmp`
)

const assertChecksumMatches = async (checksumPath, expectedChecksum) => {
  const checksumStat = await optionalStat(checksumPath)
  if (!checksumStat?.isFile()) {
    throw new Error(`Immutable release checksum is missing or invalid: ${checksumPath}`)
  }
  const actualChecksum = await readFile(checksumPath, 'utf8')
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Refusing to overwrite a non-identical release checksum: ${checksumPath}`)
  }
}

const assertArtifactMatches = async (artifactPath, expectedSize, expectedDigest) => {
  const artifactStat = await optionalStat(artifactPath)
  if (!artifactStat?.isFile() || artifactStat.size !== expectedSize) {
    throw new Error(`Refusing to overwrite a non-identical release artifact: ${artifactPath}`)
  }
  if (await sha256(artifactPath) !== expectedDigest) {
    throw new Error(`Refusing to overwrite a non-identical release artifact: ${artifactPath}`)
  }
}

const publishChecksumAtomically = async (destination, checksum) => {
  const temporaryPath = temporaryPathFor(destination)
  try {
    await writeFile(temporaryPath, checksum, { encoding: 'utf8', flag: 'wx' })
    try {
      await link(temporaryPath, destination)
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await assertChecksumMatches(destination, checksum)
      return false
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

const inspectArtifactSource = async (fileName) => {
  const source = path.join(releaseDir, fileName)
  const sourceStat = await optionalStat(source)
  if (!sourceStat?.isFile() || sourceStat.size < 1024) {
    throw new Error(`Release artifact is missing or invalid: ${source}`)
  }
  return { fileName, source, sourceStat }
}

const stageArtifactAtomically = async ({ fileName, source, sourceStat }) => {
  const destination = path.join(downloadDir, fileName)
  const releaseChecksumDestination = `${source}.sha256`
  const checksumDestination = `${destination}.sha256`
  const lockPath = path.join(downloadDir, `.${fileName}.stage.lock`)
  const preparedArtifactPath = temporaryPathFor(destination)
  let lockHandle

  try {
    try {
      lockHandle = await open(lockPath, 'wx')
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Another release staging operation is already active: ${lockPath}`)
      }
      throw error
    }

    await copyFile(source, preparedArtifactPath, constants.COPYFILE_EXCL)
    const preparedStat = await stat(preparedArtifactPath)
    if (!preparedStat.isFile() || preparedStat.size !== sourceStat.size) {
      throw new Error(`Temporary release artifact is incomplete: ${preparedArtifactPath}`)
    }

    const [sourceDigest, digest] = await Promise.all([
      sha256(source),
      sha256(preparedArtifactPath)
    ])
    if (sourceDigest !== digest) {
      throw new Error(`Release artifact changed while it was being staged: ${source}`)
    }

    const checksum = `${digest}  ${fileName}\n`
    const existingReleaseChecksum = await optionalStat(releaseChecksumDestination)
    if (existingReleaseChecksum) {
      await assertChecksumMatches(releaseChecksumDestination, checksum)
    }

    const existingDestination = await optionalStat(destination)
    if (existingDestination) {
      await assertArtifactMatches(destination, preparedStat.size, digest)
    }

    const existingWebsiteChecksum = await optionalStat(checksumDestination)
    if (existingWebsiteChecksum) {
      await assertChecksumMatches(checksumDestination, checksum)
    }

    // Check every existing publication before writing anything, then publish
    // checksum metadata before making a new artifact visible.
    await publishChecksumAtomically(releaseChecksumDestination, checksum)
    await publishChecksumAtomically(checksumDestination, checksum)

    if (existingDestination) {
      console.log(`Already staged immutable ${fileName} (${preparedStat.size} bytes)`)
      return { digest, fileName, size: preparedStat.size }
    }

    try {
      await link(preparedArtifactPath, destination)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await assertArtifactMatches(destination, preparedStat.size, digest)
    }

    console.log(`Staged immutable ${fileName} (${preparedStat.size} bytes)`)
    console.log(`Staged ${fileName}.sha256`)
    return { digest, fileName, size: preparedStat.size }
  } finally {
    try {
      await rm(preparedArtifactPath, { force: true })
    } finally {
      if (lockHandle) {
        try {
          await lockHandle.close()
        } finally {
          await rm(lockPath, { force: true })
        }
      }
    }
  }
}

const publishTargetManifest = async (platformTarget, stagedArtifacts) => {
  const manifestName = `NamLauncher-${version}-${targetLabels[platformTarget]}-SHA256SUMS.txt`
  const manifest = `${stagedArtifacts.map(({ digest, fileName }) => `${digest}  ${fileName}`).join('\n')}\n`
  const releaseManifest = path.join(releaseDir, manifestName)
  const downloadManifest = path.join(downloadDir, manifestName)

  await publishChecksumAtomically(releaseManifest, manifest)
  await publishChecksumAtomically(downloadManifest, manifest)
  console.log(`Staged immutable ${manifestName}`)
}

// Validate the complete requested build before exposing any of its files. This
// prevents a partially built platform from becoming a partially staged release.
const inspectedArtifacts = new Map()
for (const platformTarget of selectedTargets) {
  const inspected = []
  for (const fileName of artifactNames[platformTarget]) {
    inspected.push(await inspectArtifactSource(fileName))
  }
  inspectedArtifacts.set(platformTarget, inspected)
}

const stagedByTarget = new Map()
for (const platformTarget of selectedTargets) {
  const staged = []
  for (const artifact of inspectedArtifacts.get(platformTarget)) {
    staged.push(await stageArtifactAtomically(artifact))
  }
  stagedByTarget.set(platformTarget, staged)
  await publishTargetManifest(platformTarget, staged)
}

if (selectedTargets.includes('linux')) {
  const appImageSha256 = stagedByTarget.get('linux')[0].digest
  const iconSha256 = await sha256(path.join(projectRoot, 'website', 'static', 'assets', 'namlauncher-icon.png'))
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(projectRoot, 'scripts', 'generate-aur-metadata.mjs'), appImageSha256, iconSha256],
      { cwd: projectRoot, stdio: 'inherit' }
    )
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`AUR metadata generator exited with ${code}`)))
  })
}
