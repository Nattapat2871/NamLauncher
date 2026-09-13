// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import { selectHomeDiscoveryProjects } from '../electron/homeDiscovery.ts'

const lane = (name, prefix, count = 8) => ({
  lane: name,
  hits: Array.from({ length: count }, (_, index) => ({
    project_id: `${prefix}-${index}`,
    title: `${prefix} ${index}`
  }))
})

test('home discovery is stable for a launcher session and mixes all healthy lanes', () => {
  const input = [lane('popular', 'p'), lane('updated', 'u'), lane('newest', 'n')]
  const first = selectHomeDiscoveryProjects(input, 'session-one')
  const second = selectHomeDiscoveryProjects(input, 'session-one')

  assert.deepEqual(first, second)
  assert.equal(first.length, 6)
  assert.deepEqual(
    Object.fromEntries(['popular', 'updated', 'newest'].map((name) => [
      name,
      first.filter((project) => project.discovery_lane === name).length
    ])),
    { popular: 2, updated: 2, newest: 2 }
  )
})

test('home discovery deduplicates projects and fills from remaining healthy lanes', () => {
  const input = [
    { lane: 'popular', hits: [{ project_id: 'shared' }] },
    { lane: 'updated', hits: [{ project_id: 'shared' }, { project_id: 'updated-only' }] },
    lane('newest', 'new')
  ]
  const result = selectHomeDiscoveryProjects(input, 'fallback-session')

  assert.equal(result.length, 6)
  assert.equal(result.filter((project) => project.project_id === 'shared').length, 1)
  assert.equal(new Set(result.map((project) => project.project_id)).size, result.length)
})
