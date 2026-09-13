// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import test from 'node:test'
import { WindowResponsivenessMonitor } from '../electron/windowResponsiveness.ts'

const fixture = () => {
  let now = 1_000
  let callback = null
  let reports = 0
  const recoveries = []
  const errors = []
  const monitor = new WindowResponsivenessMonitor({
    graceMs: 12_000,
    now: () => now,
    schedule: (next) => { callback = next; return 1 },
    cancel: () => { callback = null },
    onPersistent: () => { reports += 1 },
    onRecovered: (duration, reported) => recoveries.push({ duration, reported }),
    onReportError: (error) => errors.push(error)
  })
  return {
    monitor,
    tick: (milliseconds) => { now += milliseconds },
    fire: () => { const next = callback; callback = null; next?.() },
    state: () => ({ reports, recoveries, errors, scheduled: callback !== null })
  }
}

test('does not report a renderer that recovers inside the grace period', () => {
  const item = fixture()
  item.monitor.markUnresponsive()
  item.tick(2_000)
  item.monitor.markResponsive()
  item.fire()
  assert.deepEqual(item.state(), {
    reports: 0, recoveries: [{ duration: 2_000, reported: false }], errors: [], scheduled: false
  })
})

test('reports one sustained episode and permits a later independent episode', async () => {
  const item = fixture()
  item.monitor.markUnresponsive()
  item.monitor.markUnresponsive()
  item.tick(12_000)
  item.fire()
  await Promise.resolve()
  item.monitor.markUnresponsive()
  assert.equal(item.state().reports, 1)
  item.monitor.markResponsive()
  item.monitor.markUnresponsive()
  item.tick(12_000)
  item.fire()
  await Promise.resolve()
  assert.equal(item.state().reports, 2)
})

test('dispose cancels a pending episode', () => {
  const item = fixture()
  item.monitor.markUnresponsive()
  item.monitor.dispose()
  item.fire()
  assert.equal(item.state().reports, 0)
})

test('routes a synchronous report callback failure to the error handler', async () => {
  let callback = null
  const errors = []
  const monitor = new WindowResponsivenessMonitor({
    graceMs: 1,
    schedule: (next) => { callback = next; return 1 },
    cancel: () => { callback = null },
    onPersistent: () => { throw new Error('report failed') },
    onRecovered: () => undefined,
    onReportError: (error) => errors.push(error)
  })
  monitor.markUnresponsive()
  callback()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /report failed/)
})
