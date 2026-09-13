// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const require = createRequire(import.meta.url)
const MinecraftHandler = require('minecraft-launcher-core/components/handler')

const launcherPatch = await readFile(
  new URL('../patches/minecraft-launcher-core+3.18.2+001+base.patch', import.meta.url),
  'utf8'
)
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('bounds Minecraft asset checksum and download concurrency', () => {
  assert.match(launcherPatch, /mapLimit \(items, limit, iterator\)/)
  assert.match(launcherPatch, /this\.mapLimit\(assetNames, 16/)
  assert.match(launcherPatch, /this\.mapLimit\(libraries, this\.options\.overrides\.maxSockets \|\| 16/)
  assert.doesNotMatch(launcherPatch, /^\+\s*await Promise\.all\(Object\.keys\(index\.objects\)/m)
  assert.doesNotMatch(launcherPatch, /^\+\s*await Promise\.all\(libraries\.map/m)
})

test('yields the launcher event loop while processing assets', () => {
  assert.match(launcherPatch, /setImmediate\(resolve\)/)
})

test('asset worker pool never exceeds its configured concurrency', async () => {
  const handler = Object.create(MinecraftHandler.prototype)
  let active = 0
  let maximumActive = 0

  await handler.mapLimit(Array.from({ length: 80 }, (_, index) => index), 16, async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
  })

  assert.equal(maximumActive, 16)
})

test('streams Minecraft process output without writing a duplicate per-instance launcher log', () => {
  assert.doesNotMatch(mainSource, /log\.(?:info|debug)\(`?\[MC-(?:DATA|DEBUG)\]/)
  assert.match(mainSource, /writeRunLog\(runLogStream, text, runLogInstance \|\| undefined\)/)
  assert.match(mainSource, /Minecraft game log will be read from:/)
  assert.match(mainSource, /const latestLogPath = path\.join\(gameDirectory, 'logs', 'latest\.log'\)/)
  assert.doesNotMatch(mainSource, /path\.join\(instanceRoot, 'logs', 'latest\.log'\)/)
  assert.doesNotMatch(mainSource, /publishLauncherError\(error, 'minecraft-process'/)
})

test('reports provider failures while keeping compatibility and user-action errors expected', () => {
  assert.match(preloadSource, /const isExpectedUserFacingError = \(context: string, message: string\) => \{/)
  assert.match(preloadSource, /const isExplicitUserCancellation = \(message: string\) =>/)
  assert.match(preloadSource, /Install cancelled by user/)
  assert.match(preloadSource, /Microsoft login was cancelled/)
  assert.match(preloadSource, /A required Modrinth dependency has no compatible version/)
  assert.match(preloadSource, /Minecraft launch returned no process/)
  assert.match(preloadSource, /Minecraft is already \(\?:running\|launching\)/)
  assert.match(preloadSource, /disabled third-party downloads/)
  assert.doesNotMatch(preloadSource, /Modrinth did not respond before the request timed out/)
  assert.doesNotMatch(preloadSource, /Modrinth request failed/)
  assert.doesNotMatch(preloadSource, /CurseForge did not respond before the request timed out/)
  assert.doesNotMatch(preloadSource, /CurseForge request failed/)
  assert.doesNotMatch(preloadSource, /Request failed with status code/)
  assert.match(preloadSource, /Could not log into Minecraft/)
  assert.match(preloadSource, /Microsoft sign-in \.\*Minecraft services/)
  assert.match(preloadSource, /Microsoft session \.\*\?\(expired\|missing its refresh token\|invalid\|incomplete\)/)
  assert.match(mainSource, /const isExpectedLaunchUserFacingError/)
  assert.match(mainSource, /Minecraft is already \(\?:running\|launching\)/)
  assert.match(mainSource, /if \(!isExpectedLaunchUserFacingError\(text\)\) \{[\s\S]*publishLauncherError\(text, 'launch-minecraft'/)
  assert.match(mainSource, /if \(isExpectedLaunchUserFacingError\(error\)\) return/)
  assert.match(preloadSource, /if \(isExpectedUserFacingError\(context, message\)\) return/)
  assert.ok(preloadSource.includes('A different file already uses the target enabled\\/disabled name'))
  assert.ok(preloadSource.includes('Content files changed while their enabled state was being updated'))
  assert.match(mainSource, /reconcileMatchingContentFileCollision\(filePath, nextPath\)/)
  assert.match(mainSource, /updateManifestFilePath\(instance, filePath, nextPath\)/)
  assert.match(appSource, /status\.contentToggleConflict/)
})

test('does not misclassify an aborted network response as a user-cancelled install', () => {
  assert.match(mainSource, /const isInstallCancelledError = \(_err: unknown, signal\?: AbortSignal\) => signal\?\.aborted === true/)
  assert.doesNotMatch(mainSource, /return \/cancel\(\?:led\|ed\)\|aborted\|canceled\/i\.test\(message\)/)
  assert.match(appSource, /const isUserCancelledInstall = \(taskId: string\) => cancelledInstallTasksRef\.current\.has\(taskId\)/)
  assert.doesNotMatch(appSource, /return \/cancel\(\?:led\|ed\)\|aborted\|canceled\/i\.test\(message\)/)
  assert.match(preloadSource, /if \(isExplicitUserCancellation\(message\)\) return/)
  assert.doesNotMatch(preloadSource, /cancel\(\?:led\|ed\)\|dialog was closed\|user aborted/)
  assert.doesNotMatch(preloadSource, /response aborted/i)
})

test('does not report an internally superseded Modrinth search as a provider failure', () => {
  const searchHandler = mainSource.slice(
    mainSource.indexOf("trustedIpcHandle('search-modrinth'"),
    mainSource.indexOf("trustedIpcHandle('get-curseforge-modpack-versions'")
  )
  const cancellationIndex = searchHandler.indexOf('controller.signal.aborted && axios.isCancel(err)')
  const failureIndex = searchHandler.indexOf('getModrinthFailureMessage')

  assert.ok(cancellationIndex >= 0, 'the handler must recognize its own AbortController cancellation')
  assert.ok(failureIndex > cancellationIndex, 'internal cancellation must be handled before provider failure reporting')
  assert.match(searchHandler, /return \{ hits: \[\], total_hits: 0, canceled: true \}/)
})

test('routes raw IPC failures to the popup without placing them in topbar status', () => {
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*const cleanupLauncherError = window\.electron\.onLauncherErrorReport[\s\S]*?return cleanupLauncherError\s*\}, \[\]\)/
  )
  assert.match(
    appSource,
    /const installLibraryProject = async[\s\S]*?catch \{\s*setStatusText\(t\('status\.installFailed'\)\)/
  )
  assert.match(
    appSource,
    /const message = error\.message \|\| t\('status\.launchFailed'\)[\s\S]*?setStatusText\(t\('status\.launchFailed'\)\)[\s\S]*?isMicrosoftSessionExpiredMessage\(message\)/
  )
  assert.doesNotMatch(appSource, /setStatusText\([^\n]*(?:error\??\.message|\$\{error\}|\$\{message\})/)
  assert.doesNotMatch(appSource, /setActivityDetail\([^\n]*(?:error\??\.message|\$\{error\}|\$\{message\})/)
  assert.doesNotMatch(appSource, /Error invoking remote method/i)
})

test('prepares error popups without blocking on full logs or hardware probes', () => {
  assert.match(mainSource, /fs\.promises\.open\(logPath, 'r'\)/)
  assert.doesNotMatch(mainSource, /fs\.promises\.readFile\(logPath, 'utf8'\)/)
  assert.match(mainSource, /settleWithin\(\s*launcherLogs,\s*ERROR_REPORT_INITIAL_LOG_WAIT_MS/)
  assert.match(mainSource, /system: getBasicSystemReportInfo\(\)/)
  assert.match(mainSource, /void Promise\.all\(\[launcherLogs, systemReport\]\)/)
  assert.match(mainSource, /ERROR_REPORT_HARDWARE_TIMEOUT_MS = 3000/)
})
