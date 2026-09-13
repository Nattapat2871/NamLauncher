// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const cardSource = await readFile(new URL('../src/components/ModpackInstallActivityCard.tsx', import.meta.url), 'utf8')
const textSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('minimizing an active modpack install keeps the install task running', () => {
  const minimizeStart = appSource.indexOf('const minimizeActiveModpackInstall')
  const restoreStart = appSource.indexOf('const restoreModpackInstall', minimizeStart)
  assert.ok(minimizeStart >= 0 && restoreStart > minimizeStart)

  const minimizeSource = appSource.slice(minimizeStart, restoreStart)
  assert.match(minimizeSource, /setShowModpackModal\(false\)/)
  assert.match(minimizeSource, /minimized:\s*true/)
  assert.doesNotMatch(minimizeSource, /cancelInstallTask|cancelActiveInstall/)
})

test('the minimized install card can restore details and reports bounded progress', () => {
  assert.match(appSource, /<ModpackInstallActivityCard/)
  assert.match(appSource, /icon=\{modpackInstallActivity\.iconUrl \? \([\s\S]*<CachedImage/)
  assert.match(appSource, /onRestore=\{restoreModpackInstall\}/)
  assert.doesNotMatch(cardSource, /<img\s+src=\{activity\.iconUrl\}/)
  assert.match(cardSource, /role="progressbar"/)
  assert.match(cardSource, /aria-valuemin=\{0\}/)
  assert.match(cardSource, /aria-valuemax=\{100\}/)
  assert.match(cardSource, /Math\.min\(Math\.max\(Math\.round\(value\), 0\), 100\)/)
})

test('a background completion does not pull the user away from the page they are using', () => {
  assert.match(appSource, /const modpackInstallMinimizedRef = useRef\(false\)/)
  assert.match(appSource, /shouldOpenInstance:\s*\(\) => !modpackInstallMinimizedRef\.current/)
  assert.match(appSource, /if \(options\.shouldOpenInstance\?\.\(\) \?\? true\) \{[\s\S]*setActiveView\('instances'\)/)
})

test('background modpack work blocks competing content installs from stealing its progress', () => {
  assert.match(appSource, /if \(modpackInstallActivity\?\.phase === 'installing'\) \{[\s\S]*setStatusText\(t\('modpack\.install\.alreadyRunning'\)\)/)
  assert.match(appSource, /if \(installingProjectId \|\| modpackInstallActivity\?\.phase === 'installing'\) \{[\s\S]*content\.install\.anotherRunning/)
  assert.match(appSource, /disabled=\{!selectedModpackVersionId \|\| Boolean\(installingProjectId\) \|\| Boolean\(activeInstallTaskId\)\}/)
})

test('completion remains visible briefly and then exits toward the right', () => {
  assert.match(appSource, /phase:\s*'success'/)
  assert.match(appSource, /}, 2800\)/)
  assert.match(cardSource, /exit=\{reduceMotion \? \{ opacity: 0 \} : \{ opacity: 0, x: 72/)
  assert.match(cardSource, /transition=\{\{ duration: reduceMotion \? 0\.1 : 0\.22/)
})

test('CurseForge manual-download items reopen as the existing global file list', () => {
  assert.match(appSource, /const manualDownloads = result\.manualDownloads \|\| \[\][\s\S]*setManualDownloadItems\(manualDownloads\)/)
  assert.match(appSource, /\{manualDownloadItems\.length > 0 && manualDownloadInstance && \(/)
  assert.match(appSource, /detail: result\.manualDownloads\?\.length[\s\S]*tf\('manualDownload\.needBrowser'/)
})

test('cancel remains a separate explicit action and background-install copy is bilingual', () => {
  assert.match(appSource, /onClick=\{\(\) => cancelActiveInstall\(\)\}/)
  assert.ok((textSource.match(/'modpack\.install\.backgroundHint'/g) || []).length >= 2)
  assert.ok((textSource.match(/'modpack\.install\.minimizeTooltip'/g) || []).length >= 2)
  assert.ok((textSource.match(/'modpack\.install\.completedDetail'/g) || []).length >= 2)
  assert.match(textSource, /ซ่อนหน้าต่างนี้เพื่อใช้งานหน้าอื่นได้/)
})
