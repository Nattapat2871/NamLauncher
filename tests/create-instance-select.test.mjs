// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const selectSource = await readFile(new URL('../src/components/InstanceSelect.tsx', import.meta.url), 'utf8')
const loaderIconSource = await readFile(new URL('../src/components/LoaderIcon.tsx', import.meta.url), 'utf8')

test('Create Instance uses three dark icon-led comboboxes instead of native selects', () => {
  const createSection = appSource.slice(
    appSource.indexOf('testId="create-instance-loader-select"') - 1_000,
    appSource.indexOf('testId="create-instance-loader-build-select"') + 500
  )
  assert.equal((createSection.match(/<InstanceSelect/g) || []).length, 3)
  assert.doesNotMatch(createSection, /<select\b/)
  for (const testId of [
    'create-instance-loader-select',
    'create-instance-version-select',
    'create-instance-loader-build-select'
  ]) assert.match(createSection, new RegExp(`testId="${testId}"`))
  assert.equal((createSection.match(/renderIcon=/g) || []).length, 3)
})

test('custom instance selector supports portal positioning, ARIA, keyboard control, and type-ahead', () => {
  assert.match(selectSource, /createPortal\([\s\S]*document\.body/)
  assert.match(selectSource, /role="combobox"/)
  assert.match(selectSource, /role="listbox"/)
  assert.match(selectSource, /role="option"/)
  assert.match(selectSource, /aria-activedescendant=/)
  assert.match(selectSource, /aria-selected=/)
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Escape', 'Enter']) {
    assert.match(selectSource, new RegExp(`event\\.key === '${key}'`))
  }
  assert.match(selectSource, /typeaheadRef/)
  assert.match(selectSource, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(selectSource, /bg-\[#101a2c\]/)
})

test('loader artwork is transparent and is not clipped or wrapped in an artificial frame', () => {
  const wrapper = loaderIconSource.slice(loaderIconSource.indexOf('<span'), loaderIconSource.indexOf('</span>') + 7)
  assert.doesNotMatch(wrapper, /overflow-hidden|rounded-|bg-/)
  assert.match(loaderIconSource, /object-contain/)
  assert.match(loaderIconSource, /Official loader artwork is bundled locally/)
})
