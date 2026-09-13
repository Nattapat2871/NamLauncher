// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  LAUNCHER_UPDATE_BLOCK_MESSAGES,
  LauncherUpdateBlockedError,
  buildLauncherInstallerTempPath,
  classifyLauncherUpdateFailureMessage,
  getLauncherUpdateBlockedResult,
  isExpectedLauncherUpdateBlockMessage
} from '../shared/launcherUpdate.ts'
import {
  assertFileSha256,
  getFileSha256,
  normalizeLauncherInstallerSha256
} from '../shared/launcherUpdateIntegrity.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const textSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('classifies updater safety guards as typed expected outcomes', () => {
  for (const reason of Object.keys(LAUNCHER_UPDATE_BLOCK_MESSAGES)) {
    const error = new LauncherUpdateBlockedError(reason)
    assert.deepEqual(getLauncherUpdateBlockedResult(error), {
      success: false,
      blocked: true,
      blockReason: reason
    })
    assert.equal(isExpectedLauncherUpdateBlockMessage(error.message), true)
    assert.equal(
      isExpectedLauncherUpdateBlockMessage(`Error invoking remote method: Error: ${error.message}`),
      true
    )
  }
  assert.equal(getLauncherUpdateBlockedResult(new Error('disk write failed')), null)
  assert.equal(isExpectedLauncherUpdateBlockMessage('disk write failed'), false)
})

test('returns expected updater blocks over IPC instead of throwing and reporting a launcher problem', () => {
  assert.match(mainSource, /throw new LauncherUpdateBlockedError\('minecraft-active'\)/)
  assert.match(mainSource, /getLauncherUpdateBlockedResult\(error\)/)
  assert.match(mainSource, /return blocked/)
  assert.match(preloadSource, /context === 'ipc:install-launcher-update'[\s\S]*isExpectedLauncherUpdateBlockMessage\(message\)/)
})

test('opens the validated installer with an explicit manual install-mode choice and a Windows fallback', () => {
  assert.match(mainSource, /assertDownloadedLauncherInstaller\(installerPath, expectedSha256\)/)
  assert.match(mainSource, /spawn\(installerPath, \[\.\.\.args\], \{[\s\S]*shell: false/)
  assert.match(mainSource, /child\.once\('spawn'/)
  assert.match(mainSource, /await spawnDownloadedLauncherInstaller\(installerPath, \['--updated', '--choose-install-mode'\]\)/)
  assert.match(mainSource, /const openError = await shell\.openPath\(installerPath\)/)
})

test('keeps fresh launcher update downloads executable while they are validated', () => {
  const installerPath = String.raw`D:\Minecraft\NamLauncher-data\updates\NamLauncher-1.1.12-Installer.exe`
  const temporaryPath = buildLauncherInstallerTempPath(installerPath, '123-456-test-token')
  assert.equal(
    temporaryPath,
    String.raw`D:\Minecraft\NamLauncher-data\updates\NamLauncher-1.1.12-Installer-download-123-456-test-token.exe`
  )
  assert.match(temporaryPath, /\.exe$/i)
  assert.doesNotMatch(temporaryPath, /\.exe\.download-/i)
  assert.match(mainSource, /buildLauncherInstallerTempPath\([\s\S]*process\.pid[\s\S]*crypto\.randomUUID\(\)/)
})

test('classifies updater failures into bounded user-facing messages', () => {
  assert.equal(
    classifyLauncherUpdateFailureMessage('The downloaded launcher installer is missing or invalid.'),
    'download-invalid'
  )
  assert.equal(
    classifyLauncherUpdateFailureMessage('Windows could not open the launcher installer: access denied'),
    'installer-open-failed'
  )
  assert.equal(classifyLauncherUpdateFailureMessage('Request timed out'), 'download-failed')
  assert.equal(classifyLauncherUpdateFailureMessage('Unexpected updater state'), 'unknown')
})

test('requires and verifies an exact SHA-256 digest before an installer can be reused or opened', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-update-integrity-'))
  try {
    const installerPath = path.join(root, 'NamLauncher-test.exe')
    await writeFile(installerPath, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 7)]))
    const digest = getFileSha256(installerPath)
    assert.equal(normalizeLauncherInstallerSha256(digest.toUpperCase()), digest)
    assert.equal(assertFileSha256(installerPath, digest), digest)
    assert.throws(() => assertFileSha256(installerPath, '0'.repeat(64)), /integrity verification/)
    assert.throws(() => assertFileSha256(installerPath, ''), /valid SHA-256/)
    assert.match(mainSource, /installerSha256: normalizeLauncherInstallerSha256\(artifact\?\.sha256\)/)
    assert.match(mainSource, /downloadLauncherUpdateInstaller\(downloadUrl, installerPath, installerSha256\)/)
    assert.match(mainSource, /openDownloadedLauncherInstaller\(downloadedInstallerPath, installerSha256\)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persists the active game-data folder before manual and automatic installer handoff', () => {
  assert.match(mainSource, /const persistLauncherDataLocationForUpdate = \(\) => \{[\s\S]*configuredPath && !isSamePath\(configuredPath, userDataPath\)[\s\S]*writeDataLocationConfig\(userDataPath\)[\s\S]*isSamePath\(persistedPath, userDataPath\)/)
  assert.match(mainSource, /const persistImplicitPackagedDataLocation = \(\) => \{[\s\S]*app\.isPackaged[\s\S]*writeDataLocationConfig\(userDataPath\)/)
  assert.match(mainSource, /log\.initialize[\s\S]{0,260}persistImplicitPackagedDataLocation\(\)/)
  assert.match(mainSource, /DATA_LOCATION_BACKUP_FILE/)
  assert.match(mainSource, /Try the recoverable backup written during an interrupted atomic replacement/)
  assert.match(mainSource, /movedExistingConfig[\s\S]*fs\.renameSync\(backupPath, dataLocationConfigPath\)/)
  assert.match(mainSource, /if \(!update\.updateAvailable\)[\s\S]{0,180}persistLauncherDataLocationForUpdate\(\)[\s\S]{0,180}process\.platform !== 'win32'/)
  assert.match(mainSource, /install: async \(update, target\) => \{[\s\S]{0,180}assertLauncherUpdateInstallIsSafe\(\)\s*\n\s*persistLauncherDataLocationForUpdate\(\)/)
})

test('renders localized updater block reasons and keeps the retry action available', () => {
  assert.match(appSource, /if \(result\.blocked\)[\s\S]*getLauncherUpdateBlockMessage\(result\.blockReason\)/)
  assert.match(appSource, /setLauncherUpdateInstallState\('blocked'\)/)
  assert.match(appSource, /state: 'blocked', percent: 0, detail: message/)
  assert.match(appSource, /role="alert"/)
  assert.match(appSource, /launcherUpdateBlockReason === 'minecraft-active'/)
  assert.match(appSource, /settings\.update\.prompt\.retry\.minecraft/)
  assert.match(appSource, /disabled=\{launcherUpdateInstallState === 'installing'\}/)
  assert.match(textSource, /settings\.update\.prompt\.blocked\.minecraft/)
  assert.match(textSource, /โปรดปิด Minecraft ทุกหน้าต่างก่อน แล้วกด/)
})

test('shows the requested Thai latest-version notice in the updater dialog', () => {
  assert.match(textSource, /'settings\.update\.prompt\.title': 'โปรดอัปเดตเป็นเวอร์ชันล่าสุด'/)
  assert.match(textSource, /'settings\.update\.prompt\.eyebrow': 'การอัปเดต NamLauncher'/)
  assert.match(appSource, /t\('settings\.update\.prompt\.eyebrow'\)/)
})
