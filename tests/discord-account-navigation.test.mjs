// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const navigationSource = source.slice(
  source.indexOf('const focusDiscordAccountSection ='),
  source.indexOf('const connectLauncherDiscord =')
)

// Exercise the actual handlers without starting Electron or a live OAuth flow.
const createHarness = (activeView, reduceMotion = false) => {
  const events = []
  const section = {
    scrollIntoView: (options) => events.push(['scroll', options.behavior, options.block]),
    focus: (options) => events.push(['focus', options.preventScroll])
  }
  const context = {
    activeView,
    reduceMotion,
    discordAccountSectionRef: { current: activeView === 'settings' ? section : null },
    pendingDiscordAccountFocusRef: { current: false },
    setActiveView: (view) => events.push(['navigate', view])
  }
  runInNewContext(`${navigationSource}\nglobalThis.handlers = { focusDiscordAccountSection, openDiscordAccountSettings }`, context)
  return { context, events, section, ...context.handlers }
}

test('Discord navigation waits for the settings mount and animation before scrolling once', () => {
  for (const view of ['home', 'instances', 'skins', 'library']) {
    const harness = createHarness(view)
    harness.openDiscordAccountSettings()
    assert.deepEqual(harness.events, [['navigate', 'settings']])
    harness.context.activeView = 'settings'
    harness.focusDiscordAccountSection()
    assert.equal(harness.context.pendingDiscordAccountFocusRef.current, true)
    harness.context.discordAccountSectionRef.current = harness.section
    harness.focusDiscordAccountSection()
    harness.focusDiscordAccountSection()
    assert.deepEqual(harness.events, [
      ['navigate', 'settings'], ['scroll', 'smooth', 'start'], ['focus', true]
    ])
    assert.equal(harness.context.pendingDiscordAccountFocusRef.current, false)
  }
})

test('Discord navigation scrolls immediately on settings and respects reduced motion', () => {
  const harness = createHarness('settings', true)
  harness.openDiscordAccountSettings()
  assert.deepEqual(harness.events, [
    ['navigate', 'settings'], ['scroll', 'auto', 'start'], ['focus', true]
  ])
})

test('normal settings visits do not force a jump to Discord', () => {
  const harness = createHarness('settings')
  harness.focusDiscordAccountSection()
  assert.deepEqual(harness.events, [])
})
