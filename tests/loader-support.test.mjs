import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getNeoForgeVersionPrefix,
  normalizeLoader,
  parseNeoForgeMetadata,
  sortLoaderVersions
} from '../electron/loaderSupport.ts'

test('normalizes every supported loader without downgrading Quilt or NeoForge', () => {
  for (const loader of ['vanilla', 'fabric', 'forge', 'quilt', 'neoforge']) {
    assert.equal(normalizeLoader(loader), loader)
  }
  assert.equal(normalizeLoader('unknown'), 'vanilla')
})

test('maps modern Minecraft versions to the NeoForge artifact prefix', () => {
  assert.equal(getNeoForgeVersionPrefix('1.20.2'), '20.2.')
  assert.equal(getNeoForgeVersionPrefix('1.21'), '21.0.')
  assert.equal(getNeoForgeVersionPrefix('1.21.5'), '21.5.')
  assert.equal(getNeoForgeVersionPrefix('26.1'), '26.1.0.')
  assert.equal(getNeoForgeVersionPrefix('26.1.2'), '26.1.2.')
  assert.equal(getNeoForgeVersionPrefix('26.2'), '26.2.0.')
  assert.equal(getNeoForgeVersionPrefix('release-1.21.5'), null)
})

test('filters and prioritizes stable NeoForge builds for the requested Minecraft version', () => {
  const metadata = '<versions><version>21.4.10</version><version>21.5.2-beta</version><version>21.5.1</version><version>21.5.3</version></versions>'
  assert.deepEqual(parseNeoForgeMetadata(metadata, '1.21.5'), [
    { id: '21.5.3', type: 'stable' },
    { id: '21.5.1', type: 'stable' },
    { id: '21.5.2-beta', type: 'unstable' }
  ])
})

test('filters calendar-versioned NeoForge builds for Minecraft 26.x', () => {
  const metadata = '<versions><version>26.1.1.16-beta</version><version>26.1.2.75</version><version>26.1.2.76</version><version>26.2.0.6-beta</version></versions>'
  assert.deepEqual(parseNeoForgeMetadata(metadata, '26.1.2'), [
    { id: '26.1.2.76', type: 'stable' },
    { id: '26.1.2.75', type: 'stable' }
  ])
})

test('sorts Quilt builds with stable releases before prereleases', () => {
  assert.deepEqual(sortLoaderVersions(['0.30.0-beta.8', '0.29.1', '0.29.2']), [
    { id: '0.29.2', type: 'stable' },
    { id: '0.29.1', type: 'stable' },
    { id: '0.30.0-beta.8', type: 'unstable' }
  ])
})
