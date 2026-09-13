// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('loads the launcher data path with an explicit recoverable state', () => {
  assert.match(appSource, /type DataLocationStatus = 'loading' \| 'ready' \| 'error'/)
  assert.match(appSource, /const \[dataLocationStatus, setDataLocationStatus\] = useState<DataLocationStatus>\('loading'\)/)
  assert.match(appSource, /const loadLauncherDataLocation = useCallback\(async \(\) => \{/)
  assert.match(appSource, /setDataLocationStatus\('error'\)/)
  assert.match(appSource, /onClick=\{\(\) => void loadLauncherDataLocation\(\)\}/)
  assert.match(appSource, /activeView !== 'settings' \|\| dataLocationStatus !== 'error'/)
  assert.doesNotMatch(appSource, /withBootTimeout\(window\.electron\.getLauncherDataLocation\(\), 5000\)/)
})

test('keeps instance content out of the critical boot path and loads only the visible panel', () => {
  assert.doesNotMatch(appSource, /preloadInstanceContent\(loadedInstances\)/)
  assert.doesNotMatch(appSource, /preloadInstanceContent\(instances, \{ silent: true \}\)/)
  assert.match(appSource, /if \(!bootReady \|\| activeView !== 'instances' \|\| instancePanelView !== 'content'\) return/)
  assert.match(appSource, /refreshUpdateSummaries\(\[currentTarget\]\)/)
  assert.doesNotMatch(appSource, /refreshUpdateSummaries\(instances\)/)
})

test('does not retain screenshot base64 payloads in the instance content cache', () => {
  assert.match(appSource, /if \(kind === 'screenshots'\) return/)
  assert.match(appSource, /else if \(!options\.silent && !cached && isVisibleTarget\(\)\) \{[\s\S]*setInstanceContent\(\[\]\)[\s\S]*setContentLoading\(true\)/)
})
