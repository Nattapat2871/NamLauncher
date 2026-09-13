// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const panelSource = await readFile(new URL('../src/components/WorldsServersPanel.tsx', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const lanIpcSource = await readFile(new URL('../electron/minecraft/lanIpc.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const motdSource = await readFile(new URL('../src/components/MinecraftServerMotd.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const storageSource = await readFile(new URL('../src/storageKeys.ts', import.meta.url), 'utf8')

test('loads the Worlds & Servers renderer only when its instance panel is selected', () => {
  assert.match(appSource, /lazy\(loadWorldsServersPanelModule\)/)
  assert.match(appSource, /instancePanelView === 'places'/)
  assert.match(appSource, /setInstancePanelView\('places'\)/)
  assert.match(appSource, /<WorldsServersPanel/)
  assert.match(appSource, /getInstancePlaces: InstancePlacesApi\['getInstancePlaces'\]/)
  assert.match(panelSource, /useEffect\(\(\) => \{[\s\S]*refreshPlaces\(\)/)
})

test('supports searching, filtering, status refresh, and safe MOTD segment rendering', () => {
  assert.match(panelSource, /type PlaceFilter = 'all' \| 'singleplayer' \| 'online' \| 'offline'/)
  assert.match(panelSource, /api\.pingInstanceServers\(instance\)/)
  assert.match(panelSource, /weeklySnapshot = normalized\.match/)
  assert.match(panelSource, /<MinecraftServerMotd/)
  assert.match(motdSource, /motd\.segments\.map/)
  assert.match(motdSource, /getMotdSegmentStyle\(segment\)/)
  assert.doesNotMatch(`${panelSource}\n${motdSource}`, /dangerouslySetInnerHTML/)
  assert.match(panelSource, /aria-live="polite"/)
})

test('adds and removes servers through guarded backend mutations', () => {
  assert.match(panelSource, /api\.addInstanceServer\(\{/)
  assert.match(panelSource, /api\.removeInstanceServer\(\{/)
  assert.match(panelSource, /expectedCanonicalKey: server\.canonicalKey!/)
  assert.match(appSource, /title: t\('places\.remove\.title'\)/)
  assert.match(appSource, /danger: true,[\s\S]*onConfirm/)
  assert.match(appSource, /catch \(error\)[\s\S]*setConfirmDialogError\(message\)[\s\S]*setStatusText\(message\)/)
  assert.match(appSource, /confirmDialogError[\s\S]*role="alert"/)
})

test('routes quick play through the existing launch handler and remembers recent places for Home', () => {
  assert.match(appSource, /handleLaunchOrStop\(currentTarget, quickPlay, label\)/)
  assert.match(appSource, /\.\.\.\(quickPlay \? \{ quickPlay \} : \{\}\)/)
  assert.match(appSource, /localStorage\.setItem\(storage\.recentPlaces/)
  assert.match(storageSource, /recentPlaces: 'namlauncher_recent_places'/)
  assert.match(appSource, /home\.places\.title/)
  assert.match(appSource, /recentPlayablePlaces\.map/)
})

test('contains English and Thai accessibility copy for Worlds & Servers', () => {
  assert.equal((appTextSource.match(/'instance\.places\.title':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'places\.filter\.singleplayer':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'places\.world\.legacyHelp':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'home\.places\.title':/g) || []).length, 2)
})

test('integrates passive LAN discovery and local port detection for the selected instance', () => {
  assert.match(appSource, /getLanReadiness: InstancePlacesApi\['getLanReadiness'\]/)
  assert.match(appSource, /discoverLanServers: InstancePlacesApi\['discoverLanServers'\]/)
  assert.match(appSource, /onLanSessionDetected\?: InstancePlacesApi\['onLanSessionDetected'\]/)
  assert.match(panelSource, /Promise\.allSettled\(\[[\s\S]*api\.getLanReadiness\(\{ instance \}\)[\s\S]*api\.discoverLanServers\(\)/)
  assert.match(panelSource, /api\.onLanSessionDetected\(\(payload\) => \{[\s\S]*payload\.instanceId !== instance\.id[\s\S]*refreshLanServers\(\)/)
  assert.match(mainSource, /trustedIpcHandle\('discover-lan-servers',[\s\S]*discoverLocalMinecraftServers\(\)/)
  assert.match(mainSource, /discoverMinecraftLanServers\(\{ timeoutMs: 2_500 \}\)/)
  assert.match(mainSource, /trustedIpcHandle\('get-lan-readiness',[\s\S]*assertMainRendererInvocation\(event\)/)
  assert.match(mainSource, /trustedIpcHandle\('discover-lan-servers',[\s\S]*assertMainRendererInvocation\(event\)/)
  assert.match(mainSource, /createLanDiscoveryCoordinator\([\s\S]*discoverMinecraftLanServers\(\{ timeoutMs: 2_500 \}\)/)
  assert.match(lanIpcSource, /servers\.map\(\(\{ address, port, endpoint \}\) => \(\{/)
  assert.doesNotMatch(mainSource, /Minecraft LAN session detected for \$\{activeGame\.instanceName\}/)
  assert.match(preloadSource, /discoverLanServers: \(\) => invoke\('discover-lan-servers'\)/)
  assert.match(preloadSource, /ipcRenderer\.on\('lan-session-detected', listener\)[\s\S]*ipcRenderer\.removeListener\('lan-session-detected', listener\)/)
})

test('renders only copyable bilingual LAN address and port results', () => {
  assert.match(panelSource, /aria-labelledby="lan-discovery-title"/)
  assert.doesNotMatch(panelSource, /lan-peer-account-type|lan-peer-version|lan-peer-loader/)
  assert.match(panelSource, /api\.copyToClipboard\(endpoint\)/)
  assert.match(panelSource, /server\.endpoint/)
  assert.match(panelSource, /server\.port/)
  assert.doesNotMatch(panelSource, /server\.motd|interfaceName/)
  assert.match(panelSource, /aria-live="polite"/)
  assert.equal((appTextSource.match(/'lan\.status\.found':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'lan\.empty\.detail':/g) || []).length, 2)
  assert.equal((appTextSource.match(/'lan\.endpoint\.copyLabel':/g) || []).length, 2)
  assert.match(appTextSource, /Passive local-network discovery only/)
  assert.match(appTextSource, /ค้นหาแบบรับฟังเฉพาะเครือข่ายภายในเท่านั้น/)
})
