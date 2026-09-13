import assert from 'node:assert/strict'
// Author/creator: nattapat2871 (https://nattapat2871.me)
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('dismisses non-critical dialogs only when their backdrop itself is clicked', () => {
  assert.match(appSource, /showLoginModal[\s\S]*event\.target === event\.currentTarget[\s\S]*setShowLoginModal\(false\)/)
  assert.match(appSource, /showModpackModal[\s\S]*event\.target !== event\.currentTarget\) return[\s\S]*if \(installingCurrentModpack\) \{[\s\S]*minimizeActiveModpackInstall\(\)/)
  assert.match(appSource, /showInstanceModal[\s\S]*event\.target !== event\.currentTarget\) return[\s\S]*if \(!importingMrpack\) setShowInstanceModal\(false\)/)
  assert.match(appSource, /if \(importingMrpack\) \{[\s\S]*cancelActiveInstall\(\)[\s\S]*aria-label=\{importingMrpack \? t\('mrpack\.progress\.cancel'\)/)
})

test('keeps first-run legal acceptance and error reports protected from backdrop dismissal', () => {
  const errorOverlay = appSource.slice(appSource.indexOf('const launcherErrorModal'), appSource.indexOf('if (!bootReady)'))
  const legalOverlay = appSource.slice(appSource.indexOf('{(showFirstRunSetup || showLegalReview) && ('), appSource.indexOf('{showLoginModal && ('))
  assert.doesNotMatch(errorOverlay, /event\.target === event\.currentTarget/)
  assert.match(legalOverlay, /!showFirstRunSetup && event\.target === event\.currentTarget/)
  assert.match(legalOverlay, /setShowLegalReview\(false\)/)
})
