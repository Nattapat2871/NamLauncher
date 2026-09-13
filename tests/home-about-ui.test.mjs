// Author/creator: nattapat2871 (https://nattapat2871.me)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const partnerSource = await readFile(new URL('../shared/partnerServers.ts', import.meta.url), 'utf8')

test('uses Home as the default view and keeps its network discovery lazy', () => {
  assert.match(appSource, /\{ id: 'home',[\s\S]*\{ id: 'instances'/)
  assert.match(appSource, /useState<ViewId>\('home'\)/)
  assert.match(appSource, /if \(!bootReady \|\| activeView !== 'home' \|\| homeModpacksLoaded\) return/)
  assert.match(appSource, /getHomeModpacks\(\)/)
  assert.match(appSource, /home\.recent\.title/)
  assert.match(appSource, /home\.modpacks\.title/)
  assert.equal((appSource.match(/\{t\('home\.welcome'\)\}/g) || []).length, 1)
})

test('renders the About website, developer, and all shared partner servers', () => {
  assert.match(appSource, /import \{ PARTNER_SERVERS, type PartnerServerDefinition \} from '\.\.\/shared\/partnerServers'/)
  assert.match(appSource, /PARTNER_SERVERS\.map\(\(server\) =>/)
  assert.match(appSource, /openExternal\('https:\/\/nattapat2871\.me\/'\)/)
  assert.match(appSource, /openExternal\('https:\/\/namlauncher\.nattapat2871\.me\/'\)/)
  assert.match(partnerSource, /name: 'MiniSand'[\s\S]*websiteUrl: 'https:\/\/minisand\.online\/'/)
  assert.match(partnerSource, /name: 'NamCraft'[\s\S]*websiteUrl: 'https:\/\/namcraft\.nattapat2871\.me\/'/)
  assert.match(partnerSource, /name: 'NamCraft'[\s\S]*iconUrl: 'https:\/\/namcraft\.nattapat2871\.me\/icon\.png'/)
  assert.match(partnerSource, /name: 'TeddyBlock'[\s\S]*websiteUrl: 'https:\/\/tdblock\.online\/'/)
  assert.match(partnerSource, /name: 'TeddyBlock'[\s\S]*iconUrl: 'https:\/\/tdblock\.online\/server\/logo-128\.png'/)
  assert.match(appTextSource, /'settings\.about\.developerName': 'Nattapat2871'/)
  assert.match(appTextSource, /'settings\.about\.partnersTitle': 'Partner servers'/)
})
