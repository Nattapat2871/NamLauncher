// Author/creator: nattapat2871 (https://nattapat2871.me)
import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { ProviderRequestGate, retryAfterMilliseconds } from '../electron/networkRetry.ts'
import { startLauncherDiscordLink, waitForLauncherDiscordLink } from '../electron/launcherDiscordAuth.ts'

test('Retry-After honors long cooldowns and HTTP dates without retrying early', () => {
  assert.equal(retryAfterMilliseconds('600', 500), 600000)
  assert.equal(retryAfterMilliseconds('Fri, 04 Sep 2026 00:01:00 GMT', 500, Date.parse('2026-09-04T00:00:00Z')), 60000)
  assert.equal(retryAfterMilliseconds('invalid', 500), 500)
  assert.equal(retryAfterMilliseconds('-1', 500), 500)
})

test('provider queue bounds concurrency and shares 429 cooldown across queued requests', async () => {
  let now = 0, active = 0, peak = 0, calls = 0
  const gate = new ProviderRequestGate(2, () => now)
  const rateError = new Error('rate limited')
  const jobs = Array.from({ length: 20 }, (_, i) => gate.run(async () => {
    calls++; active++; peak = Math.max(peak, active)
    await new Promise(resolve => setImmediate(resolve))
    active--
    if (i === 0) { gate.defer(600000, rateError); throw rateError }
    return i
  }))
  const results = await Promise.allSettled(jobs)
  assert.equal(peak, 2)
  assert.equal(calls, 2)
  assert.equal(results.filter(r => r.status === 'rejected').length, 19)
  await assert.rejects(gate.run(async () => { calls++ }), /rate limited/)
  now = 600001
  assert.equal(await gate.run(async () => 'recovered'), 'recovered')
})

test('Discord start retries a transient timeout and still rejects an unsafe authorization destination', async () => {
  const previous = axios.defaults.adapter
  let calls = 0, now = 0
  axios.defaults.adapter = async config => {
    if (++calls === 1) throw new axios.AxiosError('timeout', 'ECONNABORTED', config)
    return { status: 200, headers: {}, config, data: { authorize_url: 'https://attacker.invalid/oauth2/authorize', request_token: 't'.repeat(64) } }
  }
  try {
    await assert.rejects(startLauncherDiscordLink('https://example.invalid', 'test', {
      now: () => now, sleep: async ms => { now += ms }
    }), /unsafe Discord authorization URL/)
    assert.equal(calls, 2)
  } finally { axios.defaults.adapter = previous }
})

test('Discord polling survives timeouts and 429, honors server cooldown and preserves one transaction', async () => {
  const previous = axios.defaults.adapter
  let now = 0, calls = 0
  const waits = []
  axios.defaults.adapter = async config => {
    calls++
    assert.match(config.url, /\/discord\/poll$/)
    assert.equal(JSON.parse(config.data).request_token, 't'.repeat(64))
    if (calls === 1) throw new axios.AxiosError('timeout', 'ECONNABORTED', config)
    if (calls === 2) throw new axios.AxiosError('rate limited', 'ERR_BAD_REQUEST', config, {}, { status: 429, headers: { 'retry-after': '40' } })
    return { status: 200, headers: {}, config, data: calls === 3 ? { status: 'pending' } : {
      status: 'authorized', session_token: 's'.repeat(64), profile: { id: '123456789012345678', username: 'Player', display_name: 'Player', avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png' }
    } }
  }
  try {
    const result = await waitForLauncherDiscordLink('https://example.invalid', 'test-token', 't'.repeat(64), 120000,
      { now: () => now, sleep: async ms => { waits.push(ms); now += ms } })
    assert.equal(result.profile.username, 'Player')
    assert.deepEqual(waits, [2000, 40000, 2500])
    assert.equal(calls, 4)
  } finally { axios.defaults.adapter = previous }
})

test('Discord cannot busy-loop or exceed its deadline on long cooldowns and does not retry authentication rejection', async () => {
  const previous = axios.defaults.adapter
  try {
    for (const status of [429, 401]) {
      let calls = 0
      axios.defaults.adapter = async config => {
        calls++
        throw new axios.AxiosError('rejected', 'ERR_BAD_REQUEST', config, {}, { status, headers: { 'retry-after': '600' } })
      }
      await assert.rejects(waitForLauncherDiscordLink('https://example.invalid', 'test', 't'.repeat(64), 30000,
        { now: () => 0, sleep: async () => { throw new Error('must not sleep') } }))
      assert.equal(calls, 1)
    }
  } finally { axios.defaults.adapter = previous }
})

test('known user validation failures do not become launcher bug reports, but genuine errors still do', async () => {
  const source = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('const isExpectedUserFacingError ='), source.indexOf('const isExplicitUserCancellation ='))
  const code = stripTypeScriptTypes(body) + '\nreturn isExpectedUserFacingError;'
  const classify = new Function('isOfflineUsernameValidationError', 'isExpectedLauncherUpdateBlockMessage', code)(() => false, () => false)
  for (const [channel, message] of [
    ['save-skin-preset', 'Skin texture must be a PNG file.'],
    ['import-skin-by-name', 'Enter a Minecraft player name or a valid NameMC profile link.'],
    ['toggle-instance-content', 'Stop Minecraft before changing mods in this instance.'],
    ['toggle-instance-content', 'Content file was not found.'],
    ['login-microsoft', "Error invoking remote method 'login-microsoft': Error: The account doesn't have an Xbox account."],
    ['login-microsoft', 'Error invoking remote method: Error: The account does not have an Xbox account.'],
    ['install-curseforge-content', "Error invoking remote method 'install-curseforge-content': Error: The NamLauncher CurseForge service is busy. Please wait a moment and try again."]
  ]) {
    assert.equal(classify(`ipc:${channel}`, message), true)
    assert.equal(classify(`ipc:${channel}`, 'EACCES: unexpected persistence failure'), false)
    assert.equal(classify('renderer:error', message), false)
  }
  assert.equal(classify('ipc:login-microsoft', 'EACCES: unexpected secure-storage failure'), false)
  assert.equal(classify('ipc:save-settings', 'The NamLauncher CurseForge service is busy. Please wait a moment and try again.'), false)
})

test('missing Xbox profiles receive actionable Microsoft login guidance', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('const getMicrosoftLoginFailureMessage ='), source.indexOf('const normalizeSkinModel ='))
  const resolveFailure = new Function(`${stripTypeScriptTypes(body)}\nreturn getMicrosoftLoginFailureMessage;`)()
  for (const reason of [
    "The account doesn't have an Xbox account.",
    'The account does not have an Xbox account.',
    'Could not log into Xbox Live'
  ]) {
    assert.match(resolveFailure({ reason }), /Open the Xbox app or xbox\.com once/)
  }
  assert.equal(resolveFailure({ reason: 'EACCES: secure storage unavailable' }), 'EACCES: secure storage unavailable')
})

test('captures a bounded current-launch console tail when bootstrap fails before latest.log exists', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  assert.match(source, /let launchProcessOutputTail = ''/)
  assert.match(source, /launchProcessOutputTail = .*\.slice\(-64 \* 1024\)/)
  assert.match(source, /Current launch stdout\/stderr/)
  assert.match(source, /buildDiagnosticExcerpt\(launchProcessOutputTail, 12, 80\), 12000/)
})
