import assert from 'node:assert/strict'
import test from 'node:test'

import { filterInstanceContent } from '../src/instanceContentSearch.ts'

const content = [
  {
    name: 'Sodium',
    fileName: 'sodium-fabric-0.6.0.jar',
    enabledFileName: 'sodium-fabric-0.6.0.jar',
    versionNumber: '0.6.0'
  },
  {
    name: 'Fresh Animations',
    fileName: 'FreshAnimations_v1.9.zip.disabled',
    enabledFileName: 'FreshAnimations_v1.9.zip',
    versionNumber: '1.9'
  }
]

test('finds installed content by display name without case sensitivity', () => {
  assert.deepEqual(filterInstanceContent(content, '  SODIUM  '), [content[0]])
})

test('finds installed content by enabled filename and version', () => {
  assert.deepEqual(filterInstanceContent(content, 'FreshAnimations_v1.9.zip'), [content[1]])
  assert.deepEqual(filterInstanceContent(content, '0.6.0'), [content[0]])
})

test('returns the original list for an empty query', () => {
  assert.equal(filterInstanceContent(content, '   '), content)
})
