// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import { getFallbackJavaMajorVersion } from '../shared/minecraftJavaVersion.ts'

test('uses Java 25 for calendar-versioned Minecraft 26.x without Mojang metadata', () => {
  assert.equal(getFallbackJavaMajorVersion('26.1'), 25)
  assert.equal(getFallbackJavaMajorVersion('26.2'), 25)
  assert.equal(getFallbackJavaMajorVersion('27.1'), 25)
})

test('preserves legacy Minecraft Java fallback mappings', () => {
  assert.equal(getFallbackJavaMajorVersion('1.16.5'), 8)
  assert.equal(getFallbackJavaMajorVersion('1.17.1'), 16)
  assert.equal(getFallbackJavaMajorVersion('1.20.4'), 17)
  assert.equal(getFallbackJavaMajorVersion('1.21.11'), 21)
})
