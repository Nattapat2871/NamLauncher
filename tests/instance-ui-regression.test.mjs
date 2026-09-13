import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
const storageSource = await readFile(new URL('../src/storageKeys.ts', import.meta.url), 'utf8')

test('keeps instance content search usable after returning from Library', () => {
  assert.match(appSource, /const \[instanceContentQuery, setInstanceContentQuery\] = useState\(''\)/)
  assert.match(appSource, /const filteredInstanceContent = filterInstanceContent\(instanceContent, instanceContentQuery\)/)
  assert.match(appSource, /value=\{instanceContentQuery\}/)
  assert.match(appSource, /onChange=\{\(event\) => setInstanceContentQuery\(event\.target\.value\)\}/)
})

test('keeps instance content tabs wired to the active category', () => {
  assert.match(appSource, /const \[contentTab, setContentTab\] = useState<InstanceContentKind>\('mods'\)/)
  assert.match(appSource, /const currentContentTab = instanceContentTabs\.find\(\(tab\) => tab\.id === contentTab\)/)
  assert.match(appSource, /onClick=\{\(\) => setContentTab\(tab\.id\)\}/)
  assert.match(appSource, /contentTab === tab\.id/)
})

test('prevents launcher artwork from being dragged out of the UI via CSS and avoids busy cursors on disabled buttons', () => {
  assert.match(appCss, /-webkit-user-drag: none/)
  assert.match(appCss, /button:disabled,[\s\S]*cursor: default !important/)
})

test('keeps instance update count only on the action button', () => {
  assert.match(appSource, /data-tooltip=\{running \? t\('content\.update\.busy'\) : tf\('home\.updatesAvailable', \{ count: updateCount \}\)/)
  assert.doesNotMatch(appSource, /\{updateCount\} update\{updateCount > 1 \? 's' : ''\}/)
})

test('keeps sidebar width resizable and persisted with a bounded drag handle', () => {
  assert.match(storageSource, /sidebarWidth: 'namlauncher_sidebar_width'/)
  assert.match(appSource, /const SIDEBAR_MIN_WIDTH = 260/)
  assert.match(appSource, /const SIDEBAR_DEFAULT_WIDTH = 300/)
  assert.match(appSource, /const SIDEBAR_MAX_WIDTH = 380/)
  assert.match(appSource, /const sidebarCompact = sidebarWidth < 284/)
  assert.match(appSource, /const \[sidebarWidth, setSidebarWidth\]/)
  assert.match(appSource, /const startSidebarResize = \(event: React\.PointerEvent<HTMLElement>\) => \{/)
  assert.match(appSource, /const handleSidebarResizeKeyDown = \(event: React\.KeyboardEvent<HTMLElement>\) => \{/)
  assert.match(appSource, /localStorage\.setItem\(storage\.sidebarWidth, String\(sidebarWidth\)\)/)
  assert.match(appSource, /style=\{\{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth \}\}/)
  assert.match(appSource, /grid-rows-\[auto_auto_minmax\(0,1fr\)_auto\] overflow-hidden/)
  assert.match(appSource, /sidebarNarrow \? 'h-7 w-7 min-w-0 px-0' : 'h-8 min-w-8 gap-1 px-2'/)
  assert.match(appSource, /\{instance\.loader\}\{sidebarNarrow \? '' : ` \/ \$\{instance\.version\}`\}/)
  assert.match(appSource, /!sidebarNarrow && updateCount/)
  assert.match(appSource, /!sidebarNarrow && <ChevronRight/)
  assert.match(appSource, /role="separator"/)
  assert.match(appSource, /aria-valuemin=\{SIDEBAR_MIN_WIDTH\}/)
  assert.match(appSource, /cursor-ew-resize/)
  assert.match(appCss, /\.nam-sidebar-resizing,[\s\S]*cursor: ew-resize !important/)
})

test('loads instance content lazily and reuses cache when switching active instances or tabs', () => {
  assert.match(appSource, /const cached = instanceContentCacheRef\.current\[currentTarget\.id\]\?\.\[contentTab\]/)
  assert.match(appSource, /if \(cached\) \{[\s\S]*setInstanceContent\(cached\)[\s\S]*setContentLoading\(false\)[\s\S]*return/)
  assert.match(appSource, /if \(!bootReady \|\| activeView !== 'instances' \|\| instancePanelView !== 'content'\) return/)
  assert.doesNotMatch(appSource, /preloadInstanceContent\(instances, \{ silent: true \}\)/)
})

test('uses full version selects in instance installation settings', () => {
  assert.match(appSource, /const getMinecraftVersionId = \(version: any\)/)
  assert.match(appSource, /const instanceSettingsGameVersionOptions = uniqueStrings/)
  assert.match(appSource, /const instanceSettingsLoaderVersionOptions = uniqueStrings/)
  assert.match(appSource, /onFocus=\{\(\) => void ensureMinecraftVersionList\(\)\}/)
  assert.match(appSource, /instanceSettingsGameVersionOptions\.map\(\(version\) =>/)
  assert.match(appSource, /instanceSettingsLoaderVersionOptions\.map\(\(loaderId\) =>/)
  assert.doesNotMatch(appSource, /id="instance-settings-game-versions"/)
  assert.doesNotMatch(appSource, /id="instance-settings-loader-versions"/)
})
