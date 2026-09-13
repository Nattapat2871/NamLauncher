// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { assertFileSha256 } from '../../shared/launcherUpdateIntegrity.ts'
import {
  normalizeWindowsAutoInstallerStatus,
  type WindowsAutoInstallerExpectation,
  type WindowsAutoInstallerStatus
} from '../../shared/startupUpdate.ts'
import type { WindowsInstallScope } from './windowsInstallScope.ts'

const READY_TIMEOUT_MS = 15_000
const BROKER_TIMEOUT_MS = 15_000
const READY_STABILITY_MS = 175
const STATUS_POLL_INTERVAL_MS = 75
const CANCELLATION_TIMEOUT_MS = 5_000
const MAX_STATUS_BYTES = 4_096
const STALE_HANDOFF_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const HANDOFF_FILE_PATTERN = /^(?:install-startup-update|startup-install-(?:status|cancel))-[0-9a-f-]{36}\.(?:ps1|json)(?:\.[0-9a-f]{64}\.tmp)?$/i

export type WindowsAutoInstallerHandoff = WindowsAutoInstallerExpectation & {
  helperPath: string
  statusPath: string
  cancellationPath: string
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const startIndependentPowerShell = async (options: {
  powershellPath: string
  args: string[]
  nonce: string
}) => {
  // Node's DETACHED_PROCESS flag makes Windows PowerShell exit before running
  // a script on some Windows 11 builds. Start-Process delegates creation to
  // the Windows shell instead, then this short-lived broker returns the exact
  // PID. The updater itself owns no Electron pipe and survives normal exit.
  if (options.args.some((value) => value.includes('"') || /[\r\n\0]/.test(value))) {
    throw new Error('Unsafe automatic installer broker argument.')
  }
  const payload = Buffer.from(JSON.stringify(options), 'utf8').toString('base64')
  const brokerSource = [
    "$ErrorActionPreference = 'Stop'",
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "function Quote-Arg([string]$Value) { return '\"' + $Value.Replace('\"', '\\\"') + '\"' }",
    '$arguments = @($payload.args | ForEach-Object { Quote-Arg ([string]$_) })',
    '$started = Start-Process -FilePath $payload.powershellPath -ArgumentList $arguments -PassThru -WindowStyle Hidden',
    "[Console]::Out.WriteLine(('NAMLAUNCHER-UPDATER-BROKER:' + $payload.nonce + ':' + $started.Id))"
  ].join('\n')
  const encodedBroker = Buffer.from(brokerSource, 'utf16le').toString('base64')

  return new Promise<number>((resolve, reject) => {
    const broker = spawn(options.powershellPath, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedBroker
    ], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PSModulePath: path.join(path.dirname(options.powershellPath), 'Modules') }
    })
    let settled = false
    let output = ''
    let diagnostic = ''
    const finish = (error: Error | null, helperPid?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(helperPid as number)
    }
    const timer = setTimeout(() => {
      try { broker.kill() } catch { /* The broker may already have exited. */ }
      finish(new Error('Automatic installer broker did not return a helper process.'))
    }, BROKER_TIMEOUT_MS)
    broker.stdout?.on('data', (chunk) => { output = (output + String(chunk)).slice(-4_096) })
    broker.stderr?.on('data', (chunk) => { diagnostic = (diagnostic + String(chunk)).slice(-2_000) })
    broker.once('error', (error) => finish(error))
    broker.once('close', (code) => {
      const marker = new RegExp(`(?:^|\\r?\\n)NAMLAUNCHER-UPDATER-BROKER:${options.nonce}:([1-9]\\d*)(?:\\r?\\n|$)`).exec(output)
      const helperPid = marker ? Number(marker[1]) : 0
      if (code !== 0 || !Number.isSafeInteger(helperPid) || helperPid < 1) {
        finish(new Error(`Automatic installer broker failed (${code ?? 'unknown'}): ${diagnostic || 'no verified process id'}`))
        return
      }
      finish(null, helperPid)
    })
  })
}

const assertRegularFile = (filePath: string, label: string) => {
  const info = fs.lstatSync(filePath)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`)
}

const processExists = (processId: number) => {
  try {
    process.kill(processId, 0)
    return true
  } catch {
    return false
  }
}

const removeRegularFileQuietly = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return
    const info = fs.lstatSync(filePath)
    if (info.isFile() && !info.isSymbolicLink()) fs.rmSync(filePath, { force: true })
  } catch {
    // Handoff cleanup is best effort and must never follow a link.
  }
}

const requestHelperCancellation = (cancellationPath: string, expected: Pick<WindowsAutoInstallerExpectation, 'attemptId' | 'nonce'>) => {
  const payload = JSON.stringify({
    schemaVersion: 1,
    attemptId: expected.attemptId,
    nonce: expected.nonce,
    cancelledAt: new Date().toISOString()
  })
  try {
    fs.writeFileSync(cancellationPath, payload, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!fs.existsSync(cancellationPath)) throw error
    const info = fs.lstatSync(cancellationPath)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe automatic installer cancellation path.')
  }
}

const cancelWindowsAutoInstallerHelper = async (options: {
  helperPid: number
  helperPath: string
  statusPath: string
  cancellationPath: string
  expected: Pick<WindowsAutoInstallerExpectation, 'attemptId' | 'nonce'>
}) => {
  requestHelperCancellation(options.cancellationPath, options.expected)
  const deadline = Date.now() + CANCELLATION_TIMEOUT_MS
  while (processExists(options.helperPid) && Date.now() < deadline) await wait(50)

  if (processExists(options.helperPid)) {
    // Do not terminate a numeric PID which Windows could have recycled. The
    // correlated marker remains beside the helper and is checked before every
    // install boundary, while the still-running launcher keeps ParentId alive.
    throw new Error('Automatic installer helper did not acknowledge cancellation safely.')
  }

  removeRegularFileQuietly(options.helperPath)
  removeRegularFileQuietly(options.statusPath)
  removeRegularFileQuietly(options.cancellationPath)
}

const removeStaleHandoffFiles = (directory: string, now = Date.now()) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !HANDOFF_FILE_PATTERN.test(entry.name)) continue
    const candidate = path.join(directory, entry.name)
    try {
      const info = fs.lstatSync(candidate)
      if (!info.isFile() || info.isSymbolicLink() || now - info.mtimeMs < STALE_HANDOFF_AGE_MS) continue
      fs.rmSync(candidate, { force: true })
    } catch {
      // Old diagnostic files are optional; never make an update fail because
      // another process still owns one of them.
    }
  }
}

const readMatchingStatus = (
  statusPath: string,
  expected: WindowsAutoInstallerExpectation
): WindowsAutoInstallerStatus | null => {
  try {
    const info = fs.lstatSync(statusPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_STATUS_BYTES) return null
    return normalizeWindowsAutoInstallerStatus(JSON.parse(fs.readFileSync(statusPath, 'utf8')), expected)
  } catch {
    return null
  }
}

export const waitForWindowsAutoInstallerReady = async (options: {
  statusPath: string
  expected: WindowsAutoInstallerExpectation
  getHelperFailure?: () => Error | null
  timeoutMs?: number
  pollIntervalMs?: number
  stabilityMs?: number
}) => {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? STATUS_POLL_INTERVAL_MS
  const stabilityMs = options.stabilityMs ?? READY_STABILITY_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const helperFailure = options.getHelperFailure?.()
    if (helperFailure) throw helperFailure
    const status = readMatchingStatus(options.statusPath, options.expected)
    if (status?.state === 'failed') throw new Error(`Automatic installer helper failed: ${status.detail}`)
    if (status?.state === 'ready') {
      // Observe the same correlated state twice. This catches a helper that
      // writes READY and immediately dies before Electron quits.
      await wait(stabilityMs)
      const stabilityFailure = options.getHelperFailure?.()
      if (stabilityFailure) throw stabilityFailure
      const stableStatus = readMatchingStatus(options.statusPath, options.expected)
      if (stableStatus?.state === 'ready') return stableStatus
    }
    await wait(pollIntervalMs)
  }
  throw new Error('Automatic installer helper did not become ready.')
}

export const launchWindowsAutoInstaller = async (options: {
  installerPath: string
  expectedSha256: string
  launcherPath: string
  helperSource: string
  workDirectory: string
  parentId: number
  installScope: WindowsInstallScope
  readyTimeoutMs?: number
}): Promise<WindowsAutoInstallerHandoff> => {
  assertFileSha256(options.installerPath, options.expectedSha256)
  const directory = fs.realpathSync(options.workDirectory)
  const installer = fs.realpathSync(options.installerPath)
  const launcher = fs.realpathSync(options.launcherPath)
  const helperSource = fs.realpathSync(options.helperSource)
  assertRegularFile(installer, 'Automatic installer')
  assertRegularFile(launcher, 'Launcher executable')
  assertRegularFile(helperSource, 'Automatic update helper source')
  if (path.dirname(installer) !== directory || !/\.exe$/i.test(installer)) throw new Error('Unsafe automatic installer location.')
  if (!/\.exe$/i.test(launcher)) throw new Error('Unsafe launcher executable path.')
  if (!Number.isSafeInteger(options.parentId) || options.parentId < 1) throw new Error('Invalid launcher process id.')
  if (options.installScope !== 'all-users' && options.installScope !== 'current-user') {
    throw new Error('Invalid Windows installation scope.')
  }

  removeStaleHandoffFiles(directory)
  const attemptId = crypto.randomUUID()
  const nonce = crypto.randomBytes(32).toString('hex')
  const helperPath = path.join(directory, `install-startup-update-${attemptId}.ps1`)
  const statusPath = path.join(directory, `startup-install-status-${attemptId}.json`)
  const cancellationPath = path.join(directory, `startup-install-cancel-${attemptId}.json`)
  fs.copyFileSync(helperSource, helperPath, fs.constants.COPYFILE_EXCL)
  assertRegularFile(helperPath, 'Automatic update helper')

  const powershellPath = fs.realpathSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  assertRegularFile(powershellPath, 'Windows PowerShell executable')
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath,
    '-InstallerPath', installer, '-ExpectedSha256', options.expectedSha256,
    '-LauncherPath', launcher, '-ParentId', String(options.parentId),
    '-InstallScope', options.installScope,
    '-StatusPath', statusPath, '-CancellationPath', cancellationPath,
    '-AttemptId', attemptId, '-Nonce', nonce]

  let helperPid = 0
  try {
    helperPid = await startIndependentPowerShell({ powershellPath, args, nonce })
  } catch (error) {
    // The broker can fail after Start-Process has already created the helper.
    // Arm the per-attempt cancellation marker before returning to the manual UI.
    requestHelperCancellation(cancellationPath, { attemptId, nonce })
    await wait(250)
    // Leave the correlated files in place: a helper which starts late must see
    // the cancellation marker. The helper or bounded stale-file cleanup owns
    // their eventual removal.
    throw error
  }

  if (!Number.isSafeInteger(helperPid) || !helperPid || helperPid < 1) {
    fs.rmSync(helperPath, { force: true })
    throw new Error('Automatic installer helper did not receive a process id.')
  }
  const expected = { attemptId, nonce, helperPid }

  try {
    await waitForWindowsAutoInstallerReady({
      statusPath,
      expected,
      timeoutMs: options.readyTimeoutMs,
      getHelperFailure: () => {
        return processExists(helperPid) ? null : new Error('Automatic installer helper exited before handoff.')
      }
    })
  } catch (error) {
    try {
      await cancelWindowsAutoInstallerHelper({ helperPid, helperPath, statusPath, cancellationPath, expected })
    } catch (cancellationError) {
      throw new AggregateError([error, cancellationError], 'Automatic installer handoff failed and its helper could not be cancelled safely.')
    }
    throw error
  }

  return { ...expected, helperPath, statusPath, cancellationPath }
}
