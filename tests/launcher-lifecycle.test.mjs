// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const textSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('new installations keep the launcher visible during gameplay and close to tray by default', () => {
  assert.match(mainSource, /autoMinimizeOnLaunch: settings\.autoMinimizeOnLaunch \?\? false/)
  assert.match(mainSource, /closeToTrayEnabled: settings\.closeToTrayEnabled \?\? true/)
  assert.match(mainSource, /if \(readLauncherSettings\(\)\.closeToTrayEnabled\)[\s\S]*hideLauncherToTray\(\)[\s\S]*requestAppQuit\(\)/)
  assert.match(appSource, /autoMinimizeOnLaunch: false/)
  assert.match(appSource, /closeToTrayEnabled: true/)
  assert.match(textSource, /settings\.closeToTray\.title/)
})

test('Discord IPC sleeps in the tray but ordinary taskbar minimization preserves presence', () => {
  assert.match(mainSource, /const syncDiscordForLauncherState = \(\) => \{[\s\S]*configureDiscordForActiveGames\(\)/)
  assert.match(mainSource, /mainWindow\.on\('minimize', syncDiscordForLauncherState\)/)
  assert.match(mainSource, /mainWindow\.on\('hide', \(\) => \{\s*launcherRestingInTray = true\s*syncDiscordForLauncherState\(\)/)
  assert.match(mainSource, /mainWindow\.on\('show', \(\) => \{\s*launcherRestingInTray = false/)
  assert.match(mainSource, /mainWindow\.on\('restore', \(\) => \{\s*launcherRestingInTray = false/)
  const minimize = mainSource.slice(mainSource.indexOf('const minimizeLauncherToTaskbar ='), mainSource.indexOf('const requestAppQuit ='))
  assert.doesNotMatch(minimize, /launcherRestingInTray = true|shutdown\(/)
})

test('tray sleep keeps the online heartbeat independent from paused Discord IPC', () => {
  assert.match(mainSource, /const keepOnlineHeartbeatRunning = \(_settings = readLauncherSettings\(\)\) =>/)
  assert.match(mainSource, /const minimizeLauncherToTaskbar = \(\) => \{[\s\S]*keepOnlineHeartbeatRunning\(\)[\s\S]*mainWindow\.minimize\(\)[\s\S]*syncDiscordForLauncherState\(\)/)
  assert.match(mainSource, /const hideLauncherToTray = \(\) => \{[\s\S]*keepOnlineHeartbeatRunning\(\)[\s\S]*mainWindow\.hide\(\)[\s\S]*syncDiscordForLauncherState\(\)/)
  assert.match(mainSource, /keepOnlineHeartbeatRunning[\s\S]*isAppQuitting[\s\S]*onlineHeartbeatTimer[\s\S]*sendOnlineHeartbeat\(\)[\s\S]*setInterval/)
  assert.match(mainSource, /const configureOnlineHeartbeat = \(settings = readLauncherSettings\(\)\) => \{[\s\S]*stopOnlineHeartbeat\(\)[\s\S]*keepOnlineHeartbeatRunning\(settings\)/)
  assert.match(mainSource, /const requestAppQuit = \(\) => \{[\s\S]*stopOnlineHeartbeat\(\)/)
  assert.match(textSource, /It continues while NamLauncher is hidden in the system tray/)
  assert.match(textSource, /ส่ง heartbeat ที่จำเป็นสำหรับจำนวนออนไลน์ โดยยังส่งต่อเนื่อง/)
  assert.match(textSource, /pauses its Discord activity/)
  assert.match(textSource, /heartbeat ออนไลน์และเกมที่เปิดอยู่ยังทำงานต่อ/)
})

test('tray controls expose running versions, update checks, game shutdown, and explicit exit', () => {
  assert.match(mainSource, /Minecraft \$\{game\.minecraftVersion\}/)
  assert.match(mainSource, /checkLauncherUpdateFromTray/)
  assert.match(mainSource, /stopAllMinecraftFromTray/)
  assert.match(mainSource, /requestMinecraftStop\(game\)/)
  assert.match(mainSource, /label: thai \? 'ออกจากโปรแกรม' : 'Exit NamLauncher'/)
})

test('updater cannot race a running game or content install and launch logs omit argument values', () => {
  assert.match(mainSource, /const assertLauncherUpdateInstallIsSafe = \(\) =>[\s\S]*hasActiveMinecraft\(\)[\s\S]*activeInstallTasks\.size > 0/)
  assert.match(mainSource, /if \(launcherUpdateInstallInFlight\)[\s\S]*before launching Minecraft/)
  assert.doesNotMatch(mainSource, /Java arguments: \$\{javaArgs\.join/)
  assert.match(mainSource, /Java arguments prepared: \$\{javaArgs\.length\}/)
})

test('official legal references are allowed without opening arbitrary external hosts', () => {
  for (const host of ['minecraft.net', 'www.minecraft.net', 'microsoft.com', 'www.microsoft.com']) {
    assert.ok(mainSource.includes(`'${host}'`), `missing official host ${host}`)
  }
  assert.match(mainSource, /parsed\.protocol !== 'https:'[\s\S]*allowedHosts\.has\(parsed\.hostname\.toLowerCase\(\)\)/)
})
