// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const releaseRoot = path.join(projectRoot, 'release')
const artifactName = `NamLauncher-${packageJson.version}-Linux-x64.AppImage`
const artifactPath = path.join(releaseRoot, artifactName)
const debPath = path.join(releaseRoot, `NamLauncher-${packageJson.version}-Linux-x64.deb`)
const rpmPath = path.join(releaseRoot, `NamLauncher-${packageJson.version}-Linux-x64.rpm`)
const pacmanPath = path.join(releaseRoot, `NamLauncher-${packageJson.version}-Linux-x64.pkg.tar.zst`)
const extractionRoot = await mkdtemp(path.join(tmpdir(), 'namlauncher-appimage-sandbox-'))

const runChecked = (command, args, label) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${label} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

const assertNativeInstallScript = (source, label) => {
  assert.doesNotMatch(source, /--no-sandbox/, `${label} must not disable Chromium sandboxing`)
  assert.match(source, /chown root:root -- "\$SANDBOX_PATH"/)
  assert.match(source, /chmod 4755 -- "\$SANDBOX_PATH"/)
  assert.match(source, /0:0:4755/)
  assert.match(source, /required regular file is missing or unsafe/)
  assert.doesNotMatch(source, /chmod 0755/)
}

try {
  const artifact = await stat(artifactPath)
  assert.ok(artifact.isFile() && artifact.size > 1024 * 1024, `AppImage is missing or invalid: ${artifactPath}`)

  const extraction = spawnSync(artifactPath, ['--appimage-extract'], {
    cwd: extractionRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true
  })
  assert.equal(
    extraction.status,
    0,
    `Could not extract AppImage for sandbox verification: ${extraction.stderr || extraction.stdout}`
  )

  const appDir = path.join(extractionRoot, 'squashfs-root')
  const [appRun, desktopEntry, sandboxStat, executableStat, asarStat] = await Promise.all([
    readFile(path.join(appDir, 'AppRun'), 'utf8'),
    readFile(path.join(appDir, 'namlauncher.desktop'), 'utf8'),
    stat(path.join(appDir, 'chrome-sandbox')),
    stat(path.join(appDir, 'namlauncher')),
    stat(path.join(appDir, 'resources', 'app.asar'))
  ])

  assert.doesNotMatch(appRun, /--no-sandbox/, 'AppRun must never disable Chromium sandboxing')
  assert.doesNotMatch(desktopEntry, /--no-sandbox/, 'desktop entry must never disable Chromium sandboxing')
  assert.doesNotMatch(appRun, /NO_SANDBOX/, 'AppRun must not contain an automatic no-sandbox fallback')
  assert.match(appRun, /command -v unshare/)
  assert.match(appRun, /unshare -Ur true/)
  assert.match(appRun, /exec "\$BIN" --disable-setuid-sandbox/)
  assert.match(appRun, /exit 126/)
  assert.match(appRun, /requires Linux user namespaces for its AppImage sandbox/)
  assert.match(desktopEntry, /^Exec=AppRun %U$/m)
  assert.equal(sandboxStat.mode & 0o4000, 0, 'AppImage must not claim an ineffective SUID helper')
  assert.ok(executableStat.isFile() && executableStat.size > 1024 * 1024)
  assert.ok(asarStat.isFile() && asarStat.size > 1024)

  const blockedPath = path.join(extractionRoot, 'blocked-path')
  const blockedUnshare = path.join(blockedPath, 'unshare')
  await mkdir(blockedPath)
  await writeFile(blockedUnshare, '#!/bin/sh\nexit 1\n', 'utf8')
  await chmod(blockedUnshare, 0o755)
  const failClosedProbe = spawnSync(path.join(appDir, 'AppRun'), [], {
    cwd: extractionRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: extractionRoot,
      PATH: `${blockedPath}${path.delimiter}${process.env.PATH || ''}`
    },
    timeout: 10_000,
    windowsHide: true
  })
  assert.equal(failClosedProbe.status, 126, 'AppRun must fail with status 126 when user namespaces are unavailable')
  assert.match(failClosedProbe.stderr, /requires Linux user namespaces for its AppImage sandbox/)

  const nativeArtifactStats = await Promise.all([debPath, rpmPath, pacmanPath].map((filePath) => stat(filePath)))
  for (const nativeArtifact of nativeArtifactStats) {
    assert.ok(nativeArtifact.isFile() && nativeArtifact.size > 1024 * 1024, 'Native Linux package is missing or invalid')
  }

  const debControlRoot = path.join(extractionRoot, 'deb-control')
  await mkdir(debControlRoot)
  runChecked('dpkg-deb', ['--control', debPath, debControlRoot], 'DEB control extraction')
  const debPostInstall = await readFile(path.join(debControlRoot, 'postinst'), 'utf8')
  const rpmScripts = runChecked('rpm', ['-qp', '--scripts', rpmPath], 'RPM script query')
  const pacmanInstall = runChecked('tar', ['-xOf', pacmanPath, '.INSTALL'], 'Pacman install script query')

  assertNativeInstallScript(debPostInstall, 'DEB post-install')
  assertNativeInstallScript(rpmScripts, 'RPM post-install')
  assertNativeInstallScript(pacmanInstall, 'Pacman post-install')

  const appArmorProfile = await readFile(path.join(releaseRoot, 'linux-unpacked', 'resources', 'apparmor-profile'), 'utf8')
  assert.match(appArmorProfile, /profile "namlauncher" "\/opt\/NamLauncher\/namlauncher" flags=\(unconfined\)/)
  assert.match(appArmorProfile, /^\s*userns,\s*$/m)

  console.log(`Verified fail-closed AppImage and native Chromium sandbox installers for ${packageJson.version}.`)
} finally {
  await rm(extractionRoot, { recursive: true, force: true })
}
