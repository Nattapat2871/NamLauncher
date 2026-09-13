// Author: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getDiscordLargeImageText, getPlayerHeadUrl } from '../electron/discord.ts'

const discordSource = await readFile(new URL('../electron/discord.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const textureVerifierSource = await readFile(new URL('../electron/minecraft/discordTexture.ts', import.meta.url), 'utf8')
const javaManagerSource = await readFile(new URL('../electron/javaManager.ts', import.meta.url), 'utf8')
const discordTransportSource = await readFile(new URL('../node_modules/discord-rpc/src/transports/ipc.js', import.meta.url), 'utf8')

test('uses the requested Minecraft application id for managed in-game presence', () => {
  assert.match(discordSource, /MINECRAFT_OFFICIAL_APPLICATION_ID = '1402418491272986635'/)
  assert.match(mainSource, /discordClientId: MINECRAFT_OFFICIAL_APPLICATION_ID/)
  assert.match(mainSource, /runningGames\.delete\(closedInstanceId\)[\s\S]*configureDiscordForActiveGames\(\)/)
  assert.match(mainSource, /if \(!runningGame\) \{[\s\S]*discordManager\.configure\(getDiscordRuntimeSettings\(settings\)\)[\s\S]*discordManager\.setIdleStatus\(\)/)
  assert.match(mainSource, /NamLauncher custom Discord RPC active with application id/)
  assert.doesNotMatch(mainSource, /active alongside native Minecraft detection/)
})

test('uses the supported Discord RPC activity API for launcher presence', () => {
  assert.match(discordSource, /rpc\.setActivity\(presence, pid\)/)
  assert.doesNotMatch(discordSource, /request\('SET_ACTIVITY'/)
  assert.doesNotMatch(discordSource, /DiscordRPC\.register\(/)
})

test('deduplicates Discord RPC updates without a refresh timer or activity spam log', () => {
  assert.match(discordSource, /lastActivitySignature/)
  assert.match(discordSource, /getActivitySignature/)
  assert.match(discordSource, /if \(this\.lastActivitySignature === activitySignature\)/)
  assert.doesNotMatch(discordSource, /Discord RPC activity set:/)
  assert.doesNotMatch(discordSource, /setInterval\([\s\S]*60_000/)
})

test('keeps benign Discord IPC destroy noise out of launcher reports', () => {
  assert.match(discordSource, /const isBenignDiscordDestroyError = \(err: unknown\) =>/)
  assert.match(discordSource, /Cannot read properties of null \\\(reading 'write'\\\)/)
  assert.match(discordSource, /if \(!isBenignDiscordDestroyError\(err\)\) log\.debug\('Discord RPC destroy failed', getErrorMessage\(err\)\)/)
  assert.doesNotMatch(discordSource, /Discord RPC destroy failed', err/)
})

test('uses PNG artwork instead of unsupported ICO artwork', () => {
  assert.doesNotMatch(discordSource, /favicon\.ico/)
  assert.match(discordSource, /namlauncher-icon\.png/)
})

test('keeps Minecraft RPC publishing available but does not use it for live game detection', () => {
  assert.match(discordSource, /public setInGameStatus\(/)
  assert.match(discordSource, /public setLauncherGameStatus\(/)
  assert.match(discordSource, /details: instanceName/)
  assert.match(discordSource, /state: `Name : \$\{playerName\}`/)
  assert.match(discordSource, /largeImageText: getDiscordLargeImageText\(this\.settings\?\.launcherVersion\)/)
  assert.match(discordSource, /smallImageText: playerName/)
  assert.doesNotMatch(discordSource, /smallImageText: `\$\{playerName\} \/ Minecraft/)
  assert.doesNotMatch(mainSource, /minecraftDiscordManager\.setInGameStatus\(/)
  assert.match(mainSource, /discordManager\.setLauncherGameStatus\(/)
  assert.match(discordSource, /this\.replaceActivity\('NamLauncher'/)
  assert.match(discordSource, /details: 'NamLauncher'/)
  assert.match(discordSource, /pid: Number\(gamePid\) \|\| process\.pid/)
  assert.match(mainSource, /runningGame\.playerUuid,\s*runningGame\.gamePid,\s*runningGame\.playerTextureId/)
  assert.doesNotMatch(discordSource, /Playing Minecraft/)
})

test('prioritizes the immutable Minecraft texture id for the in-game head', () => {
  const resolver = discordSource.slice(
    discordSource.indexOf('export const getPlayerHeadUrl'),
    discordSource.indexOf('type PresenceInput')
  )

  assert.match(resolver, /MINECRAFT_TEXTURE_ID_PATTERN\.test\(normalizedTextureId\)/)
  assert.match(resolver, /mc-heads\.net\/head\/\$\{normalizedTextureId\}\/64\.png/)
  assert.ok(
    resolver.indexOf('MINECRAFT_TEXTURE_ID_PATTERN.test(normalizedTextureId)')
      < resolver.indexOf('MINECRAFT_UUID_PATTERN.test(compactUuid)'),
    'texture ids must be resolved before the stale UUID fallback'
  )
  assert.match(discordSource, /textureId\?: string \| null/)
  assert.match(discordSource, /getPlayerHeadPresence\(uuid, playerName, textureId\)/)
})

test('resolves exact, explicit-null, invalid, and omitted texture arguments by behavior', () => {
  const textureId = 'a'.repeat(64)
  const compactUuid = '1234567890abcdef1234567890abcdef'

  assert.equal(
    getPlayerHeadUrl(compactUuid, 'Legacy_Name', textureId),
    `https://mc-heads.net/head/${textureId}/64.png`
  )
  assert.equal(getPlayerHeadUrl(compactUuid, 'Legacy_Name', null), null)
  assert.equal(getPlayerHeadUrl(compactUuid, 'Legacy_Name', 'invalid-texture-id'), null)
  assert.equal(
    getPlayerHeadUrl(compactUuid, 'Legacy_Name'),
    `https://mc-heads.net/head/${compactUuid}/64.png`
  )
  assert.equal(
    getPlayerHeadUrl('', 'Legacy_Name'),
    'https://mc-heads.net/head/Legacy_Name/64.png'
  )
})

test('carries the exact active texture id from the skin cache through the launch flow', () => {
  const profileCacheType = mainSource.slice(
    mainSource.indexOf('type StoredMinecraftProfileCache'),
    mainSource.indexOf('type StoredSkinLibrary')
  )
  const launchResolver = mainSource.slice(
    mainSource.indexOf('const getDiscordPlayerTextureIdForLaunch'),
    mainSource.indexOf('const ensureAuthlibInjector')
  )

  assert.match(profileCacheType, /textureId\?: string \| null/)
  assert.match(mainSource, /import \{ normalizeMinecraftTextureId, verifyMinecraftTextureFile \} from '\.\/minecraft\/discordTexture\.ts'/)
  assert.match(mainSource, /const getMinecraftTextureIdFromUrl = [\s\S]*\/texture\\\/\(\[a-f0-9\]\{64\}\)/)
  assert.match(mainSource, /textureId: normalizeMinecraftTextureId\(rawProfileCache\.textureId\)/)
  assert.match(mainSource, /accountStore\.profileCache = \{[\s\S]*textureId: normalizeMinecraftTextureId\(currentSkin\.textureId\)/)
  assert.match(mainSource, /getMinecraftTextureIdFromUrl\(activeSkin\.url\)/)
  assert.match(mainSource, /sourceTextureId: textures\.textureId/)
  assert.match(launchResolver, /try \{[\s\S]*verifyMinecraftTextureFile\(\{[\s\S]*textureId: activePreset\.sourceTextureId/)
  assert.match(launchResolver, /fileName: profileCache\.fileName,[\s\S]*textureId: profileCache\.textureId/)
  assert.match(launchResolver, /fileName: selectedSkinFileName,[\s\S]*textureId/)
  assert.match(launchResolver, /catch \{[\s\S]*return null/)
  assert.match(textureVerifierSource, /beforeOpenStats\.isSymbolicLink\(\) \|\| !beforeOpenStats\.isFile\(\)/)
  assert.match(textureVerifierSource, /actualTextureId === expectedTextureId \? expectedTextureId : null/)
  assert.match(mainSource, /const playerTextureId = getDiscordPlayerTextureIdForLaunch\(request\.accountId\)/)
  assert.match(mainSource, /playerUuid: String\(authorization\?\.uuid \|\| ''\),[\s\S]{0,120}playerTextureId,/)

  const processLaunchIndex = mainSource.indexOf('const childProcess = await launcher.launch(launchOptions)')
  const textureResolutionIndex = mainSource.indexOf('const playerTextureId = getDiscordPlayerTextureIdForLaunch(request.accountId)')
  const runningGameIndex = mainSource.indexOf('const runningGame: RunningGame = {', textureResolutionIndex)
  assert.ok(textureResolutionIndex > processLaunchIndex, 'texture verification must not run until the game process has launched')
  assert.ok(runningGameIndex > textureResolutionIndex && runningGameIndex - textureResolutionIndex < 200,
    'texture verification must happen immediately before RunningGame captures it')
})

test('validates fallback identifiers and safely omits an invalid player head', () => {
  const resolver = discordSource.slice(
    discordSource.indexOf('export const getPlayerHeadUrl'),
    discordSource.indexOf('type PresenceInput')
  )

  assert.match(discordSource, /MINECRAFT_TEXTURE_ID_PATTERN = \/\^\[a-f0-9\]\{64\}\$\/i/)
  assert.match(discordSource, /MINECRAFT_UUID_PATTERN = \/\^\[a-f0-9\]\{32\}\$\/i/)
  assert.match(discordSource, /MINECRAFT_PLAYER_NAME_PATTERN = \/\^\[A-Za-z0-9_\]\{3,16\}\$\//)
  assert.match(resolver, /mc-heads\.net\/head\/\$\{compactUuid\}\/64\.png/)
  assert.match(resolver, /encodeURIComponent\(fallbackName\)/)
  assert.match(resolver, /return null/)
  assert.doesNotMatch(resolver, /playerName \|\| 'Steve'/)
  assert.match(resolver, /if \(textureId !== undefined\) return null/)
  assert.match(discordSource, /if \(!playerHeadUrl\) return \{\}/)
  assert.match(discordSource, /\.\.\.getPlayerHeadPresence\(uuid, playerName, textureId\)/)
})

test('rejects unsafe persisted skin-library filenames before any path is resolved', () => {
  assert.match(mainSource, /const isSafeSkinLibraryFileName = \(value: unknown\): value is string =>/)
  assert.match(mainSource, /value === '\.' \|\| value === '\.\.'/)
  assert.match(mainSource, /SAFE_SKIN_LIBRARY_FILE_NAME_PATTERN\.test\(value\) && path\.basename\(value\) === value/)
  assert.match(mainSource, /capeFileName: isSafeSkinLibraryFileName\(skin\.capeFileName\)/)
  assert.match(mainSource, /if \(!isSafeSkinLibraryFileName\(preset\.fileName\)\)/)
})

test('retains a stable legacy UUID fallback only when no texture argument is supplied', () => {
  assert.match(discordSource, /mc-heads\.net\/head\/\$\{compactUuid\}\/64/)
  assert.match(discordSource, /if \(textureId !== undefined\) return null/)
  assert.doesNotMatch(discordSource, /mc-heads\.net\/avatar/)
  assert.doesNotMatch(discordSource, /crafatar\.com\/renders\/head/)
})

test('reports custom status when Discord IPC is enabled and native detection when it is disabled', () => {
  assert.match(mainSource, /lastActivity: status\.lastActivity \|\| 'NamLauncher custom status'/)
  assert.match(mainSource, /lastActivity: 'Minecraft native detection'/)
  assert.match(mainSource, /log\.info\('Playing game: Minecraft'\)/)
  assert.match(mainSource, /log\.info\(`Executable: \$\{javaPath\}`\)/)
})

test('uses javaw.exe for the game process in every Discord mode', () => {
  assert.match(javaManagerSource, /export const getMinecraftLaunchJavaPath/)
  assert.match(javaManagerSource, /javaw\.exe/)
  assert.doesNotMatch(mainSource, /useNativeMinecraftDetection/)
  assert.match(mainSource, /javaPath = getMinecraftLaunchJavaPath\(javaPath\)/)
  assert.match(mainSource, /prepareLoader\(instanceRoot, instance, javaPath, launchSessionState\.abortController\.signal\)/)
})

test('keeps Minecraft detectable while custom RPC uses the game process pid to avoid competing activities', () => {
  assert.doesNotMatch(mainSource, /DISCORD_NATIVE_DETECTION_JAVA_ARGS/)
  assert.doesNotMatch(mainSource, /discordDetectionArgs/)
  assert.match(mainSource, /-Dnamlauncher\.discord\.detect=net\.minecraft\.client\.main\.Main/)
  assert.match(discordSource, /gamePid: number/)
})

test('keeps Discord RPC reconnects bounded, quiet, and recoverable', () => {
  assert.match(discordSource, /private suspended = false/)
  assert.match(discordSource, /if \(this\.rpc !== rpc\) return/)
  assert.match(discordSource, /DISCORD_RECONNECT_DELAYS_MS = \[5000, 15000, 30000\]/)
  assert.match(discordSource, /DISCORD_RECONNECT_COOLDOWN_MS = 120000/)
  assert.match(discordSource, /Presence will retry quietly when Discord becomes reachable/)
  assert.match(discordSource, /private retryCooldown = false/)
  assert.match(discordSource, /public shutdown\(\) \{[\s\S]*this\.suspended = true/)
  assert.match(discordSource, /isDiscordTransportFailure\(err\)[\s\S]*this\.disconnect\(false\)[\s\S]*this\.scheduleReconnect\(\)/)
  assert.doesNotMatch(discordSource, /Discord RPC unavailable\. Is Discord running\?', err/)
  assert.doesNotMatch(discordSource, /Discord RPC reconnect attempt failed/)
})

test('uses the active launcher version in the large Discord image text', () => {
  assert.equal(getDiscordLargeImageText('1.1.12'), 'NamLauncher For Minecraft v.1.1.12')
  assert.equal(getDiscordLargeImageText('v1.1.12'), 'NamLauncher For Minecraft v.1.1.12')
  assert.equal(getDiscordLargeImageText(''), 'NamLauncher For Minecraft')
  assert.match(mainSource, /launcherVersion: app\.getVersion\(\)/)
})

test('uses macOS-specific Discord IPC temp paths with safe fallbacks', () => {
  assert.match(discordSource, /getDiscordPlatformLabel/)
  assert.match(discordSource, /via \$\{getDiscordPlatformLabel\(\)\} IPC/)
  assert.match(discordTransportSource, /process\.platform === 'darwin'/)
  assert.match(discordTransportSource, /\[TMPDIR, TMP, TEMP, '\/tmp'\]/)
  assert.match(discordTransportSource, /resolve\(getIPC\(id, prefixIndex \+ 1\)\)/)
  assert.match(discordTransportSource, /resolve\(getIPC\(id \+ 1, 0\)\)/)
})
