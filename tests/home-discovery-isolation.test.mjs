// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('home discovery does not cancel an interactive Modrinth library search', () => {
  assert.match(mainSource, /trustedIpcHandle\('get-home-modpacks',[\s\S]*Promise\.allSettled[\s\S]*searchModrinthProjects\(\{[\s\S]*projectType: 'modpack',[\s\S]*limit: 18/)
  assert.match(mainSource, /\{ lane: 'popular', index: 'downloads' \}[\s\S]*\{ lane: 'updated', index: 'updated' \}[\s\S]*\{ lane: 'newest', index: 'newest' \}/)
  assert.match(mainSource, /selectHomeDiscoveryProjects\(healthyResults, HOME_DISCOVERY_SESSION_SEED\)/)
  assert.match(preloadSource, /getHomeModpacks: \(\) => invoke\('get-home-modpacks'\)/)
  const homeHandler = mainSource.match(/trustedIpcHandle\('get-home-modpacks',[\s\S]*?\n\}\)\n\ntrustedIpcHandle\('search-modrinth'/)?.[0] || ''
  assert.doesNotMatch(homeHandler, /activeModrinthSearchController|AbortController/)
})

test('home discovery copy explains that results include fresh and updated projects', () => {
  assert.match(appTextSource, /A shuffled mix of popular, recently updated, and new Modrinth packs\./)
  assert.match(appTextSource, /สุ่มผสมม็อดแพ็กยอดนิยม อัปเดตล่าสุด และม็อดแพ็กใหม่จาก Modrinth/)
  assert.doesNotMatch(appTextSource, /The most downloaded modpacks on Modrinth\./)
})
