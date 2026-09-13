// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { shouldInstallForgeProfileDirectly } from '../electron/minecraft/forgeProfile.ts'
import { getMinecraftCrashDiagnosis } from '../shared/minecraftCrashDiagnosis.ts'

const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const modern = (mainClass = 'net.minecraftforge.bootstrap.ForgeBootstrap') => ({
  id: '1.21.1-forge-52.1.16', inheritsFrom: '1.21.1', mainClass,
  libraries: [], arguments: { jvm: ['-Djava.net.preferIPv6Addresses=system'] }
})

test('uses direct profiles for both official modern Forge bootstraps and preserves legacy ForgeWrapper', () => {
  assert.equal(shouldInstallForgeProfileDirectly(modern(), '1.21.1'), true)
  assert.equal(shouldInstallForgeProfileDirectly(modern('cpw.mods.bootstraplauncher.BootstrapLauncher'), '1.21.1'), true)
  assert.equal(shouldInstallForgeProfileDirectly(modern('net.minecraft.launchwrapper.Launch'), '1.21.1'), false)
  assert.throws(() => shouldInstallForgeProfileDirectly(modern(), '1.20.1'), /does not match/)
  assert.throws(() => shouldInstallForgeProfileDirectly({ ...modern(), id: '../../outside' }, '1.21.1'), /does not match/)
})

test('installs a verified Forge profile once, returns its JVM arguments, and repairs a modified profile', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-direct-forge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const forgePath = path.join(root, 'installer.jar')
  const profile = modern()
  const archive = new AdmZip()
  archive.addFile('version.json', Buffer.from(JSON.stringify(profile)))
  await writeFile(forgePath, archive.toBuffer())
  const calls = []
  const installedPath = path.join(root, 'versions', profile.id, profile.id + '.json')
  const code = source.slice(source.indexOf('const ensureDirectForgeProfile ='), source.indexOf('const ensureNeoForgeProfile ='))
  const prepare = runInNewContext(stripTypeScriptTypes(code) + '\nensureDirectForgeProfile', {
    AdmZip, path, fs, Date, shouldInstallForgeProfileDirectly,
    MAX_ZIP_METADATA_ENTRY_BYTES: 1024 * 1024,
    getZipEntryDataWithLimit: entry => entry.getData(),
    normalizeLoaderPathIdentifier: value => value,
    assertPathWithinRoot: (parent, child) => assert.ok(path.resolve(child).startsWith(path.resolve(parent) + path.sep)),
    hashFile: async file => crypto.createHash('sha256').update(await readFile(file)).digest('hex'),
    readJsonFile: (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } },
    writeJsonFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)) },
    ensureVerifiedMinecraftClient: async () => { calls.push('verify-minecraft') },
    runLoaderInstaller: async (java, installer, target, signal, name) => {
      assert.equal(name, 'Forge'); assert.equal(target, root); assert.equal(installer, forgePath)
      calls.push('official-forge-installer')
      await mkdir(path.dirname(installedPath), { recursive: true }); await writeFile(installedPath, JSON.stringify(profile))
    },
    resolveNeoForgeJvmArguments: (target, id, args) => { assert.equal(target, root); assert.equal(id, profile.id); return args },
    log: { info() {} }
  })
  const forge = { forgePath, loaderVersion: '52.1.16' }
  const result = await prepare(root, '1.21.1', 'java', forge)
  assert.equal(result.customVersionId, profile.id)
  assert.equal(result.forgePath, undefined, 'Do not ask MCLC to substitute ForgeWrapper again')
  assert.equal(result.javaArgs[0], profile.arguments.jvm[0])
  await prepare(root, '1.21.1', 'java', forge)
  assert.deepEqual(calls, ['verify-minecraft', 'official-forge-installer'])
  await writeFile(installedPath, '{"mainClass":"wrong"}')
  await prepare(root, '1.21.1', 'java', forge)
  assert.equal(calls.length, 4)
  assert.equal(JSON.parse(await readFile(installedPath, 'utf8')).mainClass, profile.mainClass)
})

test('headless installer uses the loader-specific official CLI flag and a bounded child process', () => {
  assert.match(source, /loaderName === 'Forge' \? '--installClient' : '--install-client'/)
  assert.match(source, /const directProfile = await ensureDirectForgeProfile/)
  assert.match(source, /if \(directProfile\) return directProfile/)
  const installer = source.slice(source.indexOf('const runLoaderInstaller ='), source.indexOf('const runNeoForgeInstaller ='))
  assert.match(installer, /windowsHide: true/)
  assert.match(installer, /installer\.kill\(\)/)
  assert.match(installer, /10 \* 60 \* 1000/)
})

const createInstallerHarness = () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => { child.killed = true; return true }
  let invocation
  const code = source.slice(source.indexOf('const runLoaderInstaller ='), source.indexOf('const runNeoForgeInstaller ='))
  const install = runInNewContext(stripTypeScriptTypes(code) + '\nrunLoaderInstaller', {
    path, setTimeout, clearTimeout, Error,
    fs: { existsSync: () => true },
    spawn: (java, args, options) => { invocation = { java, args, options }; return child },
    redactSensitiveText: String,
    sendProgress: () => {},
    getMinecraftCrashDiagnosis,
    LAUNCH_CANCELLED_MESSAGE: 'Launch cancelled'
  })
  return { child, install, invocation: () => invocation }
}

test('both loader installers use a small initial heap and a bounded maximum independently of game RAM', async () => {
  for (const loader of ['Forge', 'NeoForge']) {
    const harness = createInstallerHarness()
    const pending = harness.install('java', '/fixture/installer.jar', '/fixture', undefined, loader)
    const { args, options } = harness.invocation()
    assert.equal(args[0], '-Xms128m')
    assert.equal(args[1], '-Xmx2048m')
    assert.equal(args.filter(arg => arg.startsWith('-Xmx')).length, 1)
    assert.ok(args.indexOf('-Xmx2048m') < args.indexOf('-jar'))
    assert.ok(args.includes(loader === 'Forge' ? '--installClient' : '--install-client'))
    assert.equal(options.windowsHide, true)
    harness.child.emit('close', 0); await pending
  }
})

test('installer error preserves the native-memory cause outside the last eight output lines', async () => {
  const harness = createInstallerHarness()
  const pending = harness.install('java', '/fixture/installer.jar', '/fixture', undefined, 'Forge')
  harness.child.stderr.emit('data', 'The paging file is too small for this operation to complete (DOS error/errno=1455)\n')
  harness.child.stdout.emit('data', Array.from({ length: 12 }, (_, i) => `processor detail ${i}`).join('\n'))
  harness.child.emit('close', 1)
  await assert.rejects(pending, error => {
    assert.equal(getMinecraftCrashDiagnosis(error.message)?.code, 'jvm-native-memory')
    assert.match(error.message, /processor detail 11/)
    return true
  })
})

test('unknown installer errors and cancellations are not disguised as memory failures', async () => {
  const unknown = createInstallerHarness()
  const pending = unknown.install('java', '/fixture/installer.jar', '/fixture', undefined, 'Forge')
  unknown.child.stderr.emit('data', 'Unexpected processor exception')
  unknown.child.emit('close', 1)
  await assert.rejects(pending, error => {
    assert.equal(getMinecraftCrashDiagnosis(error.message), null)
    assert.match(error.message, /Unexpected processor exception/)
    return true
  })
  const cancelled = createInstallerHarness(), controller = new AbortController()
  const cancellation = cancelled.install('java', '/fixture/installer.jar', '/fixture', controller.signal, 'Forge')
  controller.abort()
  await assert.rejects(cancellation, /Launch cancelled/)
  assert.equal(cancelled.child.killed, true)
})
