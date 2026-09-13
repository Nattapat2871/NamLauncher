// Author/creator: nattapat2871 (https://nattapat2871.me)
import test from 'node:test'
import assert from 'node:assert/strict'
import { SharedProviderRequests } from '../electron/sharedProviderRequests.ts'
import { ProviderRequestGate } from '../electron/networkRetry.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('identical active metadata requests share one fetch but completed results are not retained', async () => {
  const shared = new SharedProviderRequests()
  let calls = 0
  const operation = async () => { calls++; await tick(); return { data: 1 } }
  const results = await Promise.all(Array.from({ length: 100 }, () => shared.run('same', operation)))
  assert.equal(calls, 1)
  assert.equal(results.length, 100)
  await shared.run('same', operation)
  assert.equal(calls, 2)
})

test('one cancelled consumer does not interrupt another download metadata consumer', async () => {
  const shared = new SharedProviderRequests(), first = new AbortController()
  let upstreamSignal, release
  const operation = async signal => { upstreamSignal = signal; return new Promise(resolve => { release = resolve }) }
  const a = shared.run('file', operation, first.signal)
  const b = shared.run('file', operation)
  const rejected = assert.rejects(a, { name: 'AbortError' })
  await tick(); first.abort(); await rejected
  assert.equal(upstreamSignal.aborted, false)
  release('ok'); assert.equal(await b, 'ok')
})

test('cancelling all consumers cancels transport and a new consumer gets a fresh job', async () => {
  const shared = new SharedProviderRequests(), controller = new AbortController()
  let aborted = false
  const a = shared.run('file', signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted transport')) }, { once: true })
  }), controller.signal)
  const rejected = assert.rejects(a, { name: 'AbortError' })
  await tick(); controller.abort(); await rejected
  assert.equal(aborted, true)
  assert.equal(await shared.run('file', async () => 'new'), 'new')
})

test('distinct parameters and failed responses do not become a shared success cache', async () => {
  const shared = new SharedProviderRequests()
  await assert.rejects(shared.run('one', async () => { throw new Error('denied') }), /denied/)
  assert.deepEqual(await Promise.all([shared.run('one', async () => 1), shared.run('two', async () => 2)]), [1, 2])
})

test('queued cancellation rejects immediately without waiting for a busy transport', async () => {
  const gate = new ProviderRequestGate(1), controller = new AbortController()
  let release, cancelledJobRan = false
  const active = gate.run(() => new Promise(resolve => { release = resolve }))
  const queued = gate.run(async () => { cancelledJobRan = true }, controller.signal)
  const rejected = assert.rejects(queued, { name: 'AbortError' })
  controller.abort(); await rejected
  assert.equal(cancelledJobRan, false)
  release('done'); await active
  assert.equal(await gate.run(async () => 'slot recovered'), 'slot recovered')
})

test('already cancelled requests do not enter queues or consume transport slots', async () => {
  const controller = new AbortController(); controller.abort()
  const fail = () => { throw new Error('must not run') }
  await assert.rejects(new SharedProviderRequests().run('file', fail, controller.signal), { name: 'AbortError' })
  await assert.rejects(new ProviderRequestGate().run(fail, controller.signal), { name: 'AbortError' })
})

test('cancellation before transport starts does not invoke the operation', async () => {
  const shared = new SharedProviderRequests(), controller = new AbortController()
  let calls = 0
  const pending = shared.run('file', async () => { calls++; return 'old' }, controller.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(); await rejected; await tick()
  assert.equal(calls, 0)
  assert.equal(await shared.run('file', async () => 'fresh'), 'fresh')
})

test('an old aborted transport settling later cannot remove its replacement', async () => {
  const shared = new SharedProviderRequests(), controller = new AbortController()
  let releaseOld, releaseNew, newCalls = 0
  const old = shared.run('file', () => new Promise(resolve => { releaseOld = resolve }), controller.signal)
  const rejected = assert.rejects(old, { name: 'AbortError' })
  await tick(); controller.abort(); await rejected
  const operation = () => { newCalls++; return new Promise(resolve => { releaseNew = resolve }) }
  const replacement = shared.run('file', operation)
  await tick(); releaseOld('old'); await tick()
  const joined = shared.run('file', operation)
  await tick(); assert.equal(newCalls, 1)
  releaseNew('new'); assert.deepEqual(await Promise.all([replacement, joined]), ['new', 'new'])
})

test('pending distinct requests remain bounded and slots recover after completion', async () => {
  const shared = new SharedProviderRequests()
  let release
  const transport = new Promise(resolve => { release = resolve })
  const jobs = Array.from({ length: 256 }, (_, index) => shared.run(String(index), () => transport))
  await assert.rejects(shared.run('overflow', async () => 'unexpected'), /Too many pending/)
  const joined = shared.run('0', () => transport)
  release('ok'); await Promise.all([...jobs, joined])
  assert.equal(await shared.run('recovered', async () => 'new'), 'new')
})
