// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const loaderIconSource = await readFile(new URL('../src/components/LoaderIcon.tsx', import.meta.url), 'utf8')
const loaderArtworkNotice = await readFile(new URL('../src/assets/loader-icons/NOTICE.md', import.meta.url), 'utf8')

test('library exposes a localized internal project page before the direct install action', () => {
  assert.match(appTextSource, /'library\.button\.openProject': 'เปิดหน้ามอด'/)
  assert.match(appTextSource, /'library\.button\.install': 'ติดตั้ง'/)
  assert.match(appSource, /onClick=\{\(event\) => void openLibraryProjectDetails\(mod, event\.currentTarget\)\}/)
  assert.match(appSource, /\{t\('library\.button\.openProject'\)\}[\s\S]*onClick=\{\(\) => installLibraryProject\(mod\)\}/)
  assert.doesNotMatch(appSource, /return \{ kind: 'install', label: 'Install'/)
})

test('project detail dialog lists compatible versions and installs the selected immutable id', () => {
  assert.match(appSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*library-project-detail-title/)
  assert.match(appSource, /selectedLibraryVersionId/)
  assert.match(appSource, /installSelectedLibraryVersion/)
  assert.match(appSource, /installLibraryProject\(libraryProjectDetails, selectedLibraryVersionId\)/)
  assert.match(appSource, /versionId: selectedVersionId \|\| undefined/)
  assert.match(appSource, /fileId: selectedVersionId \|\| undefined/)
  assert.match(appSource, /event\.key === 'Escape'[\s\S]*closeLibraryProjectDetails/)
  assert.match(appSource, /const trigger = libraryProjectTriggerRef\.current[\s\S]*trigger\?\.focus/)
})

test('provider version endpoints are exposed and exact files are selected only from the compatible set', () => {
  assert.match(preloadSource, /getCurseForgeProjectVersions: \(options: any\) => invoke\('get-curseforge-project-versions'/)
  assert.match(mainSource, /trustedIpcHandle\('get-curseforge-project-versions'/)
  assert.match(mainSource, /const getCurseForgeProjectVersions = async/)
  assert.match(mainSource, /compatibleFiles\.find\(\(candidate\) => candidate\.id === requestedFileId\)/)
  assert.match(mainSource, /versions\.find\(\(candidate\) => candidate\.id === requestedVersionId\)/)
  assert.match(mainSource, /Selected Modrinth version is not compatible/)
  assert.match(mainSource, /Selected CurseForge file is not compatible/)
})

test('loader identity uses locally packaged official artwork instead of generated or emoji marks', () => {
  const loaderAssets = {
    vanilla: 'svg',
    fabric: 'png',
    forge: 'ico',
    neoforge: 'png',
    quilt: 'svg'
  }
  for (const [loader, extension] of Object.entries(loaderAssets)) {
    assert.match(loaderIconSource, new RegExp(`import ${loader}Icon from '../assets/loader-icons/${loader}\\.${extension}'`))
    assert.match(loaderArtworkNotice, new RegExp('- `' + loader + '\\.' + extension + '`'))
  }
  assert.doesNotMatch(loaderIconSource, /(?:src|href)=['"]https?:\/\//)
  assert.doesNotMatch(loaderIconSource, /linearGradient|<path|emoji/i)
  assert.doesNotMatch(loaderIconSource, /bg-slate-100/)
  assert.match(loaderIconSource, /draggable=\{false\}/)
  assert.match(appSource, /<LoaderIcon loader=\{loader\}/)
  assert.match(appSource, /<LoaderIcon loader=\{currentTarget\.loader\}/)
})
