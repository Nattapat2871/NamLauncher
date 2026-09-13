// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LAUNCHER_UPDATE_CLEANUP_MAX_ATTEMPTS,
  getLauncherUpdateCleanupRetryDelay
} from '../shared/launcherUpdateCleanup.ts'

test('retries transient Windows installer locks with bounded exponential backoff', () => {
  assert.equal(getLauncherUpdateCleanupRetryDelay({ code: 'EPERM' }, 1), 500)
  assert.equal(getLauncherUpdateCleanupRetryDelay({ code: 'EBUSY' }, 2), 1_000)
  assert.equal(getLauncherUpdateCleanupRetryDelay({ code: 'eacces' }, 5), 5_000)
})

test('does not retry permanent errors or exceed the cleanup attempt limit', () => {
  assert.equal(getLauncherUpdateCleanupRetryDelay({ code: 'EINVAL' }, 1), null)
  assert.equal(getLauncherUpdateCleanupRetryDelay(new Error('unknown failure'), 1), null)
  assert.equal(
    getLauncherUpdateCleanupRetryDelay({ code: 'EPERM' }, LAUNCHER_UPDATE_CLEANUP_MAX_ATTEMPTS),
    null
  )
  assert.equal(getLauncherUpdateCleanupRetryDelay({ code: 'EPERM' }, 0), null)
})
