// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DEFAULT_LIBRARY_SEARCH_FILTERS,
  LIBRARY_SEARCH_MAX_OFFSET,
  buildModrinthSearchFacets,
  countActiveLibraryFilters,
  isLibraryInstanceCompatibilityAvailable,
  isLibraryLoaderFilterAvailable,
  normalizeLibrarySearchLimit,
  normalizeLibrarySearchOffset,
  normalizeLibrarySearchQuery,
  normalizeLibrarySearchFilters,
  normalizeLibraryTotalHits,
  resolveLibrarySearchFilters
} from '../shared/librarySearchFilters.ts'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('normalizes library filter values through strict allowlists', () => {
  assert.deepEqual(normalizeLibrarySearchFilters({
    sort: 'invalid',
    gameVersion: '../../latest',
    loader: 'rift',
    environment: 'everywhere',
    openSourceOnly: true,
    compatibleOnly: false
  }), {
    sort: 'downloads',
    gameVersion: '',
    loader: '',
    environment: 'all',
    openSourceOnly: true,
    compatibleOnly: false
  })
})

test('selected-instance compatibility wins over manual version and loader', () => {
  assert.deepEqual(resolveLibrarySearchFilters({
    ...DEFAULT_LIBRARY_SEARCH_FILTERS,
    gameVersion: '1.20.1',
    loader: 'forge'
  }, { version: '1.21.1', loader: 'fabric' }), {
    sort: 'downloads',
    gameVersion: '1.21.1',
    loader: 'fabric',
    environment: 'all',
    openSourceOnly: false
  })
})

test('builds Modrinth facets as AND groups with environment values in one OR group', () => {
  assert.deepEqual(buildModrinthSearchFacets('mod', {
    sort: 'updated',
    gameVersion: '1.21.1',
    loader: 'fabric',
    environment: 'client',
    openSourceOnly: true
  }), [
    ['project_type:mod'],
    ['versions:1.21.1'],
    ['categories:fabric'],
    [
      'environment:client_and_server',
      'environment:client_only',
      'environment:client_only_server_optional',
      'environment:singleplayer_only',
      'environment:server_only_client_optional',
      'environment:client_or_server',
      'environment:client_or_server_prefers_both'
    ],
    ['open_source:true']
  ])
})

test('maps official Modrinth environment meanings to client, server, and both support', () => {
  const base = {
    sort: 'downloads',
    gameVersion: '',
    loader: '',
    openSourceOnly: false
  }
  const environmentValues = (environment) => buildModrinthSearchFacets('mod', {
    ...base,
    environment
  })[1].map((facet) => facet.replace('environment:', ''))

  assert.deepEqual(environmentValues('client'), [
    'client_and_server',
    'client_only',
    'client_only_server_optional',
    'singleplayer_only',
    'server_only_client_optional',
    'client_or_server',
    'client_or_server_prefers_both'
  ])
  assert.deepEqual(environmentValues('server'), [
    'client_and_server',
    'client_only_server_optional',
    'server_only',
    'server_only_client_optional',
    'dedicated_server_only',
    'client_or_server',
    'client_or_server_prefers_both'
  ])
  assert.deepEqual(environmentValues('both'), [
    'client_and_server',
    'client_only_server_optional',
    'server_only_client_optional',
    'client_or_server',
    'client_or_server_prefers_both'
  ])
})

test('normalizes untrusted Library request boundaries before provider access', () => {
  assert.equal(normalizeLibrarySearchQuery(`  ${'a'.repeat(140)}  `).length, 100)
  assert.equal(normalizeLibrarySearchQuery(` ${'😀'.repeat(101)} `), '😀'.repeat(100))
  assert.equal(normalizeLibrarySearchOffset(-1), 0)
  assert.equal(normalizeLibrarySearchOffset(12.9), 12)
  assert.equal(normalizeLibrarySearchOffset(Number.POSITIVE_INFINITY), 0)
  assert.equal(normalizeLibrarySearchOffset(LIBRARY_SEARCH_MAX_OFFSET + 1), LIBRARY_SEARCH_MAX_OFFSET)
  assert.equal(normalizeLibrarySearchLimit(2.9), 2)
  assert.equal(normalizeLibrarySearchLimit(0), 10)
  assert.equal(normalizeLibrarySearchLimit(500), 50)
  assert.equal(normalizeLibraryTotalHits(-4), 0)
  assert.equal(normalizeLibraryTotalHits(15.9), 15)
  assert.equal(normalizeLibraryTotalHits('invalid', 7), 7)
})

test('only exposes loader filters where the selected provider applies them', () => {
  assert.equal(isLibraryLoaderFilterAvailable('modrinth', 'mod'), true)
  assert.equal(isLibraryLoaderFilterAvailable('modrinth', 'modpack'), true)
  assert.equal(isLibraryLoaderFilterAvailable('curseforge', 'mod'), true)
  assert.equal(isLibraryLoaderFilterAvailable('curseforge', 'modpack'), false)
  assert.equal(isLibraryLoaderFilterAvailable('curseforge', 'resourcepack'), false)
})

test('omits mod-only facets for resource packs and counts active controls', () => {
  const filters = {
    sort: 'newest',
    gameVersion: '1.21.1',
    loader: 'neoforge',
    environment: 'server',
    openSourceOnly: true,
    compatibleOnly: false
  }
  assert.deepEqual(buildModrinthSearchFacets('resourcepack', filters), [
    ['project_type:resourcepack'],
    ['versions:1.21.1'],
    ['open_source:true']
  ])
  assert.equal(countActiveLibraryFilters(filters), 5)
})

test('only offers selected-instance compatibility when the target can install that project type', () => {
  assert.equal(isLibraryInstanceCompatibilityAvailable('mod', { version: '1.21.1', loader: 'fabric' }), true)
  assert.equal(isLibraryInstanceCompatibilityAvailable('mod', { version: '1.21.1', loader: 'vanilla' }), false)
  assert.equal(isLibraryInstanceCompatibilityAvailable('resourcepack', { version: '1.21.1', loader: 'vanilla' }), true)
  assert.equal(isLibraryInstanceCompatibilityAvailable('shader', { version: 'invalid/version', loader: 'fabric' }), false)
  assert.equal(isLibraryInstanceCompatibilityAvailable('modpack', { version: '1.21.1', loader: 'fabric' }), false)
  assert.equal(isLibraryInstanceCompatibilityAvailable('mod', null), false)
})

test('integrates filters into cache and provider requests while resetting bounded pagination', () => {
  assert.match(appSource, /filters: resolvedLibraryFilters/)
  assert.match(appSource, /searchCurseForge\(\{[\s\S]*sort: resolvedLibraryFilters\.sort[\s\S]*gameVersion: resolvedLibraryFilters\.gameVersion[\s\S]*loader: resolvedLibraryFilters\.loader/)
  assert.match(appSource, /searchModrinth\(\{[\s\S]*index: resolvedLibraryFilters\.sort[\s\S]*environment: resolvedLibraryFilters\.environment[\s\S]*openSourceOnly: resolvedLibraryFilters\.openSourceOnly/)
  assert.match(appSource, /const updateLibraryFilters = \(updates: Partial<LibrarySearchFilters>\) => \{[\s\S]*setLibraryPage\(0\)/)
  assert.match(appSource, /const resetLibraryFilters = \(\) => \{[\s\S]*compatibleOnly: false/)
  assert.match(appSource, /if \(activeView !== 'library' \|\| libraryLoading \|\| libraryError\) return[\s\S]*const boundedPage = clampLibraryPage\(libraryPage, getLibraryTotalPages\(totalHits\)\)[\s\S]*setLibraryPage\(boundedPage\)/)
  assert.match(appSource, /setLibraryFilters\(\(current\) => \(\{ \.\.\.current, compatibleOnly: true \}\)\)[\s\S]*setLibraryPage\(0\)/)
  assert.match(appSource, /maxLength=\{LIBRARY_SEARCH_QUERY_MAX_LENGTH\}/)
  assert.match(appSource, /isLibraryLoaderFilterAvailable\(librarySource, libraryType\)/)
  assert.match(appSource, /role="alert"[\s\S]*\{libraryError\}/)
  assert.match(appSource, /pendingLibraryPageFocusRef[\s\S]*libraryHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(appSource, /const libraryPaginationStatusText = tf\('library\.pagination\.status'/)
  assert.match(appSource, /statusText=\{libraryPaginationStatusText\}/)
})

test('normalizes provider requests, preserves valid CurseForge loader-only filtering, and cancels stale searches', () => {
  assert.match(mainSource, /normalizeLibrarySearchQuery\(request\.query\)/)
  assert.match(mainSource, /normalizeLibrarySearchOffset\(request\.offset\)/)
  assert.match(mainSource, /normalizeLibrarySearchLimit\(request\.limit\)/)
  assert.match(mainSource, /normalizeLibraryTotalHits\(result\.total_hits/)
  assert.match(mainSource, /const loader = projectType === 'mod'\s*\?/)
  assert.doesNotMatch(mainSource, /const loader = projectType === 'mod' && gameVersion/)
  assert.match(mainSource, /let activeCurseForgeSearchController: AbortController \| null = null/)
  assert.match(mainSource, /activeCurseForgeSearchController\?\.abort\(\)/)
  assert.match(mainSource, /searchCurseForgeProjects\(request \|\| \{\}, controller\.signal\)/)
  assert.match(mainSource, /requestCurseForge<[\s\S]*\{[\s\S]*signal[\s\S]*params:/)
})

test('renders one shared pagination component above and below library results', () => {
  assert.equal((appSource.match(/<LibraryPagination/g) || []).length, 2)
  assert.match(appSource, /<LibraryPagination[\s\S]*placement="top"[\s\S]*className="border-b/)
  assert.match(appSource, /<LibraryPagination[\s\S]*placement="bottom"[\s\S]*className="border-t/)
})
