import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSelectedInstanceId } from '../src/instanceSelection.ts'

test('keeps a valid selected instance', () => {
  assert.equal(
    resolveSelectedInstanceId([{ id: 'fabric' }, { id: 'forge' }], 'fabric'),
    'fabric'
  )
})

test('automatically selects the only instance when storage has no selection', () => {
  assert.equal(resolveSelectedInstanceId([{ id: 'fabric' }], null), 'fabric')
})

test('recovers a stale selection when only one instance remains', () => {
  assert.equal(resolveSelectedInstanceId([{ id: 'fabric' }], 'deleted-instance'), 'fabric')
})

test('does not guess when multiple instances exist without a selection', () => {
  assert.equal(resolveSelectedInstanceId([{ id: 'fabric' }, { id: 'forge' }], null), null)
})

test('clears the selection when there are no instances', () => {
  assert.equal(resolveSelectedInstanceId([], 'deleted-instance'), null)
})
