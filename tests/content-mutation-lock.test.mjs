import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('blocks only mod file mutations while the selected instance is running or launching', () => {
  assert.match(mainSource, /const isModContentMutation = \(contentType: ModrinthProjectType \| InstanceContentKind\) => \{/)
  assert.match(mainSource, /contentType === 'mod' \|\| contentType === 'mods'/)
  assert.match(mainSource, /const assertInstanceContentMutable = \(\s*instance: ReturnType<typeof normalizeInstance>,\s*contentType: ModrinthProjectType \| InstanceContentKind\s*\) => \{/)
  assert.match(mainSource, /if \(!isModContentMutation\(contentType\)\) return/)
  assert.match(mainSource, /runningGames\.has\(instance\.id\) \|\| activeLaunches\.has\(instance\.id\)/)
  assert.match(mainSource, /const toggleInstanceContent = async \(request: InstanceContentRequest\) => \{[\s\S]*assertInstanceContentMutable\(instance, kind\)/)
  assert.match(mainSource, /const deleteInstanceContent = \(request: InstanceContentRequest\) => \{[\s\S]*assertInstanceContentMutable\(instance, kind\)/)
  assert.match(mainSource, /const installModrinthProject = async \(request: ModrinthInstallRequest\) => \{[\s\S]*assertInstanceContentMutable\(instance, projectType\)/)
  assert.match(mainSource, /const installCurseForgeProject = async \(request: CurseForgeInstallRequest\) => \{[\s\S]*assertInstanceContentMutable\(instance, projectType\)/)
})

test('disables only mod controls in the renderer while the selected instance is busy', () => {
  assert.match(appSource, /const isModContentType = \(contentType\?: string \| null\) => contentType === 'mod' \|\| contentType === 'mods'/)
  assert.match(appSource, /shouldBlockCurrentTargetContent\(projectType\)[\s\S]*content\.toggle\.busy/)
  assert.match(appSource, /const contentBlocked = shouldBlockCurrentTargetContent\(item\.kind\)/)
  assert.match(appSource, /disabled=\{contentBlocked\}[\s\S]*title=\{contentBlocked \? t\('content\.toggle\.busy'\)/)
  assert.match(appSource, /disabled=\{busy \|\| contentBlocked\}[\s\S]*t\('content\.delete\.busy'\)/)
})

test('replaces a locally installed Modrinth file instead of leaving a duplicate on update', () => {
  assert.match(mainSource, /const localMatch = await findInstalledVersionFromFiles\(projectType, instance, versions\)/)
  assert.match(mainSource, /removeLocalContentFileReplacedByInstall\(gameDirectory, localMatch, installed\)/)
  assert.match(mainSource, /Removed local content file replaced by Modrinth install/)
})
