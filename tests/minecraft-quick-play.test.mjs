// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createServerQuickPlay,
  createWorldQuickPlay,
  supportsModernMinecraftQuickPlay
} from '../electron/minecraft/quickPlay.ts'
import { normalizeMinecraftServerEndpoint } from '../electron/minecraft/serverEndpoint.ts'

test('uses modern quick play for Minecraft 1.20+, including calendar versions', () => {
  assert.equal(supportsModernMinecraftQuickPlay('1.19.4'), false)
  assert.equal(supportsModernMinecraftQuickPlay('1.20'), true)
  assert.equal(supportsModernMinecraftQuickPlay('1.21.8'), true)
  assert.equal(supportsModernMinecraftQuickPlay('24w14a'), true)
  assert.equal(supportsModernMinecraftQuickPlay('23w13a_or_b'), false)
  assert.equal(supportsModernMinecraftQuickPlay('23w14a'), true)
  assert.equal(supportsModernMinecraftQuickPlay('26.1'), true)
  assert.deepEqual(createWorldQuickPlay('New World', '1.21.8'), {
    type: 'singleplayer',
    identifier: 'New World'
  })
  assert.equal(createWorldQuickPlay('Old World', '1.19.4'), null)
})

test('uses safe legacy server flags before 1.20 and declines unsupported legacy IPv6', () => {
  assert.deepEqual(
    createServerQuickPlay(normalizeMinecraftServerEndpoint('play.minisand.online'), '1.19.4'),
    { type: 'legacy', identifier: 'play.minisand.online' }
  )
  assert.deepEqual(
    createServerQuickPlay(normalizeMinecraftServerEndpoint('example.com:25566'), '1.19.4'),
    { type: 'legacy', identifier: 'example.com:25566' }
  )
  assert.equal(
    createServerQuickPlay(normalizeMinecraftServerEndpoint('[2001:db8::1]:25566'), '1.19.4'),
    null
  )
  assert.deepEqual(
    createServerQuickPlay(normalizeMinecraftServerEndpoint('[2001:db8::1]:25566'), '1.20.1'),
    { type: 'multiplayer', identifier: '[2001:db8::1]:25566' }
  )
})
