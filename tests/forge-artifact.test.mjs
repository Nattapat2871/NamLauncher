// Author/creator: nattapat2871 (https://nattapat2871.me)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { getForgeArtifactCoordinates } from '../electron/minecraft/forgeArtifact.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('tries the legacy repeated Minecraft coordinate for Forge 1.7.10 build 1614', () => {
  assert.deepEqual(getForgeArtifactCoordinates('1.7.10', '10.13.4.1614'), [
    '1.7.10-10.13.4.1614',
    '1.7.10-10.13.4.1614-1.7.10'
  ])
})

test('rejects unsafe Forge coordinate characters', () => {
  assert.throws(() => getForgeArtifactCoordinates('1.7.10', '../bad'), /unsupported characters/)
})

test('checks official installer and universal artifacts with pinned Maven SHA-1 verification', () => {
  assert.match(mainSource, /getForgeArtifactCoordinates\(safeMinecraftVersion, forgeVersion\)/)
  assert.match(mainSource, /\['installer', 'universal'\]/)
  assert.match(mainSource, /verifyMavenExecutableArtifact\(/)
})
