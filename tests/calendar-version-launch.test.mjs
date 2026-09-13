import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const Handler = require('../node_modules/minecraft-launcher-core/components/handler.js')
const handlerSource = await readFile(new URL('../node_modules/minecraft-launcher-core/components/handler.js', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../node_modules/minecraft-launcher-core/components/launcher.js', import.meta.url), 'utf8')

test('treats Minecraft 26.x calendar releases as modern launcher versions', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'namlauncher-calendar-version-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const gameDirectory = path.join(root, 'game')
  const client = {
    options: {
      root,
      overrides: {
        cwd: gameDirectory
      }
    },
    emit() {}
  }
  const handler = new Handler(client)
  handler.version = { id: '26.2', libraries: [] }

  assert.equal(await handler.getNatives(), gameDirectory)
  assert.equal(handler.isModernForge({ inheritsFrom: '26.2', id: '26.2-forge-test' }), true)
  assert.match(handlerSource, /calendarMatch[\s\S]*Number\(calendarMatch\[1\]\) >= 26/)
  assert.match(handlerSource, /isMinecraftVersionAtLeast\(this\.version\.id, 19\)/)
})

test('keeps macOS first-thread startup and legacy Log4j rules correct for calendar versions', () => {
  assert.match(launcherSource, /const legacyMinorVersion = getLegacyMinecraftMinorVersion\(versionFile\.id\)/)
  assert.match(launcherSource, /legacyMinorVersion === null \|\| legacyMinorVersion > 12/)
  assert.match(launcherSource, /legacyMinorVersion !== null && legacyMinorVersion < 17/)
  assert.doesNotMatch(launcherSource, /parseInt\(versionFile\.id\.split\('\.'\)\[1\]\) < 17/)
})
