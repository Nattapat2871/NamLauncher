// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getModrinthPackFileIdentity,
  planModpackClientFiles
} from '../shared/modpackCompatibility.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

const fabrishot = {
  path: 'mods/fabrishot-1.17.0.jar',
  env: { client: 'optional', server: 'unsupported' },
  downloads: [
    'https://cdn.modrinth.com/data/3qsfQtE9/versions/Y8Tsud9e/fabrishot-1.17.0.jar'
  ]
}

test('extracts only complete Modrinth project and version identities from trusted CDN paths', () => {
  assert.deepEqual(getModrinthPackFileIdentity(fabrishot), {
    projectId: '3qsfQtE9',
    versionId: 'Y8Tsud9e'
  })
  assert.equal(getModrinthPackFileIdentity({
    path: 'mods/unknown.jar',
    downloads: ['https://example.com/data/project/versions/version/unknown.jar']
  }), null)
})

test('skips an optional file when its declared Modrinth version does not support the pack Minecraft version', () => {
  const requiredFile = {
    path: 'mods/sodium.jar',
    env: { client: 'required', server: 'unsupported' },
    downloads: ['https://cdn.modrinth.com/data/sodium/versions/sodium262/sodium.jar']
  }
  const unsupportedFile = {
    path: 'mods/server-only.jar',
    env: { client: 'unsupported', server: 'required' },
    downloads: []
  }

  const plan = planModpackClientFiles(
    [requiredFile, fabrishot, unsupportedFile],
    '26.2',
    new Map([
      ['Y8Tsud9e', { id: 'Y8Tsud9e', game_versions: ['26.1', '26.1.1', '26.1.2'] }]
    ])
  )

  assert.deepEqual(plan.installableFiles, [requiredFile])
  assert.deepEqual(plan.skippedIncompatibleFiles, [fabrishot])
  assert.deepEqual(plan.skippedUnsupportedFiles, [unsupportedFile])
})

test('keeps compatible and unverifiable optional files installable without turning metadata outages into broken imports', () => {
  const compatible = {
    ...fabrishot,
    path: 'mods/example-compatible.jar',
    downloads: ['https://cdn.modrinth.com/data/example/versions/compatible/example.jar']
  }
  const thirdParty = {
    path: 'mods/third-party.jar',
    env: { client: 'optional', server: 'unsupported' },
    downloads: ['https://github.com/example/project/releases/download/v1/third-party.jar']
  }

  const plan = planModpackClientFiles(
    [compatible, thirdParty],
    '26.2',
    new Map([
      ['compatible', { id: 'compatible', game_versions: ['26.2'] }]
    ])
  )

  assert.deepEqual(plan.installableFiles, [compatible, thirdParty])
  assert.deepEqual(plan.skippedIncompatibleFiles, [])
})

test('preflights optional Modrinth files in bounded batches and reports skipped filenames to the instance view', () => {
  assert.match(mainSource, /offset \+= 100/)
  assert.match(mainSource, /`\$\{MODRINTH_API_BASE\}\/versions`/)
  assert.match(mainSource, /planModpackClientFiles\(files, minecraftVersion, versionsById\)/)
  assert.match(mainSource, /incompatibleOptionalFiles: filePlan\.skippedIncompatibleFiles/)
  assert.match(appSource, /modpack\.install\.skippedIncompatible/)
})
