// Author/creator: nattapat2871 (https://nattapat2871.me)
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { spawn } from 'child_process'
import axios from 'axios'
import * as tar from 'tar'
import log from 'electron-log'
import { assertPathWithinRoot } from './pathSafety'
import { getFallbackJavaMajorVersion } from '../shared/minecraftJavaVersion.ts'

const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json'
const HTTP_HEADERS = {
  'User-Agent': 'NamLauncher/1.0'
}
const javaInstallLocks = new Map<number, Promise<string>>()
const JAVA_EXTRACT_TIMEOUT_MS = 180000
const JAVA_EXTRACT_IDLE_TIMEOUT_MS = 30000
const MAX_JAVA_RUNTIME_ARCHIVE_BYTES = 512 * 1024 * 1024

type JavaProgressPhase = 'download' | 'extract' | 'finalize' | 'cleanup' | 'ready'
type JavaProgress = (progress: number, detail?: string, phase?: JavaProgressPhase) => void

const LAUNCH_CANCELLED_MESSAGE = 'Launch cancelled by user.'

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error(LAUNCH_CANCELLED_MESSAGE)
}

type MojangVersionManifest = {
  versions: Array<{
    id: string
    url: string
  }>
}

type MojangVersionJson = {
  javaVersion?: {
    majorVersion?: number
  }
}

const getCompactRuntimeError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  let safeUrl = ''
  try {
    const parsed = new URL(String(error.config?.url || ''))
    safeUrl = parsed.protocol === 'https:' ? `${parsed.origin}${parsed.pathname}` : ''
  } catch {
    safeUrl = ''
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code || null,
    status: error.response?.status || null,
    method: String(error.config?.method || 'GET').toUpperCase(),
    url: safeUrl || null
  }
}

const getRuntimeFailureDetail = (error: unknown) => {
  const compact = getCompactRuntimeError(error)
  const status = compact.status ? `HTTP ${compact.status}` : compact.code || compact.name
  return `${status}: ${compact.message}`
}

export const getRequiredJavaMajorVersion = async (mcVersion: string, signal?: AbortSignal): Promise<number> => {
  try {
    throwIfAborted(signal)
    const manifestResponse = await axios.get<MojangVersionManifest>(VERSION_MANIFEST_URL, {
      headers: HTTP_HEADERS,
      signal
    })
    const versionRef = manifestResponse.data.versions.find((version) => version.id === mcVersion)

    if (!versionRef) {
      log.warn(`Could not find ${mcVersion} in Mojang manifest. Using fallback Java mapping.`)
      return getFallbackJavaMajorVersion(mcVersion)
    }

    throwIfAborted(signal)
    const versionResponse = await axios.get<MojangVersionJson>(versionRef.url, {
      headers: HTTP_HEADERS,
      signal
    })
    const required = versionResponse.data.javaVersion?.majorVersion

    if (required) return required
  } catch (err) {
    if (signal?.aborted) throw new Error(LAUNCH_CANCELLED_MESSAGE)
    log.warn(`Failed to resolve Java version from Mojang metadata for ${mcVersion}.`, getCompactRuntimeError(err))
  }

  return getFallbackJavaMajorVersion(mcVersion)
}

const getPlatform = () => {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : 'x32'
  return { os, arch }
}

const getJavaAssetMetadataUrl = (javaVersion: number, imageType: 'jre' | 'jdk', releaseType: 'ga' | 'ea') => {
  const { os, arch } = getPlatform()
  const params = new URLSearchParams({
    architecture: arch,
    image_type: imageType,
    os,
    vendor: 'eclipse',
    heap_size: 'normal',
    release_type: releaseType
  })
  return `https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?${params}`
}

type AdoptiumAsset = {
  binary?: {
    package?: {
      checksum?: string
      link?: string
      size?: number
    }
  }
}

const getJavaDownloadCandidate = async (
  javaVersion: number,
  imageType: 'jre' | 'jdk',
  releaseType: 'ga' | 'ea',
  signal?: AbortSignal
) => {
  const metadataUrl = getJavaAssetMetadataUrl(javaVersion, imageType, releaseType)
  const response = await axios.get<AdoptiumAsset[]>(metadataUrl, {
    headers: HTTP_HEADERS,
    timeout: 30000,
    signal,
    maxContentLength: 4 * 1024 * 1024
  })
  const packageMetadata = response.data?.[0]?.binary?.package
  const checksum = String(packageMetadata?.checksum || '').trim().toLowerCase()
  const downloadUrl = String(packageMetadata?.link || '').trim()
  const size = Number(packageMetadata?.size || 0)
  const parsed = new URL(downloadUrl)
  if (
    !/^[a-f0-9]{64}$/.test(checksum)
    || parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== 'github.com'
    || !Number.isSafeInteger(size)
    || size <= 0
    || size > MAX_JAVA_RUNTIME_ARCHIVE_BYTES
  ) throw new Error(`Adoptium returned incomplete Java ${javaVersion} package metadata.`)
  return { downloadUrl: parsed.href, checksum, size, metadataUrl }
}

export const getMinecraftLaunchJavaPath = (javaPath: string) => {
  if (process.platform !== 'win32') return javaPath

  const executableName = path.basename(javaPath).toLowerCase()
  if (executableName === 'javaw.exe') return javaPath
  if (executableName !== 'java.exe') return javaPath

  const javawPath = path.join(path.dirname(javaPath), 'javaw.exe')
  return fs.existsSync(javawPath) ? javawPath : javaPath
}

const findJavaExecutable = (directory: string): string | null => {
  if (!fs.existsSync(directory)) return null

  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findJavaExecutable(fullPath)
      if (nested) return nested
      continue
    }

    if (entry.name === 'java.exe' || (process.platform !== 'win32' && entry.name === 'java')) {
      return fullPath
    }
  }

  return null
}

const writeCachedJavaPath = (javaDir: string, javaPath: string) => {
  fs.writeFileSync(path.join(javaDir, '.namlauncher-java-path'), javaPath, 'utf8')
}

const getRuntimeMarkerPath = (runtimeRoot: string, javaVersion: number) => {
  return path.join(runtimeRoot, `java-${javaVersion}.path`)
}

const readRuntimeMarkerPath = (runtimeRoot: string, javaVersion: number): string | null => {
  const markerPath = getRuntimeMarkerPath(runtimeRoot, javaVersion)
  if (!fs.existsSync(markerPath)) return null

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>
    const cachedPath = typeof marker.path === 'string' ? marker.path : ''
    const expectedSha256 = typeof marker.sha256 === 'string' ? marker.sha256 : ''
    if (marker.schemaVersion !== 2 || marker.javaVersion !== javaVersion || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      return null
    }
    assertPathWithinRoot(runtimeRoot, cachedPath)
    const info = fs.lstatSync(cachedPath)
    if (!info.isFile() || info.isSymbolicLink()) return null
    const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(cachedPath)).digest('hex')
    return actualSha256 === expectedSha256 ? cachedPath : null
  } catch {
    return null
  }
}

const writeRuntimeMarkerPath = (runtimeRoot: string, javaVersion: number, javaPath: string) => {
  assertPathWithinRoot(runtimeRoot, javaPath)
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(javaPath)).digest('hex')
  fs.writeFileSync(getRuntimeMarkerPath(runtimeRoot, javaVersion), JSON.stringify({
    schemaVersion: 2,
    javaVersion,
    path: javaPath,
    sha256,
    author: 'nattapat2871 (https://nattapat2871.me)'
  }, null, 2), { encoding: 'utf8', mode: 0o600 })
}

const removeRuntimeMarkerPath = (runtimeRoot: string, javaVersion: number) => {
  fs.rmSync(getRuntimeMarkerPath(runtimeRoot, javaVersion), { force: true })
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const removePathWithRetry = async (targetPath: string, attempts = 8) => {
  if (!fs.existsSync(targetPath)) return

  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      if (!fs.existsSync(targetPath)) return
    } catch (err) {
      lastError = err
    }

    await delay(180 * (attempt + 1))
  }

  throw lastError instanceof Error ? lastError : new Error(`Could not remove ${targetPath}`)
}

const renamePathWithRetry = async (from: string, to: string, attempts = 8) => {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      lastError = err
      await delay(180 * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Could not rename ${from}`)
}

const runProcessWithTimeout = async (
  command: string,
  args: string[],
  timeoutMs: number,
  idleTimeoutMs: number,
  progressPath?: string
) => {
  let lastOutputAt = Date.now()
  let lastProgressSignature = ''
  let stderr = ''

  const readProgressSignature = () => {
    if (!progressPath || !fs.existsSync(progressPath)) return ''

    try {
      let fileCount = 0
      let totalBytes = 0
      const stack = [progressPath]

      while (stack.length > 0) {
        const current = stack.pop()
        if (!current) continue

        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const fullPath = path.join(current, entry.name)
          if (entry.isDirectory()) {
            stack.push(fullPath)
            continue
          }

          if (entry.isFile()) {
            fileCount += 1
            totalBytes += fs.statSync(fullPath).size
          }
        }
      }

      return `${fileCount}:${totalBytes}`
    } catch {
      return ''
    }
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    const idleCheck = setInterval(() => {
      const currentProgressSignature = readProgressSignature()
      if (currentProgressSignature && currentProgressSignature !== lastProgressSignature) {
        lastProgressSignature = currentProgressSignature
        lastOutputAt = Date.now()
      }

      if (Date.now() - lastOutputAt > idleTimeoutMs) {
        clearTimeout(timeout)
        clearInterval(idleCheck)
        child.kill()
        reject(new Error(`${command} made no progress for ${Math.round(idleTimeoutMs / 1000)}s`))
      }
    }, 3000)

    child.stderr?.on('data', (chunk: Buffer) => {
      lastOutputAt = Date.now()
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      clearInterval(idleCheck)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      clearInterval(idleCheck)
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

const getExtractionProcessId = (directoryName: string, javaVersion: number): number | null => {
  const match = directoryName.match(new RegExp(`^java-${javaVersion}\\.extract-(\\d+)-`))
  if (!match) return null

  const pid = Number(match[1])
  return Number.isFinite(pid) ? pid : null
}

const isProcessActive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === 'EPERM'
  }
}

const removeStaleExtractionDirs = async (runtimeRoot: string, javaVersion: number) => {
  if (!fs.existsSync(runtimeRoot)) return

  const stalePrefix = `java-${javaVersion}.extract-`
  const staleEntries = fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(stalePrefix))

  for (const entry of staleEntries) {
    const stalePath = path.join(runtimeRoot, entry.name)
    const ownerPid = getExtractionProcessId(entry.name, javaVersion)
    if (ownerPid && ownerPid !== process.pid && isProcessActive(ownerPid)) {
      log.warn(`Skipping active Java extraction directory owned by process ${ownerPid}: ${stalePath}`)
      continue
    }

    try {
      await removePathWithRetry(stalePath, 3)
      log.info(`Removed stale Java extraction directory: ${stalePath}`)
    } catch (err) {
      log.warn(`Could not remove stale Java extraction directory: ${stalePath}`, err)
    }
  }
}

const isJavaExecutableUsable = async (javaPath: string) => {
  if (!fs.existsSync(javaPath)) return false

  try {
    if (process.platform !== 'win32') fs.chmodSync(javaPath, 0o755)
    await runProcessWithTimeout(javaPath, ['-version'], 10000, 10000)
    return true
  } catch (err) {
    log.warn(`Java executable is not usable: ${javaPath}`, err)
    return false
  }
}

const removeInvalidJavaDirectory = async (javaDir: string) => {
  if (!fs.existsSync(javaDir)) return
  if (findJavaExecutable(javaDir)) return

  log.warn(`Java directory exists but no executable was found. Resetting: ${javaDir}`)
  await removePathWithRetry(javaDir).catch((err) => {
    log.warn(`Could not remove invalid Java directory: ${javaDir}`, err)
  })
}

const extractRuntimeArchive = async (
  archivePath: string,
  tempDir: string,
  onProgress: JavaProgress
) => {
  if (process.platform !== 'win32') {
    onProgress(92, 'Extracting Java runtime', 'extract')
    await tar.x({ file: archivePath, cwd: tempDir })
    return
  }

  try {
    onProgress(92, 'Extracting Java runtime with Windows archive tool', 'extract')
    await runProcessWithTimeout(
      'tar.exe',
      ['-xf', archivePath, '-C', tempDir],
      JAVA_EXTRACT_TIMEOUT_MS,
      JAVA_EXTRACT_IDLE_TIMEOUT_MS,
      tempDir
    )
    return
  } catch (err) {
    log.warn('Windows tar extraction failed. Trying PowerShell Expand-Archive.', err)
    await removePathWithRetry(tempDir).catch(() => undefined)
    fs.mkdirSync(tempDir, { recursive: true })
  }

  onProgress(94, 'Retrying Java extraction with PowerShell', 'extract')
  await runProcessWithTimeout(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
      archivePath,
      tempDir
    ],
    JAVA_EXTRACT_TIMEOUT_MS,
    JAVA_EXTRACT_IDLE_TIMEOUT_MS,
    tempDir
  )
}

const downloadRuntime = async (
  javaVersion: number,
  archivePath: string,
  onProgress: JavaProgress,
  signal?: AbortSignal
) => {
  const candidateSpecs = [
    { imageType: 'jre', releaseType: 'ga' },
    { imageType: 'jdk', releaseType: 'ga' },
    { imageType: 'jre', releaseType: 'ea' },
    { imageType: 'jdk', releaseType: 'ea' }
  ] as const

  let lastError: unknown = null

  for (const spec of candidateSpecs) {
    try {
      throwIfAborted(signal)
      const candidate = await getJavaDownloadCandidate(
        javaVersion,
        spec.imageType,
        spec.releaseType,
        signal
      )
      log.info(`Downloading checksum-pinned Java ${javaVersion} package from Adoptium metadata: ${candidate.metadataUrl}`)
      onProgress(5, `Downloading Java ${javaVersion}`, 'download')
      const response = await axios({
        method: 'GET',
        url: candidate.downloadUrl,
        responseType: 'stream',
        headers: HTTP_HEADERS,
        timeout: 120000,
        signal,
        maxContentLength: candidate.size,
        maxBodyLength: candidate.size
      })

      const totalLength = Number(response.headers['content-length']) || 0
      if (totalLength > candidate.size) {
        throw new Error(`Java ${javaVersion} runtime archive is larger than its signed metadata.`)
      }

      let downloadedLength = 0
      const digest = crypto.createHash('sha256')
      const writer = fs.createWriteStream(archivePath, { mode: 0o600 })
      const abortDownload = () => {
        response.data.destroy(new Error(LAUNCH_CANCELLED_MESSAGE))
        writer.destroy(new Error(LAUNCH_CANCELLED_MESSAGE))
      }
      signal?.addEventListener('abort', abortDownload, { once: true })

      response.data.on('data', (chunk: Buffer) => {
        if (signal?.aborted) return
        downloadedLength += chunk.length
        digest.update(chunk)
        if (downloadedLength > candidate.size) {
          const error = new Error(`Java ${javaVersion} runtime archive exceeded its declared size.`)
          response.data.destroy(error)
          writer.destroy(error)
          return
        }
        if (totalLength > 0) {
          onProgress(Math.min(Math.round((downloadedLength / totalLength) * 85), 89), `Downloading Java ${javaVersion}`, 'download')
        }
      })

      await new Promise<void>((resolve, reject) => {
        response.data.pipe(writer)
        response.data.on('error', reject)
        writer.on('error', reject)
        writer.on('finish', resolve)
      }).finally(() => {
        signal?.removeEventListener('abort', abortDownload)
      })

      throwIfAborted(signal)
      const actualChecksum = digest.digest('hex')
      if (downloadedLength !== candidate.size || actualChecksum !== candidate.checksum) {
        throw new Error(`Java ${javaVersion} runtime failed Adoptium SHA-256 verification.`)
      }
      return
    } catch (err) {
      if (signal?.aborted) {
        if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true })
        throw new Error(LAUNCH_CANCELLED_MESSAGE)
      }
      lastError = err
      log.warn(
        `Java ${javaVersion} runtime candidate failed integrity verification. Trying next candidate.`,
        getCompactRuntimeError(err)
      )
      if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true })
    }
  }

  throw new Error(
    `Could not download checksum-verified Java ${javaVersion} runtime from Adoptium. ${getRuntimeFailureDetail(lastError)}`
  )
}

/*
  Runtime downloads intentionally use the Adoptium assets metadata endpoint
  above instead of the redirect-only binary endpoint, because the latter does
  not carry the package checksum needed before extraction.
*/

const extractRuntime = async (
  archivePath: string,
  runtimeRoot: string,
  javaVersion: number,
  javaDir: string,
  onProgress: JavaProgress
) => {
  const tempDir = path.join(runtimeRoot, `java-${javaVersion}.extract-${process.pid}-${Date.now()}`)
  await removePathWithRetry(tempDir).catch(() => undefined)
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    await extractRuntimeArchive(archivePath, tempDir, onProgress)

    const tempExecutable = findJavaExecutable(tempDir)
    if (!tempExecutable) {
      throw new Error(`java executable not found after extracting Java ${javaVersion}`)
    }

    onProgress(97, 'Finalizing Java runtime', 'finalize')
    let finalDir = javaDir
    try {
      await removePathWithRetry(javaDir)
    } catch (err) {
      finalDir = path.join(runtimeRoot, `java-${javaVersion}-${Date.now()}`)
      log.warn(`Could not replace existing Java ${javaVersion} directory. Using alternate runtime directory: ${finalDir}`, err)
    }

    await renamePathWithRetry(tempDir, finalDir)
    const executable = findJavaExecutable(finalDir)
    if (!executable) {
      throw new Error(`java executable not found after finalizing Java ${javaVersion}`)
    }
    if (process.platform !== 'win32') fs.chmodSync(executable, 0o755)

    if (!await isJavaExecutableUsable(executable)) {
      throw new Error(`Java ${javaVersion} executable failed validation after extraction.`)
    }

    writeCachedJavaPath(finalDir, executable)
    writeRuntimeMarkerPath(runtimeRoot, javaVersion, executable)
    return executable
  } catch (err) {
    await removePathWithRetry(tempDir).catch(() => undefined)
    throw err
  }
}

const ensureJavaForVersion = async (
  userDataPath: string,
  mcVersion: string,
  javaVersion: number,
  onProgress: JavaProgress,
  signal?: AbortSignal
): Promise<string> => {
  const runtimeRoot = path.join(userDataPath, 'runtime')
  const javaDir = path.join(runtimeRoot, `java-${javaVersion}`)
  const archivePath = path.join(runtimeRoot, `java-${javaVersion}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`)

  fs.mkdirSync(runtimeRoot, { recursive: true })
  throwIfAborted(signal)
  await removeStaleExtractionDirs(runtimeRoot, javaVersion)

  const runtimeMarkerPath = readRuntimeMarkerPath(runtimeRoot, javaVersion)
  if (runtimeMarkerPath && await isJavaExecutableUsable(runtimeMarkerPath)) {
    log.info(`Local Java ${javaVersion} found at: ${runtimeMarkerPath}`)
    return runtimeMarkerPath
  } else if (fs.existsSync(getRuntimeMarkerPath(runtimeRoot, javaVersion))) {
    removeRuntimeMarkerPath(runtimeRoot, javaVersion)
  }

  // Legacy path-only caches have no integrity provenance. Re-download once and
  // replace them with the SHA-256 pinned runtime marker above.

  throwIfAborted(signal)
  await removeInvalidJavaDirectory(javaDir)

  log.info(`Java ${javaVersion} required for Minecraft ${mcVersion} is missing. Downloading runtime.`)
  await downloadRuntime(javaVersion, archivePath, onProgress, signal)

  throwIfAborted(signal)
  log.info(`Java ${javaVersion} download complete. Extracting runtime.`)
  onProgress(90, `Extracting Java ${javaVersion}`, 'extract')
  const extractedExecutable = await extractRuntime(archivePath, runtimeRoot, javaVersion, javaDir, onProgress)
  throwIfAborted(signal)
  if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true })

  log.info(`Java ${javaVersion} ready at: ${extractedExecutable}`)
  onProgress(100, `Java ${javaVersion} ready`, 'ready')
  return extractedExecutable
}

export const ensureJavaExists = async (
  userDataPath: string,
  mcVersion: string,
  onProgress: JavaProgress,
  signal?: AbortSignal
): Promise<string> => {
  const javaVersion = await getRequiredJavaMajorVersion(mcVersion, signal)
  const existingInstall = javaInstallLocks.get(javaVersion)
  if (existingInstall) {
    log.info(`Java ${javaVersion} install already in progress. Waiting for it to finish.`)
    return existingInstall
  }

  const install = ensureJavaForVersion(userDataPath, mcVersion, javaVersion, onProgress, signal)
    .finally(() => {
      javaInstallLocks.delete(javaVersion)
    })

  javaInstallLocks.set(javaVersion, install)
  return install
}
