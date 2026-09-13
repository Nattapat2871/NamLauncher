// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const pingSelectionSource = await readFile(new URL('../electron/minecraft/serverPingSelection.ts', import.meta.url), 'utf8')

test('provisions partner servers through every instance creation path', () => {
  assert.match(mainSource, /const provisionInstanceDefaults = async[\s\S]*provisionThaiResourcePack[\s\S]*provisionPartnerServers/)
  assert.equal((mainSource.match(/await provisionInstanceDefaults\(instance\)/g) || []).length, 2)
  assert.match(mainSource, /withInstanceServerListMutation\(instance, \(\) => provisionInstanceDefaults\(instance\)\)/)
  assert.match(appSource, /await window\.electron\.provisionInstance\(instance\)[\s\S]*setInstances\(\(prev\) => \[\.\.\.prev, instance\]\)/)
  assert.match(mainSource, /PARTNER_SERVERS_MARKER/)
  assert.match(mainSource, /const instanceHasAllPartnerServers = async/)
  assert.match(mainSource, /PARTNER_SERVERS\.every\(\(partner\) =>/)
  assert.match(mainSource, /marker\.revision === PARTNER_SERVER_REVISION && await instanceHasAllPartnerServers\(serversPath\)/)
  assert.match(mainSource, /mergePartnerServersDat\(serversPath\)/)
})

test('exposes bounded instance places operations and validates quick play targets', () => {
  for (const channel of [
    'get-instance-places',
    'ping-instance-servers',
    'add-instance-server',
    'remove-instance-server'
  ]) {
    assert.match(mainSource, new RegExp(`trustedIpcHandle\\('${channel}'`))
    assert.match(preloadSource, new RegExp(`invoke\\('${channel}'`))
  }
  assert.match(mainSource, /mapWithConcurrency\(targets, 8/)
  assert.match(pingSelectionSource, /MAX_INSTANCE_SERVER_PINGS = 60/)
  assert.match(pingSelectionSource, /MAX_FILTERED_INSTANCE_SERVER_PINGS = 4/)
  assert.match(mainSource, /selectMinecraftServerPingTargets\(await readInstanceServers\(instance\), request\.addresses\)/)
  assert.match(mainSource, /timeoutMs: 2_500/)
  assert.match(mainSource, /assertInstanceServerListMutable\(instance\)/)
  assert.match(mainSource, /activeInstanceServerMutations\.add\(instance\.id\)/)
  assert.match(mainSource, /activeInstanceServerMutations\.delete\(instance\.id\)/)
  assert.match(mainSource, /Wait for the current server-list update to finish before launching Minecraft/)
  assert.match(mainSource, /Stop Minecraft before changing servers in this instance/)
  assert.doesNotMatch(mainSource, /const getInstancePlaces = async[\s\S]*?await provisionPartnerServers\(instance\)[\s\S]*?const mapWithConcurrency/)
  assert.match(mainSource, /validateQuickPlayRequest\(request, instance\)/)
  assert.match(mainSource, /servers\.some\(\(server\) => server\.canonicalKey === endpoint\.canonicalKey\)/)
  assert.match(mainSource, /worlds\.worlds\.some\(\(world\) => world\.folderName === folderName\)/)
  assert.match(mainSource, /\.\.\.\(quickPlayOption \? \{ quickPlay: quickPlayOption \} : \{\}\)/)
})

test('allows only the requested partner websites through the external URL boundary', () => {
  for (const host of [
    'minisand.online',
    'namcraft.nattapat2871.me',
    'tdblock.online'
  ]) {
    assert.ok(mainSource.includes(`'${host}'`))
  }
  assert.match(mainSource, /parsed\.protocol !== 'https:'/)
  assert.match(mainSource, /!allowedHosts\.has\(parsed\.hostname\.toLowerCase\(\)\)/)
  assert.match(mainSource, /Boolean\(parsed\.username \|\| parsed\.password\)/)
  assert.match(mainSource, /parsed\.port !== '443'/)
})
