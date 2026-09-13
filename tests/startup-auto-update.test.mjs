// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import {
  createStartupUpdateController,
  normalizeWindowsAutoInstallerStatus,
  selectStartupUpdateTarget
} from '../shared/startupUpdate.ts'
import { getLinuxInstallCommand, replaceAppImageSafely } from '../electron/updates/platformAutoUpdate.ts'
import { waitForWindowsAutoInstallerReady } from '../electron/updates/windowsAutoInstaller.ts'
import { resolveWindowsInstallScopeFromRecords } from '../electron/updates/windowsInstallScope.ts'

const update = { currentVersion: '1.1.14', latestVersion: '1.1.16', updateAvailable: true, channel: 'stable', downloadUrl: 'https://example.invalid/update.exe', mandatory: true }
const harness = (overrides = {}) => {
  const calls = []
  const run = createStartupUpdateController({
    check: async () => { calls.push('check'); return update }, enabled: () => true,
    target: () => 'windows-x64', activeWork: () => false, previousAttempt: () => null,
    recordAttempt: () => calls.push('record'), install: async () => { calls.push('install') },
    logFailure: () => calls.push('failure'), now: () => 100000, ...overrides
  })
  return { run, calls }
}

test('automatic startup update is single-flight across concurrent calls and renderer reloads', async () => {
  const { run, calls } = harness()
  const first = run()
  assert.equal(first, run())
  assert.equal((await first).outcome, 'handoff')
  await run()
  assert.deepEqual(calls, ['check', 'record', 'install'])
})

test('startup update falls back on failures without retry loops or an installer handoff', async () => {
  for (const [overrides, outcome, reason] of [
    [{ check: async () => ({ ...update, error: 'offline' }) }, 'fallback', 'check-failed'],
    [{ check: async () => ({ ...update, updateAvailable: false }) }, 'current', undefined],
    [{ enabled: () => false }, 'disabled', undefined],
    [{ target: () => null }, 'fallback', 'unsupported-package'],
    [{ activeWork: () => true }, 'fallback', 'active-work'],
    [{ previousAttempt: () => ({ version: update.latestVersion, at: 90000 }) }, 'fallback', 'previous-attempt'],
    [{ install: async () => { throw new Error('corrupt download or denied elevation') } }, 'fallback', 'install-failed'],
    [{ recordAttempt: () => { throw new Error('disk full') } }, 'fallback', 'install-failed']
  ]) {
    const { run, calls } = harness(overrides)
    const result = await run()
    assert.equal(result.outcome, outcome)
    assert.equal(result.reason, reason)
    assert.equal(result.update.latestVersion, update.latestVersion)
    assert.ok(!calls.includes('install'))
  }
})

test('a new release is not blocked by the prior version attempt', async () => {
  const { run } = harness({ previousAttempt: () => ({ version: '1.1.14', at: 99999 }) })
  assert.equal((await run()).outcome, 'handoff')
})

test('Windows automatic installer handoff rejects stale status and requires exact attempt, nonce, and helper pid', async () => {
  const expected = {
    attemptId: '12345678-1234-4123-8123-123456789abc',
    nonce: 'a'.repeat(64),
    helperPid: 4321
  }
  const status = {
    schemaVersion: 1,
    ...expected,
    state: 'ready',
    detail: 'Waiting for the launcher to exit.',
    at: new Date().toISOString()
  }
  assert.equal(normalizeWindowsAutoInstallerStatus({ ...status, attemptId: '87654321-4321-4321-8321-cba987654321' }, expected), null)
  assert.equal(normalizeWindowsAutoInstallerStatus({ ...status, nonce: 'b'.repeat(64) }, expected), null)
  assert.equal(normalizeWindowsAutoInstallerStatus({ ...status, helperPid: 4322 }, expected), null)
  assert.deepEqual(normalizeWindowsAutoInstallerStatus(status, expected), status)

  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-windows-handoff-'))
  try {
    const statusPath = path.join(root, 'status.json')
    await writeFile(statusPath, JSON.stringify({ ...status, nonce: 'b'.repeat(64) }))
    const replacement = setTimeout(() => {
      writeFile(statusPath, JSON.stringify(status)).catch(() => undefined)
    }, 35)
    const ready = await waitForWindowsAutoInstallerReady({
      statusPath,
      expected,
      timeoutMs: 500,
      pollIntervalMs: 5,
      stabilityMs: 5
    })
    clearTimeout(replacement)
    assert.deepEqual(ready, status)

    await writeFile(statusPath, JSON.stringify({ ...status, state: 'failed', detail: 'fixture failure' }))
    await assert.rejects(waitForWindowsAutoInstallerReady({
      statusPath,
      expected,
      timeoutMs: 100,
      pollIntervalMs: 5,
      stabilityMs: 5
    }), /fixture failure/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows automatic update preserves the registered Current User or All Users scope', () => {
  const launcher = String.raw`D:\Minecraft\NamLauncher\Launcher\NamLauncher.exe`
  assert.equal(resolveWindowsInstallScopeFromRecords(launcher, [{
    hive: 'HKLM',
    uninstallString: String.raw`"D:\Minecraft\NamLauncher\Launcher\Uninstall NamLauncher.exe" /allusers`
  }]), 'all-users')
  assert.equal(resolveWindowsInstallScopeFromRecords(launcher, [{
    hive: 'HKCU',
    displayIcon: String.raw`D:\Minecraft\NamLauncher\Launcher\uninstallerIcon.ico`
  }]), 'current-user')
  assert.throws(() => resolveWindowsInstallScopeFromRecords(launcher, []), /was not found/)
  assert.throws(() => resolveWindowsInstallScopeFromRecords(launcher, [
    { hive: 'HKLM', installLocation: String.raw`D:\Minecraft\NamLauncher\Launcher` },
    { hive: 'HKCU', installLocation: String.raw`D:\Minecraft\NamLauncher\Launcher` }
  ]), /ambiguous/)
})

test('selects the installed platform and format instead of substituting AppImage for a package manager', () => {
  assert.equal(selectStartupUpdateTarget('win32', 'x64'), 'windows-x64')
  assert.equal(selectStartupUpdateTarget('darwin', 'arm64'), 'macos-universal')
  assert.equal(selectStartupUpdateTarget('darwin', 'x64'), 'macos-universal')
  assert.equal(selectStartupUpdateTarget('linux', 'x64', '', '/apps/NamLauncher.AppImage'), 'linux-appimage-x64')
  for (const format of ['deb', 'rpm', 'pacman']) assert.equal(selectStartupUpdateTarget('linux', 'x64', format), `linux-${format}-x64`)
  assert.equal(selectStartupUpdateTarget('linux', 'x64', '', '', true), null)
  assert.equal(selectStartupUpdateTarget('linux', 'x64'), null)
  assert.equal(selectStartupUpdateTarget('linux', 'arm64', 'deb'), null)
})

test('package manager commands preserve spaces and never disable system verification', () => {
  const file = '/home/test/updates/package with spaces.deb'
  const command = getLinuxInstallCommand('linux-deb-x64', file, () => true)
  assert.deepEqual(command, { file: '/usr/bin/pkexec', args: ['/usr/bin/apt-get', 'install', '--yes', file] })
  for (const target of ['linux-deb-x64', 'linux-rpm-x64', 'linux-pacman-x64']) {
    assert.doesNotMatch(getLinuxInstallCommand(target, file, () => true).args.join(' '), /nogpgcheck|unauthenticated|allow-downgrade|nodeps|shell/)
  }
  assert.throws(() => getLinuxInstallCommand('linux-deb-x64', 'relative.deb', () => true))
  assert.throws(() => getLinuxInstallCommand('linux-deb-x64', file, () => false))
})

test('AppImage replacement verifies the staged file and retains the previous executable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-appimage-update-'))
  try {
    const source = path.join(root, 'download.AppImage')
    const destination = path.join(root, 'current.AppImage')
    await writeFile(source, 'new image')
    await writeFile(destination, 'old image')
    const digest = crypto.createHash('sha512').update('new image').digest('base64')
    await assert.rejects(replaceAppImageSafely(source, destination, 'wrong'), /checksum mismatch/)
    assert.equal(await readFile(destination, 'utf8'), 'old image')
    assert.equal((await readdir(root)).length, 2)
    const backup = await replaceAppImageSafely(source, destination, digest)
    assert.equal(await readFile(destination, 'utf8'), 'new image')
    assert.equal(await readFile(backup, 'utf8'), 'old image')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps the old manual updater and enforces required updates at the main-process launch boundary', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const platform = await readFile(new URL('../electron/updates/platformAutoUpdate.ts', import.meta.url), 'utf8')
  const windowsHelper = await readFile(new URL('../packaging/update-windows.ps1', import.meta.url), 'utf8')
  const windowsInstaller = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8')
  assert.match(main, /trustedIpcHandle\('install-launcher-update'/)
  assert.match(main, /trustedIpcHandle\('run-startup-launcher-update'/)
  assert.match(main, /trustedIpcHandle\('launch-minecraft',[\s\S]{0,250}startupUpdatePending \|\| requiredLauncherUpdateVersion/)
  assert.match(main, /mandatory: updateAvailable/)
  assert.doesNotMatch(main, /requireElevation:\s*true/)
  assert.match(app, /window\.electron\.runStartupLauncherUpdate\(\)/)
  assert.match(app, /launcherUpdate\.mandatory \|\| dismissedLauncherUpdateVersion/)
  assert.match(app, /launcherUpdate\.mandatory \? \(\) => window\.electron\.windowControl\('quit'\)/)
  assert.match(platform, /updater\.autoInstallOnAppQuit = false/)
  assert.match(platform, /updater\.allowDowngrade = false/)
  assert.match(windowsHelper, /\/S --updated --force-run/)
  assert.match(windowsHelper, /\/allusers/)
  assert.match(windowsHelper, /\/currentuser/)
  assert.match(windowsHelper, /ValidateSet\('all-users', 'current-user'\)/)
  assert.doesNotMatch(windowsHelper, /Verb\s*=\s*['"]RunAs['"]/)
  assert.doesNotMatch(windowsHelper, /RequireElevation/)
  assert.match(windowsInstaller, /--choose-install-mode/)
  assert.match(windowsInstaller, /StrCpy \$installMode ""/)
  assert.doesNotMatch(windowsInstaller, /NamLauncherAutomaticCurrentUserUpdate/)
  assert.doesNotMatch(windowsInstaller, /DeleteRegKey HKLM "\$\{INSTALL_REGISTRY_KEY\}"/)
  assert.doesNotMatch(windowsInstaller, /DeleteRegKey HKLM "\$\{UNINSTALL_REGISTRY_KEY\}"/)
})

test('startup update uses a compact accessible progress card without a confirmation prompt', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /data-testid="startup-update-card"/)
  assert.match(app, /role="progressbar"/)
  assert.match(app, /aria-valuenow=\{launcherUpdatePercent\}/)
  assert.match(app, /aria-live="polite"/)
  assert.match(app, /max-w-\[440px\]/)
  assert.doesNotMatch(app, /startupAutoUpdating[\s\S]{0,300}(confirm\(|showConfirm|Yes|No)/)
})

test('macOS signed auto-update packaging is opt-in and cannot silently produce an unsigned updater', () => {
  const require = createRequire(import.meta.url)
  const base = require('../package.json').build
  const config = require('../packaging/mac/signed-auto-update.cjs')
  assert.equal(config.forceCodeSigning, true)
  assert.equal(config.mac.notarize, true)
  assert.deepEqual(config.mac.target.map(target => target.target), ['dmg', 'zip'])
  assert.equal(typeof config.afterSign, 'function')
  assert.equal(base.mac.identity, null)
  assert.deepEqual(base.mac.target.map(target => target.target), ['dmg'])
})

test('the installed updater parses JSON feeds and resolves platform channels and download URLs correctly', async (t) => {
  // The Linux fixture targets x64 regardless of the machine running this test.
  const previousArch = process.env.TEST_UPDATER_ARCH
  process.env.TEST_UPDATER_ARCH = 'x64'
  t.after(() => {
    if (previousArch === undefined) delete process.env.TEST_UPDATER_ARCH
    else process.env.TEST_UPDATER_ARCH = previousArch
  })
  const require = createRequire(import.meta.url)
  const { GenericProvider } = require('electron-updater/out/providers/GenericProvider.js')
  for (const [platform, target, channel, extension] of [
    ['win32', 'windows-x64', 'latest.yml', 'exe'],
    ['linux', 'linux-appimage-x64', 'latest-linux.yml', 'AppImage'],
    ['darwin', 'macos-universal', 'latest-mac.yml', 'zip']
  ]) {
    const url = `/download/NamLauncher-2.0.0.${extension}`
    const payload = { version: '2.0.0', files: [{ url, sha512: crypto.createHash('sha512').update('fixture').digest('base64'), size: 2048 }] }
    const provider = new GenericProvider(
      { provider: 'generic', url: `https://example.invalid/api/releases/updater/${target}/` },
      { channel: null, isAddNoCacheQuery: false },
      { platform, executor: { request: async request => {
        assert.equal(request.path, `/api/releases/updater/${target}/${channel}`)
        return JSON.stringify(payload)
      } } }
    )
    const latest = await provider.getLatestVersion()
    assert.equal(latest.version, payload.version)
    assert.equal(provider.resolveFiles(latest)[0].url.href, 'https://example.invalid' + url)
  }
})
