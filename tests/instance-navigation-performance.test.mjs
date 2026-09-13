// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('keeps instance navigation lightweight while Minecraft is active', () => {
  assert.match(mainSource, /const lightweightWhilePlaying = hasActiveMinecraft\(\) && kind !== 'screenshots'/)
  assert.match(mainSource, /const archiveMetadata = lightweightWhilePlaying\s*\? EMPTY_ARCHIVE_CONTENT_METADATA\s*: getArchiveContentMetadata/)
  assert.match(mainSource, /INSTANCE_CONTENT_YIELD_INTERVAL/)
  assert.match(mainSource, /await new Promise<void>\(\(resolve\) => setImmediate\(resolve\)\)/)
  assert.match(appSource, /activeView !== 'instances' \|\| !currentTarget \|\| gameRunning/)
  assert.match(appSource, /currentTarget\?\.loaderVersion, gameRunning\]/)
})
