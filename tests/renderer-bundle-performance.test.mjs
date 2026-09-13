// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [appSource, skinPageSource, mainSource, motionFeaturesSource] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkinPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/motionFeatures.ts', import.meta.url), 'utf8')
])

test('defers the DOM animation feature bundle without changing motion components', () => {
  assert.match(mainSource, /import \{ LazyMotion \} from 'framer-motion'/)
  assert.match(mainSource, /import\('\.\/motionFeatures'\)/)
  assert.match(mainSource, /<LazyMotion features=\{loadMotionFeatures\} strict>/)
  assert.match(motionFeaturesSource, /import \{ domAnimation \} from 'framer-motion'/)
  assert.match(appSource, /m as motion/)
  assert.match(skinPageSource, /m as motion/)
  assert.doesNotMatch(appSource, /import \{ AnimatePresence, motion,/)
  assert.doesNotMatch(skinPageSource, /import \{ AnimatePresence, motion \}/)
})
