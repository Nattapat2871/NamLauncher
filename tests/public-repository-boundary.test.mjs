// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const prepareSource = await readFile(
  new URL('../scripts/prepare-game-bridge.mjs', import.meta.url),
  'utf8'
)

test('public launcher checkout excludes private Minecraft companion source', async () => {
  await assert.rejects(access(new URL('../game-bridge/', import.meta.url)))
  await assert.rejects(access(new URL('../game-companions/', import.meta.url)))
})

test('public bundle preparation verifies artifacts without an embedded mod build', () => {
  assert.match(prepareSource, /NAMLAUNCHER_COMPANIONS_SOURCE/)
  assert.match(prepareSource, /Game companion integrity verification failed/)
  assert.match(prepareSource, /artifact\.sha256/)
  assert.doesNotMatch(prepareSource, /GradleWrapperMain|buildProject|game-companions\//)
})
