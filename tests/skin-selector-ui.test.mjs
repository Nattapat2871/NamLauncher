import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skinPage = fs.readFileSync(new URL('../src/components/SkinPage.tsx', import.meta.url), 'utf8')
const skinViewer = fs.readFileSync(new URL('../src/components/SkinViewer.tsx', import.meta.url), 'utf8')
const staticSkinPreview = fs.readFileSync(new URL('../src/components/StaticSkinPreview.tsx', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preload = fs.readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')

test('skin selector uses expandable PNG cards and background selection', () => {
  assert.match(skinPage, /const SkinAccordion =/)
  assert.match(skinPage, /<StaticSkinPreview/)
  assert.match(skinPage, /library\.activeDefaultSkinId/)
  assert.match(skinPage, /bg-\[radial-gradient\(circle_at_50%_16%,rgba\(96,165,250,0\.34\)/)
  assert.doesNotMatch(skinPage, /const SkinFace =/)
})

test('skin selector exposes the built-in default skin collection', () => {
  assert.match(skinPage, /const DEFAULT_SKINS: DefaultSkinOption\[\]/)
  assert.match(skinPage, /title=\{text\.defaults\}/)
  assert.match(skinPage, /DEFAULT_SKINS\.map/)
  assert.match(skinPage, /activateDefaultSkin\(skin\)/)
})

test('default skin activation crosses the Electron boundary through an allowlist', () => {
  assert.match(main, /const DEFAULT_SKIN_PRESETS =/)
  assert.match(main, /const saveDefaultSkinPreset = async/)
  assert.match(main, /accountStore\.activeDefaultSkinId = defaultSkin\.id/)
  assert.match(main, /accountStore\.activeSkinId = null/)
  assert.match(main, /trustedIpcHandle\('save-default-skin-preset'/)
  assert.match(preload, /saveDefaultSkinPreset: .*save-default-skin-preset/)
})

test('offline skin import uses the offline IPC channel', () => {
  assert.match(main, /trustedIpcHandle\('import-offline-skin-by-name'/)
  assert.match(preload, /importOfflineSkinByName: .*import-offline-skin-by-name/)
  assert.doesNotMatch(preload, /importOfflineSkinByName: .*import-skin-by-name'/)
})

test('default skins stay out of the saved library and Microsoft defaults are uploaded to the real profile', () => {
  const defaultActivation = main.slice(
    main.indexOf('const saveDefaultSkinPreset = async'),
    main.indexOf('const importSkinByPlayerName = async')
  )
  assert.doesNotMatch(defaultActivation, /return saveSkinPreset\(/)
  assert.doesNotMatch(defaultActivation, /accountStore\.skins\.unshift/)
  assert.match(defaultActivation, /if \(account\.type === 'msa'\) \{[\s\S]*uploadMinecraftSkin\(account, defaultSkinBuffer, defaultSkin\.model, null, false\)/)
})

test('minecraft profile skin card applies the current skin instead of opening a clone draft', () => {
  assert.match(skinPage, /onSelect=\{\(\) => library\.currentSkin && void activateSkin\(library\.currentSkin\.id\)\}/)
  assert.match(main, /\^minecraft\(\?:-public\)\?:/)
})

test('skin viewer supports non-interactive cropped previews', () => {
  assert.match(skinViewer, /type SkinView3DInstance = import\('skinview3d'\)\.SkinViewer/)
  assert.match(skinViewer, /void import\('skinview3d'\)\.then/)
  assert.match(skinViewer, /controls\?: boolean/)
  assert.match(skinViewer, /zoom\?: number/)
  assert.match(skinViewer, /enableControls: initialProps\.controls/)
  assert.match(skinViewer, /viewerRef\.current\.zoom = zoom/)
})

test('skin cards render one-time PNG previews instead of keeping live WebGL viewers', () => {
  assert.match(staticSkinPreview, /await import\('skinview3d'\)/)
  assert.match(staticSkinPreview, /canvas\.toDataURL\('image\/png'\)/)
  assert.match(staticSkinPreview, /viewer\.dispose\(\)/)
  assert.match(staticSkinPreview, /renderPaused: true/)
  assert.match(staticSkinPreview, /<img src=\{preview\}/)
  assert.doesNotMatch(skinPage, /<SkinViewer[\s\S]*controls=\{false\}/)
})

test('preloads the skin workspace when the user approaches its navigation button', () => {
  assert.match(app, /import React, \{ Suspense, lazy,/)
  assert.match(app, /const loadSkinPageModule = \(\) => import\('\.\/components\/SkinPage'\)/)
  assert.match(app, /const SkinPage = lazy\(loadSkinPageModule\)/)
  assert.match(app, /onPointerEnter={[\s\S]*item\.id === 'skins'[\s\S]*loadSkinPageModule\(\)/)
  assert.match(app, /<Suspense fallback=/)
  assert.match(app, /<Loader2 size=\{17\} className="animate-spin text-blue-300" \/>/)
})
