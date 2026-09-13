// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasUsableLocalLanEndpoint,
  mergeLanServerSummaries,
  resolveLanDiscoveryViewState
} from '../shared/lanPresentation.ts'

test('merges remote and local LAN results, deduplicates endpoints, and keeps local entries first', () => {
  assert.deepEqual(
    mergeLanServerSummaries([
      { address: '192.168.1.20', port: 51_234, endpoint: '192.168.1.20:51234' },
      { address: '192.168.1.10', port: 51_235, endpoint: '192.168.1.10:51235' }
    ], {
      addresses: ['192.168.1.20'],
      detectedPort: 51_234
    }),
    [
      { address: '192.168.1.20', port: 51_234, endpoint: '192.168.1.20:51234', local: true },
      { address: '192.168.1.10', port: 51_235, endpoint: '192.168.1.10:51235', local: false }
    ]
  )
})

test('supports remote-only, local-only, and empty LAN result sets', () => {
  const remote = { address: '10.0.0.8', port: 25_565, endpoint: '10.0.0.8:25565' }
  assert.deepEqual(mergeLanServerSummaries([remote], null), [{ ...remote, local: false }])
  assert.deepEqual(mergeLanServerSummaries([], {
    addresses: ['192.168.1.5'],
    detectedPort: 54_321
  }), [{ address: '192.168.1.5', port: 54_321, endpoint: '192.168.1.5:54321', local: true }])
  assert.deepEqual(mergeLanServerSummaries([], { addresses: ['192.168.1.5'], detectedPort: null }), [])
})

test('resolves every visible LAN discovery state with safe precedence', () => {
  assert.equal(resolveLanDiscoveryViewState({ loading: true, hasError: true, resultCount: 0 }), 'error')
  assert.equal(resolveLanDiscoveryViewState({ loading: true, hasError: false, resultCount: 0 }), 'loading')
  assert.equal(resolveLanDiscoveryViewState({ loading: true, hasError: false, resultCount: 1 }), 'found')
  assert.equal(resolveLanDiscoveryViewState({ loading: false, hasError: false, resultCount: 1 }), 'found')
  assert.equal(resolveLanDiscoveryViewState({ loading: false, hasError: false, resultCount: 0 }), 'empty')
})

test('requires both a private address and a temporary port before treating local LAN data as usable', () => {
  assert.equal(hasUsableLocalLanEndpoint(null), false)
  assert.equal(hasUsableLocalLanEndpoint({ addresses: [], detectedPort: 54_321 }), false)
  assert.equal(hasUsableLocalLanEndpoint({ addresses: ['192.168.1.5'], detectedPort: null }), false)
  assert.equal(hasUsableLocalLanEndpoint({ addresses: ['192.168.1.5'], detectedPort: 54_321 }), true)
})
