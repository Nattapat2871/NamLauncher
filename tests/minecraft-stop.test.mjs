import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const stopMinecraftSource = mainSource.slice(
  mainSource.indexOf("trustedIpcHandle('stop-minecraft'"),
  mainSource.indexOf("trustedIpcHandle('launch-minecraft'")
)
const deleteInstanceSource = mainSource.slice(
  mainSource.indexOf("trustedIpcHandle('delete-instance'"),
  mainSource.indexOf('const waitForChildProcessClose')
)
const launchCancelledProgressSource = appSource.slice(
  appSource.indexOf("p.type === 'launch-cancelled'"),
  appSource.indexOf("} else if (p.total)")
)

test('treats launcher Stop as a user-requested game close instead of a crash', () => {
  assert.match(mainSource, /stopRequestedAt\?: number/)
  assert.match(mainSource, /const requestMinecraftStop = async \(game: RunningGame\) => \{/)
  assert.match(mainSource, /game\.stopRequestedAt = Date\.now\(\)/)
  assert.match(mainSource, /wasUserStopRequested/)
  assert.match(mainSource, /normalizedCode !== 0 && !wasUserStopRequested/)
  assert.match(mainSource, /const launchSessionState: LaunchSession = \{/)
  assert.match(mainSource, /const isLaunchCancelled = \(\) => \{/)
  assert.match(mainSource, /const wasCancelledLaunch = isLaunchCancelled\(\)/)
  assert.match(mainSource, /closedGame\?\.stopRequestedAt \|\| wasCancelledLaunch/)
  assert.match(appSource, /setStatusText\(t\('status\.stopRequested'\)\)/)
})

test('asks Minecraft to close before forcing shutdown', () => {
  assert.match(mainSource, /runWindowsTaskkill\(pid, false\)/)
  assert.match(mainSource, /waitForChildProcessClose\(game\.process, 10_000\)/)
  assert.match(mainSource, /Minecraft did not close after the save window/)
  assert.match(mainSource, /runWindowsTaskkill\(pid, true\)/)
})

test('keeps cancelled launches busy until cleanup finishes before instance deletion', () => {
  assert.match(mainSource, /const removeInstanceDirectoryWithRetry = async \(instanceRoot: string\) => \{/)
  assert.match(mainSource, /RETRIABLE_DIRECTORY_REMOVE_CODES/)
  assert.match(deleteInstanceSource, /await removeInstanceDirectoryWithRetry\(instanceRoot\)/)
  assert.match(stopMinecraftSource, /launch\.cancelled = true/)
  assert.match(stopMinecraftSource, /type: 'launch-cancelled'/)
  assert.doesNotMatch(stopMinecraftSource, /activeLaunches\.delete\(launch\.instanceId\)/)
  assert.doesNotMatch(stopMinecraftSource, /status: 'stopped'/)
  assert.match(launchCancelledProgressSource, /setStatusText\(t\('status\.stopRequested'\)\)/)
  assert.doesNotMatch(launchCancelledProgressSource, /setLaunchingInstanceIds/)
  assert.match(preloadSource, /Stop Minecraft before deleting this instance/)
})
