// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { classifyMinecraftProcessFailure, isLocalMinecraftLaunchFailure } from '../shared/minecraftFailureClassification.ts'
import { getMinecraftCrashDiagnosis } from '../shared/minecraftCrashDiagnosis.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

const classify = (message) => classifyMinecraftProcessFailure(
  message,
  getMinecraftCrashDiagnosis(message)
)

test('historical Realms-only exits remain local without inventing a crash cause', () => {
  const failure = classify('Loading Minecraft 26.2 with Fabric Loader 0.19.3\nLoading mods: namlauncher-branding-bridge\n[Download-1/ERROR]: Failed to fetch Realms feature flags\ncom.mojang.realmsclient.exception.RealmsServiceException: Realms authentication error\nNo crash report was found.')
  assert.equal(failure.category, 'unknown-game')
  assert.equal(failure.reportPolicy, 'local-only')
  assert.equal(failure.confidence, 'low')
})

const createGameErrorHarness = (gameProcessStarted = false) => {
  const issues = []
  const reports = []
  let onError
  const start = mainSource.indexOf("  launcher.on('error', (error) => {")
  const end = mainSource.indexOf('\n  try {', start)
  assert.ok(start > 0 && end > start)
  const context = {
    launcher: { on: (_event, handler) => { onError = handler } },
    isLaunchCancelled: () => false,
    truncateRemoteText: (value, limit) => String(value).slice(0, limit),
    redactSensitiveText: (value) => String(value),
    writeRunLog: () => {},
    runLogStream: null,
    runLogInstance: null,
    mainWindow: { webContents: { send: () => {} } },
    getMinecraftCrashDiagnosis,
    classifyMinecraftProcessFailure,
    isLocalMinecraftLaunchFailure,
    isExpectedLaunchUserFacingError: () => false,
    launchManagedComponentActive: true,
    launchLocalGameIssueSent: false,
    launchGameProcessStarted: gameProcessStarted,
    launchedInstanceId: 'fixture-instance',
    launchedInstanceName: 'Fixture instance',
    launchPlayerName: 'FixturePlayer',
    launchAccountType: 'offline',
    crypto: { randomUUID: () => 'fixture-local-issue' },
    log: { warn: () => {} },
    sendMinecraftGameIssue: (issue) => issues.push(issue),
    publishLauncherError: (...report) => { reports.push(report); return Promise.resolve() }
  }
  runInNewContext(mainSource.slice(start, end), context)
  return { issues, reports, onError }
}

test('the SDK error boundary shows local mod logs once and never submits them', () => {
  const { issues, reports, onError } = createGameErrorHarness()
  const message = 'Incompatible mods found! examplemod requires another dependency'
  onError(message)
  onError(message)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].logs, message)
  assert.equal(issues[0].instanceId, 'fixture-instance')
  assert.equal(reports.length, 0)
})

test('the SDK boundary distinguishes launcher setup failures from unknown game failures', () => {
  const setup = createGameErrorHarness()
  setup.onError('TypeError: unexpected launcher preparation failure')
  assert.equal(setup.issues.length, 0)
  assert.equal(setup.reports.length, 1)
  assert.equal(setup.reports[0][1], 'launch-minecraft')

  const game = createGameErrorHarness(true)
  game.onError('Unclassified game process failure')
  assert.equal(game.issues.length, 1)
  assert.equal(game.reports.length, 0)
})

test('Forge native memory failures before game startup stay local with actionable logs', () => {
  const message = 'Forge installer exited with code 1:\nThe paging file is too small for this operation to complete (DOS error/errno=1455)\nNative memory allocation (mmap) failed to map 1113587712 bytes.'
  const failure = classify(message)
  assert.equal(failure.category, 'game-environment')
  assert.equal(failure.code, 'jvm-memory')
  assert.equal(failure.reportPolicy, 'local-only')
  assert.equal(isLocalMinecraftLaunchFailure(failure, false, false), true)
  const { issues, reports, onError } = createGameErrorHarness(false)
  onError(message)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].diagnosis.code, 'jvm-native-memory')
  assert.equal(issues[0].logs, message)
  assert.equal(reports.length, 0)
})

test('the SDK boundary still automatically reports a managed companion failure', () => {
  const { issues, reports, onError } = createGameErrorHarness(true)
  onError('Critical injection failure from mod namlauncher-game-companion failed injection check')
  assert.equal(issues.length, 0)
  assert.equal(reports.length, 1)
  assert.equal(reports[0][3].failureClassification.reportPolicy, 'automatic')
})

test('keeps Fabric dependency failures caused by player content local', () => {
  const failure = classify(`
    Incompatible mods found!
    A potential solution has been determined:
      - Install yet_another_config_lib_v3, version 3.9.4+26.2 or later.
    More details:
      - Mod 'Bridging Mod' (bridgingmod) requires version 3.9.4+26.2 or later of yet_another_config_lib_v3, which is missing!
  `)

  assert.equal(failure.category, 'user-content')
  assert.equal(failure.code, 'mod-dependency')
  assert.equal(failure.reportPolicy, 'local-only')
})

test('keeps Forge and NeoForge mod loading failures local', () => {
  for (const message of [
    'net.minecraftforge.fml.ModLoadingException: Mod File example.jar needs language provider javafml:47 or above',
    'net.neoforged.fml.ModLoadingException: Missing or unsupported mandatory dependencies: examplemod requires minecraft 1.21.11',
    'Description: Mod loading error has occurred\njava.lang.Exception: Mod Loading has failed',
    'Failed to create mod instance. ModID: chisel, class team.chisel.Chisel. Caused by: java.lang.NoClassDefFoundError: team/chisel/ctm/api/texture/ITextureType',
    'Mod chisel has failed during the common_setup event phase. java.lang.NoClassDefFoundError: team/chisel/ctm/client/util/TextureUtils',
    'HammerLib failed to load correctly: Duplicate network channel hammerlib:sync already registered'
  ]) {
    const failure = classify(message)
    assert.equal(failure.category, 'user-content')
    assert.equal(failure.code, 'mod-loading')
    assert.equal(failure.reportPolicy, 'local-only')
  }
})

test('keeps corrupt manual jars and Fabric entrypoint failures local', () => {
  for (const message of [
    'java.util.zip.ZipException: zip END header not found while reading C:\\instance\\mods\\custom-client.jar',
    "net.fabricmc.loader.api.EntrypointException: Could not execute entrypoint stage 'client' due to errors, provided by 'custommod'",
    'Failure message: Mod File custommod.jar has failed to load correctly'
  ]) {
    const failure = classify(message)
    assert.equal(failure.category, 'user-content')
    assert.equal(failure.code, 'mod-loading')
    assert.equal(failure.reportPolicy, 'local-only')
  }
})

test('keeps a third-party Mixin failure local', () => {
  const failure = classify(`
    org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError
    Critical injection failure: mixins.fabrishot.json from mod fabrishot failed injection check
  `)

  assert.equal(failure.category, 'user-content')
  assert.equal(failure.code, 'mod-mixin')
  assert.equal(failure.reportPolicy, 'local-only')
})

test('reports failures owned by a managed NamLauncher game component', () => {
  for (const message of [
    'Critical injection failure: namlauncher-game-companion.fabric.mixins.json from mod namlauncher-game-companion failed injection check',
    "Mod 'NamLauncher Game Companion' (namlauncher_game_companion) requires minecraft 26.2, but 1.21.11 is present",
    'Caused by: java.lang.IllegalStateException: failed\n    at com.namlauncher.bridge.mixin.PlayerTabOverlayMixin.render(PlayerTabOverlayMixin.java:42)'
  ]) {
    const failure = classify(message)
    assert.equal(failure.category, 'namlauncher-component')
    assert.equal(failure.owner, 'namlauncher')
    assert.equal(failure.reportPolicy, 'automatic')
  }
})

test('separates the current Java runtime incident from third-party dependency conflicts', () => {
  const launcherRuntimeFailure = classify(`
    Loading Minecraft 26.2 with Fabric Loader 0.19.3
    Incompatible mods found!
    Mod 'NamLauncher Branding Bridge' (namlauncher-branding-bridge) 1.1.12+26.2 requires version 25 or later of java,
    but only the wrong version is present: 21!
  `)
  assert.equal(launcherRuntimeFailure.category, 'namlauncher-component')
  assert.equal(launcherRuntimeFailure.code, 'namlauncher-runtime-failure')
  assert.equal(launcherRuntimeFailure.reportPolicy, 'automatic')

  const playerDependencyFailure = classify(`
    Mod resolution failed
    HARD_DEP namlauncher-branding-bridge 1.1.12+26.2 {depends java @ [>=25]}
    Mod 'Reese\'s Sodium Options' requires sodium 0.9.1-beta.3 or later,
    but only the wrong version is present: sodium 0.8.12!
  `)
  assert.equal(playerDependencyFailure.category, 'user-content')
  assert.equal(playerDependencyFailure.reportPolicy, 'local-only')
})

test('identifies broken resource packs and shutdown watchdog hangs without reporting the launcher', () => {
  const resourcePack = classify(String.raw`Failed to open pack D:\instance\resourcepacks\Th-En-Font.zip\njava.util.zip.ZipException: zip file is empty`)
  assert.equal(resourcePack.category, 'user-content')
  assert.equal(resourcePack.code, 'resource-pack-invalid')
  assert.equal(resourcePack.reportPolicy, 'local-only')

  const shutdownHang = classify('Description: Client shutdown from window close callback\njava.lang.Error: Watchdog (Client shutdown from window close callback)\n at org.lwjgl.glfw.GLFW.glfwDestroyWindow')
  assert.equal(shutdownHang.category, 'game-environment')
  assert.equal(shutdownHang.code, 'client-shutdown-hang')
  assert.equal(shutdownHang.reportPolicy, 'local-only')
})

test('does not blame a bundled mod merely listed near a third-party error', () => {
  for (const message of [
    'Mods:\n  namlauncher-game-companion 1.1.14\nCaused by: java.lang.IllegalStateException: custom mod failed\n  at org.example.CustomMod.init(CustomMod.java:42)',
    'Critical injection failure: mixins.example.json from mod example failed injection check\nInstalled mods:\n  namlauncher-branding-bridge 1.1.14',
    'java.lang.IllegalStateException: user mod failed\n  at org.example.CustomMod.init(CustomMod.java:42)\n  at com.namlauncher.bridge.Callback.run(Callback.java:20)'
  ]) {
    assert.equal(classify(message).reportPolicy, 'local-only', message)
  }
})

test('keeps game errors local even when they also reject the launch IPC', () => {
  for (const message of [
    'Incompatible mods found! custommod requires missing dependency',
    'java.lang.OutOfMemoryError: Java heap space'
  ]) {
    assert.equal(isLocalMinecraftLaunchFailure(classify(message)), true, message)
  }
  const unknown = classify('Unexpected game failure')
  assert.equal(isLocalMinecraftLaunchFailure(unknown, true), true)
  assert.equal(isLocalMinecraftLaunchFailure(unknown, false, true), true)
  assert.equal(isLocalMinecraftLaunchFailure(classify('TypeError: launcher preparation failed')), false)
  assert.equal(isLocalMinecraftLaunchFailure(classify('Minecraft launch returned no process')), false)
  const owned = classify('Critical injection failure from mod namlauncher-game-companion failed injection check')
  assert.equal(isLocalMinecraftLaunchFailure(owned, true, true), false)
})

test('shows bounded local game logs with clipboard access but no report submission action', () => {
  const gameDialog = appSource.slice(appSource.indexOf('const gameIssueInstance ='), appSource.indexOf('const mrpackImportProgressModal ='))
  assert.match(gameDialog, /minecraftGameIssue\?\.logs/)
  assert.match(gameDialog, /<textarea[\s\S]*id="minecraft-game-issue-logs"[\s\S]*readOnly/)
  assert.match(gameDialog, /window\.electron\.copyErrorReport\(gameIssueLogs\)/)
  assert.match(gameDialog, /gameIssue\.localOnly/)
  assert.doesNotMatch(gameDialog, /submitErrorReport|submitLauncherErrorReport|fetch\(/)
  assert.match(mainSource, /logs: truncateRemoteText\(error, 20000\)/)
  assert.match(mainSource, /metadata\.failureClassification\?\.reportPolicy === 'local-only'/)
  assert.match(mainSource, /isLocalMinecraftLaunchFailure\(failure, launchLocalGameIssueSent, launchGameProcessStarted/)
  assert.match(mainSource, /buildInstanceCrashLog\(runLogInstance, launchSessionState\.startedAt\)/)
  assert.match(mainSource, /\.filter\(\(entry\) => entry\.mtimeMs >= since\)/)
})

test('does not trust a NamLauncher-like mod id when no managed component was provisioned', () => {
  const message = 'Critical injection failure from mod namlauncher-game-companion failed injection check'
  const failure = classifyMinecraftProcessFailure(message, getMinecraftCrashDiagnosis(message), {
    managedComponentActive: false,
    managedJavaRuntimeActive: false
  })

  assert.equal(failure.category, 'user-content')
  assert.equal(failure.reportPolicy, 'local-only')
})

test('keeps graphics, JVM, and unknown game-process failures out of launcher reports', () => {
  const graphics = classify('OpenGL debug message: GL error GL_OUT_OF_MEMORY')
  assert.equal(graphics.category, 'game-environment')
  assert.equal(graphics.reportPolicy, 'local-only')

  const memory = classify('java.lang.OutOfMemoryError: Java heap space')
  assert.equal(memory.category, 'game-environment')
  assert.equal(memory.reportPolicy, 'local-only')

  const unknown = classify('Minecraft exited with code 1')
  assert.equal(unknown.category, 'unknown-game')
  assert.equal(unknown.reportPolicy, 'local-only')
})

test('routes game issues separately and only publishes owned component failures', () => {
  assert.match(mainSource, /const failure = classifyMinecraftProcessFailure\(error, diagnosis, \{/)
  assert.match(mainSource, /managedComponentActive: launchManagedComponentActive/)
  assert.match(mainSource, /if \(failure\.reportPolicy === 'automatic'\)/)
  assert.match(mainSource, /launcher\.on\('error',[\s\S]*failure\.reportPolicy === 'automatic'/)
  assert.doesNotMatch(mainSource, /!isExpectedLaunchUserFacingError\(text\) && !isKnownLocalGameFailure/)
  assert.match(mainSource, /failure\.code === 'namlauncher-runtime-failure'[\s\S]{0,160}NamLauncher selected an incompatible Java runtime/)
  assert.match(mainSource, /publishLauncherError\(error, 'minecraft-exit'/)
  assert.match(mainSource, /sendMinecraftGameIssue\(\{/)
  assert.match(mainSource, /const sendMinecraftGameIssue[\s\S]{0,300}showMainWindow\(\)/)
  assert.match(mainSource, /ensureDir\(gameDirectory\)[\s\S]{0,250}provisionThaiResourcePack\(instance\)/)
  assert.match(mainSource, /Refused to publish a local-only Minecraft process failure/)
  assert.match(preloadSource, /onMinecraftGameIssue:/)
  assert.match(preloadSource, /ipcRenderer\.on\('minecraft-game-issue'/)
  assert.match(preloadSource, /context === 'ipc:launch-minecraft'\) return true/)
  assert.doesNotMatch(preloadSource, /classifyMinecraftProcessFailure/)
  assert.match(mainSource, /context === 'ipc:launch-minecraft'[\s\S]{0,300}Refused duplicate renderer report for a centrally handled Minecraft launch failure/)
  assert.match(mainSource, /if \(!launchLocalGameIssueSent\)[\s\S]{0,500}sendMinecraftGameIssue/)
  assert.match(appSource, /const \[minecraftGameIssue, setMinecraftGameIssue\]/)
  assert.match(appSource, /window\.electron\.onMinecraftGameIssue/)
  assert.match(appSource, /gameIssue\.openMods/)
  assert.doesNotMatch(appSource, /submitErrorReport\(\{[\s\S]{0,300}minecraftGameIssue/)
})
