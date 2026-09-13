// Author/creator: nattapat2871 (https://nattapat2871.me)
// Executes the production Windows supervisor against a tiny, isolated NSIS
// fixture. No product registry entries, real launcher files, or game data used.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launchWindowsAutoInstaller } from '../electron/updates/windowsAutoInstaller.ts'
import { getFileSha256 } from '../shared/launcherUpdateIntegrity.ts'

if (process.platform !== 'win32' || !process.argv.includes('--execute-isolated-install')) {
  throw new Error('Run on Windows with --execute-isolated-install to authorize the isolated installer fixture.')
}
const nsisArgument = process.argv.indexOf('--makensis')
const nsis = nsisArgument < 0 ? '' : process.argv[nsisArgument + 1]
if (!nsis || !path.isAbsolute(nsis) || !fs.existsSync(nsis) || path.basename(nsis).toLowerCase() !== 'makensis.exe') {
  throw new Error('Pass --makensis with an absolute path to the installed makensis.exe compiler.')
}
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-auto-update-smoke-'))
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
const waitFor = async (condition, label) => {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
let completed = false
try {
  {
    const caseRoot = path.join(root, 'rejected handoff case')
    const appDir = path.join(caseRoot, 'Launcher space')
    const updateDir = path.join(caseRoot, 'updates')
    await mkdir(appDir, { recursive: true })
    await mkdir(updateDir)
    const launcher = path.join(appDir, 'Launcher.exe')
    execFileSync(compiler, ['/nologo', '/target:winexe', `/out:${launcher}`, path.join(project, 'tests/fixtures/auto-update-launcher.cs')], { windowsHide: true })
    const installer = path.join(updateDir, 'NamLauncher-fixture-Installer.exe')
    execFileSync(nsis, ['/V2', `/DFIXTURE_OUTPUT=${installer}`, path.join(project, 'tests/fixtures/auto-update-installer.nsi')], { windowsHide: true })
    const parent = spawn(launcher, [], { windowsHide: true, stdio: 'ignore' })
    const parentExit = new Promise(resolve => parent.once('exit', resolve))
    await waitFor(() => fs.existsSync(path.join(appDir, 'ready.txt')), 'rejected-handoff fixture startup')

    const corruptStatus = setInterval(() => {
      for (const name of fs.readdirSync(updateDir).filter(name => name.startsWith('startup-install-status-'))) {
        writeFile(path.join(updateDir, name), JSON.stringify({ schemaVersion: 1, state: 'ready', nonce: 'corrupted' })).catch(() => undefined)
      }
    }, 5)
    try {
      await assert.rejects(launchWindowsAutoInstaller({
        installerPath: installer,
        expectedSha256: getFileSha256(installer),
        launcherPath: launcher,
        helperSource: path.join(project, 'packaging/update-windows.ps1'),
        workDirectory: updateDir,
        parentId: parent.pid,
        installScope: 'current-user',
        readyTimeoutMs: 500
      }), /did not become ready/)
    } finally {
      clearInterval(corruptStatus)
    }

    await writeFile(path.join(appDir, 'exit.txt'), 'safe exit after rejected handoff')
    await parentExit
    await new Promise(resolve => setTimeout(resolve, 1_500))
    assert.equal(fs.existsSync(path.join(appDir, 'installed-version.txt')), false)
    assert.equal(fs.existsSync(path.join(appDir, 'reopened.txt')), false)
    assert.equal(fs.readdirSync(updateDir).some(name => name.startsWith('install-startup-update-')), false)
    assert.equal(fs.readdirSync(updateDir).some(name => name.startsWith('startup-install-cancel-')), false)
    console.log('PASS rejected handoff -> correlated helper cancelled; later launcher exit did not run installer')
  }

  for (const { failure, installScope } of [
    { failure: false, installScope: 'current-user' },
    { failure: false, installScope: 'all-users' },
    { failure: true, installScope: 'current-user' }
  ]) {
    const caseRoot = path.join(root, `${failure ? 'failure' : 'success'} ${installScope} case`)
    const appDir = path.join(caseRoot, 'Launcher space')
    const updateDir = path.join(caseRoot, 'updates')
    await mkdir(appDir, { recursive: true })
    await mkdir(updateDir)
    const sentinel = path.join(caseRoot, 'game-data-keep.txt')
    await writeFile(sentinel, 'existing worlds/accounts/settings must remain untouched')
    const sentinelHash = getFileSha256(sentinel)
    const launcher = path.join(appDir, 'Launcher.exe')
    execFileSync(compiler, ['/nologo', '/target:winexe', `/out:${launcher}`, path.join(project, 'tests/fixtures/auto-update-launcher.cs')], { windowsHide: true })
    const installer = path.join(updateDir, 'NamLauncher-fixture-Installer.exe')
    execFileSync(nsis, ['/V2', `/DFIXTURE_OUTPUT=${installer}`, ...(failure ? ['/DFAIL_INSTALL'] : []), path.join(project, 'tests/fixtures/auto-update-installer.nsi')], { windowsHide: true })
    const parent = spawn(launcher, [], { windowsHide: true, stdio: 'ignore' })
    const parentExit = new Promise(resolve => parent.once('exit', resolve))
    await waitFor(() => fs.existsSync(path.join(appDir, 'ready.txt')), 'fixture startup')
    try {
      const installOptions = {
        installerPath: installer, expectedSha256: getFileSha256(installer), launcherPath: launcher,
        helperSource: path.join(project, 'packaging/update-windows.ps1'), workDirectory: updateDir,
        parentId: parent.pid,
        installScope
      }
      await assert.rejects(launchWindowsAutoInstaller({ ...installOptions, expectedSha256: '0'.repeat(64) }), /integrity verification/)
      assert.equal(fs.readdirSync(updateDir).some(name => name.startsWith('startup-install-status-')), false)

      const handoffRequest = path.join(caseRoot, 'handoff-request.json')
      const handoffResult = path.join(caseRoot, 'handoff-result.json')
      await writeFile(handoffRequest, JSON.stringify(installOptions), { flag: 'wx' })
      const origin = spawn(process.execPath, [
        path.join(project, 'tests/fixtures/auto-update-handoff-child.mjs'),
        handoffRequest,
        handoffResult
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let originDiagnostic = ''
      origin.stderr.on('data', chunk => { originDiagnostic += String(chunk) })
      const originCode = await new Promise(resolve => origin.once('exit', resolve))
      assert.equal(originCode, 0, originDiagnostic)
      const handoff = JSON.parse(await readFile(handoffResult, 'utf8'))
      assert.match(handoff.attemptId, /^[0-9a-f-]{36}$/i)
      assert.match(handoff.nonce, /^[0-9a-f]{64}$/i)
      assert.equal(JSON.parse(await readFile(handoff.statusPath, 'utf8')).state, 'ready')

      // The process which created the helper is gone before the launcher exits.
      // This is the production lifetime boundary that v1.1.17 did not survive.
      await writeFile(path.join(appDir, 'exit.txt'), 'safe exit requested')
      await parentExit
      await waitFor(async () => {
        try { return JSON.parse(await readFile(handoff.statusPath, 'utf8')).state === (failure ? 'failed' : 'installed') }
        catch { return false }
      }, 'installer completion')
      await waitFor(() => fs.existsSync(path.join(appDir, 'reopened.txt')), 'launcher reopen')
      assert.equal(await readFile(path.join(appDir, 'reopened.txt'), 'utf8'), failure ? '--auto-update-fallback' : '--updated')
      if (!failure) {
        assert.equal(await readFile(path.join(appDir, 'installed-version.txt'), 'utf8'), '2.0.0-fixture')
        const installerArguments = await readFile(path.join(appDir, 'installer-arguments.txt'), 'utf8')
        // NSIS consumes /D before exposing $CMDLINE. The files above prove
        // that the helper preserved the original application directory.
        assert.match(installerArguments, /\/S --updated --force-run/)
        assert.match(installerArguments, installScope === 'all-users' ? /\/allusers/i : /\/currentuser/i)
      }
      assert.equal(fs.existsSync(handoff.helperPath), false)
      assert.equal(getFileSha256(sentinel), sentinelHash)
      console.log(`PASS ${installScope} detached origin exit -> ${failure ? 'manual fallback relaunch' : 'silent NSIS install and updated relaunch'}; original data unchanged`)
    } finally {
      await writeFile(path.join(appDir, 'exit.txt'), 'safe cleanup requested')
      await parentExit
    }
  }
  completed = true
} finally {
  if (completed) {
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(root).startsWith('namlauncher-auto-update-smoke-'))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    console.log('Removed isolated fixture files; production launcher was not modified.')
  } else console.error(`Retained failed-test evidence: ${root}`)
}
