// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getInstanceDetailNavigation,
  getInstanceModsLibraryNavigation
} from '../src/instanceSelection.ts'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const appCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')

test('resolves safe deterministic destinations for instance navigation', () => {
  assert.deepEqual(getInstanceDetailNavigation('  fabric-main  '), {
    instanceId: 'fabric-main',
    activeView: 'instances',
    panelView: 'content',
    contentTab: 'mods'
  })
  assert.deepEqual(getInstanceModsLibraryNavigation('fabric-main'), {
    instanceId: 'fabric-main',
    activeView: 'library',
    libraryType: 'mod'
  })
  assert.equal(getInstanceDetailNavigation('   '), null)
  assert.equal(getInstanceModsLibraryNavigation(''), null)
})

test('keeps the welcome card focused on the account identity and 2D skin head', () => {
  const welcomeStart = appSource.indexOf('aria-labelledby="home-welcome-title"')
  const recentStart = appSource.indexOf('aria-labelledby="home-recent-title"')
  assert.ok(welcomeStart > -1 && recentStart > welcomeStart)

  const welcomeCard = appSource.slice(welcomeStart, recentStart)
  assert.match(welcomeCard, /<AccountHead[\s\S]*account=\{activeAccount\}/)
  assert.match(welcomeCard, /skinTextureSrc=\{accountSkinTextures\[activeAccount\.id\]\}/)
  assert.doesNotMatch(welcomeCard, /home\.instances|home\.updates|homeUpdateCount/)
})

test('uses semantic instance controls and opens the requested default destination', () => {
  assert.match(appSource, /className=\{classNames\([\s\S]*nam-sidebar-instance-button[\s\S]*onClick=\{\(\) => openInstanceDetail\(instance\.id\)\}/)
  assert.match(appSource, /const openInstanceDetail = \(instanceId: string\) => \{[\s\S]*setSelectedInstanceId\(navigation\.instanceId\)[\s\S]*setInstancePanelView\(navigation\.panelView\)[\s\S]*setContentTab\(navigation\.contentTab\)[\s\S]*setActiveView\(navigation\.activeView\)/)
  assert.match(appSource, /aria-current=\{activeView === 'instances' && selectedInstanceId === instance\.id \? 'page' : undefined\}/)
})

test('opens Library Mods for the active instance and exposes its destination', () => {
  assert.match(appSource, /onClick=\{\(\) => openInstanceModsLibrary\(currentTarget\.id\)\}/)
  assert.match(appSource, /setLibraryType\(navigation\.libraryType\)[\s\S]*setLibraryPage\(0\)[\s\S]*setActiveView\(navigation\.activeView\)/)
  assert.match(appSource, /library\.targetInstance/)
  assert.equal((appTextSource.match(/'instance\.mods\.add':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'library\.targetInstance':/g) || []).length, 2)
})

test('presents explicit close-to-tray behavior with safe defaults', () => {
  assert.match(appSource, /autoMinimizeOnLaunch: false/)
  assert.match(appSource, /closeToTrayEnabled: true/)
  assert.match(appSource, /checked=\{discordSettings\.closeToTrayEnabled\}/)
  assert.match(appSource, /closeToTrayEnabled: !discordSettings\.closeToTrayEnabled/)
  assert.equal((appTextSource.match(/'settings\.closeToTray\.title':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'settings\.closeToTray\.on':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'settings\.closeToTray\.off':/g) || []).length, 2)
})

test('retains visible focus, reduced motion, and WCAG 2.2 minimum targets', () => {
  assert.match(appCss, /min-width: 24px;[\s\S]*min-height: 24px;/)
  assert.match(appCss, /:focus-visible/)
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)/)
})
