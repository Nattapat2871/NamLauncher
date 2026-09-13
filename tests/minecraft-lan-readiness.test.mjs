// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessLanReadiness,
  detectLanPortFromLogLine,
  getPrivateLanAddresses
} from '../electron/minecraft/lanReadiness.ts'

const interfaces = {
  Ethernet: [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
    { address: '192.168.1.42', family: 'IPv4', internal: false }
  ],
  VPN: [{ address: '10.7.0.3', family: 4, internal: false }],
  Public: [{ address: '203.0.113.3', family: 'IPv4', internal: false }]
}

test('extracts only usable private IPv4 addresses and detects current LAN log formats', () => {
  assert.deepEqual(getPrivateLanAddresses(interfaces), ['10.7.0.3', '192.168.1.42'])
  assert.equal(detectLanPortFromLogLine('[Server thread/INFO]: Started serving on 54321'), 54321)
  assert.equal(detectLanPortFromLogLine('Local game hosted on port 25565'), 25565)
  assert.equal(detectLanPortFromLogLine('Started Minecraft server on *:25566'), 25566)
  assert.equal(detectLanPortFromLogLine('Started serving on 99999'), null)
})

test('returns only private addresses and the temporary port needed by the simple LAN view', () => {
  const result = assessLanReadiness({
    interfaces,
    detectedPort: 54321
  })

  assert.deepEqual(result, {
    addresses: ['10.7.0.3', '192.168.1.42'],
    detectedPort: 54321
  })
  assert.equal(JSON.stringify(result).includes('interfaceName'), false)
})
