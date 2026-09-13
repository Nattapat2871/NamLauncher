// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const launcherCorePatch = await readFile(new URL('../patches/minecraft-launcher-core+3.18.2+001+base.patch', import.meta.url), 'utf8')
const launcherCorePruneScript = await readFile(new URL('../scripts/prune-minecraft-launcher-core-request.mjs', import.meta.url), 'utf8')
const registerSchemePruneScript = await readFile(new URL('../scripts/prune-unused-register-scheme.mjs', import.meta.url), 'utf8')
const discordRpcUtilSource = await readFile(new URL('../node_modules/discord-rpc/src/util.js', import.meta.url), 'utf8')
const electronMainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const javaManagerSource = await readFile(new URL('../electron/javaManager.ts', import.meta.url), 'utf8')
const installerIconScript = await readFile(new URL('../scripts/ensure-installer-icon.mjs', import.meta.url), 'utf8')
const assertReportTokenScript = await readFile(new URL('../scripts/assert-error-report-token.mjs', import.meta.url), 'utf8')
const verifyReportTokenScript = await readFile(new URL('../scripts/verify-error-report-token-in-build.mjs', import.meta.url), 'utf8')
const appBuilderPatch = await readFile(new URL('../patches/app-builder-lib+26.15.3.patch', import.meta.url), 'utf8')
const linuxSandboxVerifier = await readFile(new URL('../scripts/verify-linux-package-sandbox.mjs', import.meta.url), 'utf8')
const linuxAfterInstall = await readFile(new URL('../build/linux-after-install.sh', import.meta.url), 'utf8')

const runNodeScript = (scriptPath) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.once('error', reject)
  child.once('exit', (code) => resolve({ code, stdout, stderr }))
})

test('does not install deprecated request through minecraft-launcher-core', async () => {
  const launcherCore = packageLock.packages['node_modules/minecraft-launcher-core']

  assert.ok(launcherCore)
  assert.equal(packageLock.packages['node_modules/request'], undefined)
  assert.equal(launcherCore.dependencies?.request, undefined)
  assert.match(packageJson.scripts.postinstall, /prune-minecraft-launcher-core-request\.mjs/)
  assert.match(launcherCorePatch, /-const request = require\('request'\)/)
  assert.match(launcherCorePruneScript, /delete packageJson\.dependencies\.request/)
  await assert.rejects(access(new URL('../patches/request+2.88.2.patch', import.meta.url)))
})

test('does not ship the vulnerable unused extract-zip package', () => {
  assert.equal(packageJson.dependencies?.['extract-zip'], undefined)
  assert.equal(packageLock.packages['node_modules/extract-zip'], undefined)
})

test('prunes only discord-rpc optional register-scheme instead of disguising a single-arch addon', async (context) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'namlauncher-register-scheme-prune-'))
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  const scriptDirectory = path.join(fixtureRoot, 'scripts')
  const nodeModulesDirectory = path.join(fixtureRoot, 'node_modules')
  const registerSchemeDirectory = path.join(nodeModulesDirectory, 'register-scheme')
  const unrelatedDirectory = path.join(nodeModulesDirectory, 'keep-this-package')
  await Promise.all([
    mkdir(path.join(nodeModulesDirectory, 'discord-rpc'), { recursive: true }),
    mkdir(registerSchemeDirectory, { recursive: true }),
    mkdir(unrelatedDirectory, { recursive: true }),
    mkdir(scriptDirectory, { recursive: true })
  ])
  await Promise.all([
    writeFile(
      path.join(nodeModulesDirectory, 'discord-rpc', 'package.json'),
      JSON.stringify({ optionalDependencies: { 'register-scheme': 'test-only' } }),
      'utf8'
    ),
    writeFile(path.join(registerSchemeDirectory, 'native.node'), 'test-only', 'utf8'),
    writeFile(path.join(unrelatedDirectory, 'keep.txt'), 'preserved', 'utf8'),
    writeFile(path.join(scriptDirectory, 'prune-unused-register-scheme.mjs'), registerSchemePruneScript, 'utf8')
  ])

  const result = await runNodeScript(path.join(scriptDirectory, 'prune-unused-register-scheme.mjs'))
  assert.equal(result.code, 0, result.stderr)
  await assert.rejects(access(registerSchemeDirectory))
  await access(path.join(unrelatedDirectory, 'keep.txt'))
  assert.match(result.stdout, /Removed unused optional register-scheme native addon/)
  assert.match(packageJson.scripts.postinstall, /prune-unused-register-scheme\.mjs/)
  assert.match(discordRpcUtilSource, /register = app\.setAsDefaultProtocolClient\.bind\(app\)/)
  assert.ok(discordRpcUtilSource.indexOf("require('electron')") < discordRpcUtilSource.indexOf("require('register-scheme')"))
  assert.equal(packageJson.build.mac.x64ArchFiles, undefined)
  assert.equal(packageJson.build.mac.singleArchFiles, undefined)
})

test('keeps Flatpak filesystem permissions scoped to launcher data', () => {
  const finishArgs = packageJson.build.flatpak.finishArgs

  assert.ok(finishArgs.includes('--filesystem=xdg-data/NamLauncher:create'))
  assert.ok(finishArgs.includes('--filesystem=xdg-cache/NamLauncher:create'))
  assert.ok(finishArgs.includes('--filesystem=xdg-download:ro'))
  assert.ok(!finishArgs.includes('--filesystem=home'))
})

test('ships AppImage with a fail-closed Chromium namespace sandbox', () => {
  const addedPatchLines = appBuilderPatch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n')

  assert.equal(packageJson.build.toolsets.appimage, '1.0.3')
  assert.deepEqual(packageJson.build.appImage.executableArgs, [])
  assert.equal(packageJson.build.deb.afterInstall, 'build/linux-after-install.sh')
  assert.equal(packageJson.build.rpm.afterInstall, 'build/linux-after-install.sh')
  assert.equal(packageJson.build.pacman.afterInstall, 'build/linux-after-install.sh')
  assert.match(packageJson.scripts['dist:linux'], /verify-linux-package-sandbox\.mjs/)
  assert.doesNotMatch(addedPatchLines, /--no-sandbox/)
  assert.doesNotMatch(addedPatchLines, /NO_SANDBOX/)
  assert.match(addedPatchLines, /unshare -Ur true/)
  assert.match(addedPatchLines, /exec "\$BIN" --disable-setuid-sandbox/)
  assert.match(addedPatchLines, /exit 126/)
  assert.match(addedPatchLines, /Install the native DEB\/RPM\/Pacman package on restricted systems/)
  assert.match(linuxSandboxVerifier, /assert\.doesNotMatch\(appRun, \/--no-sandbox\//)
  assert.match(linuxSandboxVerifier, /assert\.doesNotMatch\(desktopEntry, \/--no-sandbox\//)
  assert.match(linuxSandboxVerifier, /failClosedProbe\.status, 126/)
  assert.match(linuxSandboxVerifier, /assertNativeInstallScript\(debPostInstall/)
  assert.match(linuxSandboxVerifier, /assertNativeInstallScript\(rpmScripts/)
  assert.match(linuxSandboxVerifier, /assertNativeInstallScript\(pacmanInstall/)
  assert.match(linuxAfterInstall, /chown root:root -- "\$SANDBOX_PATH"/)
  assert.match(linuxAfterInstall, /chmod 4755 -- "\$SANDBOX_PATH"/)
  assert.match(linuxAfterInstall, /0:0:4755/)
  assert.doesNotMatch(linuxAfterInstall, /chmod 0755|unshare --user true/)
  assert.doesNotMatch(linuxAfterInstall, /\$\{[A-Za-z]+\}/)
})

test('defaults Windows builds to per-user installs so automatic updates do not require elevation', () => {
  assert.equal(packageJson.build.nsis.perMachine, false)
  assert.equal(packageJson.build.nsis.oneClick, false)
  assert.equal(packageJson.build.nsis.allowElevation, true)
  assert.equal(packageJson.build.nsis.selectPerMachineByDefault, false)
  assert.equal(packageJson.build.nsis.packElevateHelper, true)
})

test('keeps the launcher window within a supported minimum size', () => {
  assert.match(electronMainSource, /width:\s*1320/)
  assert.match(electronMainSource, /minWidth:\s*1280/)
  assert.match(electronMainSource, /minHeight:\s*720/)
})

test('authenticates every renderer IPC call and ignores dev-server overrides in packaged builds', () => {
  const registeredHandlers = [...electronMainSource.matchAll(/trustedIpcHandle\('/g)].length
  assert.ok(registeredHandlers >= 60)
  assert.equal([...electronMainSource.matchAll(/ipcMain\.handle\(channel/g)].length, 1)
  assert.match(electronMainSource, /const trustedIpcHandle[\s\S]*assertMainRendererInvocation\(event\)/)
  assert.match(electronMainSource, /const devServerUrl = !app\.isPackaged/)
  assert.doesNotMatch(electronMainSource, /if \(process\.env\.VITE_DEV_SERVER_URL\)/)
})

test('refuses plaintext-like Linux safeStorage before persisting Microsoft credentials', () => {
  assert.match(electronMainSource, /safeStorage\.isEncryptionAvailable\(\)/)
  assert.match(electronMainSource, /process\.platform === 'linux'/)
  assert.match(electronMainSource, /safeStorage\.getSelectedStorageBackend\(\) === 'basic_text'/)
  assert.match(electronMainSource, /Microsoft account persistence is disabled/)
})

test('verifies the Windows installer icon before staging release artifacts', () => {
  assert.match(packageJson.scripts['dist:win'], /ensure-installer-icon\.mjs/)
  assert.match(installerIconScript, /IconGroupEntry\.fromEntries/)
  assert.doesNotMatch(installerIconScript, /IconGroupEntry\.replaceIconsForResource/)
  assert.doesNotMatch(installerIconScript, /writeFileSync\(installerPath/)
  assert.match(installerIconScript, /build', 'namlauncher\.ico'/)
})

test('requires and verifies the error report token before packaging installers', () => {
  assert.match(packageJson.scripts['predist:win'], /assert-error-report-token\.mjs/)
  assert.match(packageJson.scripts['predist:linux'], /assert-error-report-token\.mjs/)
  assert.match(packageJson.scripts['dist:win'], /verify-error-report-token-in-build\.mjs/)
  assert.match(packageJson.scripts['dist:linux'], /verify-error-report-token-in-build\.mjs/)
  assert.match(assertReportTokenScript, /NAMLAUNCHER_ERROR_REPORT_TOKEN is required/)
  assert.match(verifyReportTokenScript, /dist-electron/)
  assert.match(verifyReportTokenScript, /source\.includes\(token\)/)
  assert.doesNotMatch(verifyReportTokenScript, /console\.log\(token/)
})

test('keeps runtime window icons loadable outside app.asar', () => {
  assert.ok(packageJson.build.extraResources.some((item) => item.from === 'build/namlauncher.ico' && item.to === 'build/namlauncher.ico'))
  assert.ok(packageJson.build.extraResources.some((item) => item.from === 'NamLauncher-icon.png' && item.to === 'NamLauncher-icon.png'))
  assert.match(electronMainSource, /nativeImage\.createFromPath\(candidate\)/)
  assert.match(electronMainSource, /app\.isPackaged && isAsarPath\(candidate\)/)
  assert.match(electronMainSource, /icon\.image/)
})

test('bounds remote downloads and modpack override extraction', () => {
  assert.match(electronMainSource, /const MAX_CONTENT_DOWNLOAD_BYTES = 1024 \* 1024 \* 1024/)
  assert.match(electronMainSource, /downloadedLength > maxBytes/)
  assert.match(electronMainSource, /const MAX_MODPACK_OVERRIDE_TOTAL_BYTES = 1024 \* 1024 \* 1024/)
  assert.match(electronMainSource, /const MAX_MODPACK_OVERRIDE_ENTRY_BYTES = 256 \* 1024 \* 1024/)
  assert.match(electronMainSource, /const MAX_MODPACK_OVERRIDE_FILES = 20_000/)
  assert.match(electronMainSource, /const MAX_MODPACK_INDEX_BYTES = 8 \* 1024 \* 1024/)
  assert.match(electronMainSource, /preflightModpackOverrideEntries\(entries, 'Modrinth modpack'\)/)
  assert.match(electronMainSource, /preflightModpackOverrideEntries\(entries, 'CurseForge modpack'\)/)
  assert.match(electronMainSource, /getZipEntryDataWithLimit\(entry, MAX_ZIP_METADATA_ENTRY_BYTES/)
  assert.match(electronMainSource, /getZipEntryDataWithLimit\(entry, MAX_MODPACK_INDEX_BYTES, 'Modrinth modpack index'\)/)
  assert.match(electronMainSource, /getZipEntryDataWithLimit\(entry, MAX_MODPACK_INDEX_BYTES, 'CurseForge modpack manifest'\)/)
  assert.match(electronMainSource, /getZipEntryDataWithLimit\(versionEntry, MAX_ZIP_METADATA_ENTRY_BYTES, 'NeoForge version profile'\)/)
  assert.match(electronMainSource, /getDeclaredDownloadLimit\(file\.size\)/)
  assert.match(electronMainSource, /getDeclaredDownloadLimit\(file\.fileSize\)/)
  assert.match(electronMainSource, /getDeclaredDownloadLimit\(file\.fileLength\)/)
})

test('bounds managed Java runtime downloads', () => {
  assert.match(javaManagerSource, /const MAX_JAVA_RUNTIME_ARCHIVE_BYTES = 512 \* 1024 \* 1024/)
  assert.match(javaManagerSource, /size > MAX_JAVA_RUNTIME_ARCHIVE_BYTES/)
  assert.match(javaManagerSource, /downloadedLength > candidate\.size/)
})

test('verifies Adoptium runtime metadata, archive SHA-256, and cached Java executables', () => {
  assert.match(javaManagerSource, /\/v3\/assets\/latest/)
  assert.match(javaManagerSource, /\/v3\/assets\/latest\/\$\{javaVersion\}\/hotspot\?\$\{params\}/)
  assert.match(javaManagerSource, /release_type: releaseType/)
  assert.doesNotMatch(javaManagerSource, /assets\/latest\/\$\{javaVersion\}\/\$\{releaseType\}/)
  assert.match(javaManagerSource, /packageMetadata\?\.checksum/)
  assert.match(javaManagerSource, /actualChecksum !== candidate\.checksum/)
  assert.match(javaManagerSource, /runtime failed Adoptium SHA-256 verification/)
  assert.match(javaManagerSource, /marker\.schemaVersion !== 2/)
  assert.match(javaManagerSource, /actualSha256 === expectedSha256/)
  assert.match(javaManagerSource, /getCompactRuntimeError\(err\)/)
  assert.doesNotMatch(javaManagerSource, /Trying next candidate\.', err\)/)
  assert.doesNotMatch(javaManagerSource, /Local Java .* found by scanning runtime directory/)
})

test('only caches bounded raster images from trusted remote hosts', () => {
  assert.match(electronMainSource, /const MAX_CACHED_IMAGE_BYTES = 1024 \* 1024/)
  assert.match(electronMainSource, /SAFE_CACHED_IMAGE_MIME_TYPES = new Set\(\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]\)/)
  assert.match(electronMainSource, /isSafeCachedImageMimeType\(mimeType\)/)
  assert.match(electronMainSource, /maxBodyLength: MAX_CACHED_IMAGE_BYTES/)
  assert.match(electronMainSource, /maxRedirects: 0/)
  assert.match(electronMainSource, /Boolean\(parsed\.username \|\| parsed\.password\)/)
  assert.match(electronMainSource, /Boolean\(parsed\.port && parsed\.port !== '443'\)/)
  assert.match(electronMainSource, /if \(!isSafeCachedImageMimeType\(mimeType\)\) return ''/)
  assert.match(appSource, /Remote images stay hidden until the sandboxed main process validates/)
  assert.match(appSource, /if \(!src \|\| failed \|\| !resolvedSrc\) return/)
  assert.doesNotMatch(appSource, /src=\{resolvedSrc \|\| src\}/)
})

test('rejects executable Java agent and module injection from custom renderer settings', () => {
  assert.match(electronMainSource, /-javaagent\|-agentlib\|-agentpath\|-Xbootclasspath/)
  assert.match(electronMainSource, /--patch-module\|--upgrade-module-path\|--module-path/)
  assert.match(electronMainSource, /Custom Java arguments cannot load executable agents/)
})

test('verifies Forge and NeoForge executable Maven artifacts before running them', () => {
  assert.match(electronMainSource, /const verifyMavenExecutableArtifact/)
  assert.match(electronMainSource, /`\$\{artifactUrl\}\.sha1`/)
  assert.match(electronMainSource, /failed Maven checksum verification/)
  assert.match(electronMainSource, /verifyMavenExecutableArtifact\(installerUrl, installerPath/)
})
