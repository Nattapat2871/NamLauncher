// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  clampLibraryPage,
  getLibraryPageWindow,
  getLibraryTotalPages,
  resolveLibraryPageInput
} from '../src/libraryPagination.ts'
import { LIBRARY_SEARCH_MAX_OFFSET } from '../shared/librarySearchFilters.ts'

const componentSource = await readFile(
  new URL('../src/components/LibraryPagination.tsx', import.meta.url),
  'utf8'
)

test('calculates bounded page counts and zero-based pages', () => {
  assert.equal(getLibraryTotalPages(0), 1)
  assert.equal(getLibraryTotalPages(1), 1)
  assert.equal(getLibraryTotalPages(10), 1)
  assert.equal(getLibraryTotalPages(11), 2)
  assert.equal(getLibraryTotalPages(25, 5), 5)
  assert.equal(getLibraryTotalPages(Number.NaN, 0), 1)

  assert.equal(clampLibraryPage(-4, 10), 0)
  assert.equal(clampLibraryPage(4.9, 10), 4)
  assert.equal(clampLibraryPage(99, 10), 9)
  assert.equal(clampLibraryPage(Number.NaN, 10), 0)
})

test('caps provider-backed pagination at the shared offset boundary', () => {
  assert.equal(LIBRARY_SEARCH_MAX_OFFSET, 10_000)
  assert.equal(getLibraryTotalPages(18_132), 1_001)
  assert.equal(getLibraryTotalPages(10_010), 1_001)
  assert.equal(getLibraryTotalPages(10_011), 1_001)
  assert.equal(clampLibraryPage(1_001, getLibraryTotalPages(18_132)), 1_000)
  assert.deepEqual(resolveLibraryPageInput('1002', getLibraryTotalPages(18_132)), {
    page: 1_000,
    oneBasedPage: 1_001,
    wasClamped: true
  })
})

test('keeps the visible page window stable at the beginning, middle, and end', () => {
  assert.deepEqual(getLibraryPageWindow(0, 18), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(getLibraryPageWindow(8, 18), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  assert.deepEqual(getLibraryPageWindow(17, 18), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  assert.deepEqual(getLibraryPageWindow(2, 4), [0, 1, 2, 3])
  assert.deepEqual(getLibraryPageWindow(5, 20, 5), [3, 4, 5, 6, 7])
})

test('resolves one-based page input safely and clamps numeric boundaries', () => {
  assert.deepEqual(resolveLibraryPageInput(' 3 ', 12), {
    page: 2,
    oneBasedPage: 3,
    wasClamped: false
  })
  assert.deepEqual(resolveLibraryPageInput('0', 12), {
    page: 0,
    oneBasedPage: 1,
    wasClamped: true
  })
  assert.deepEqual(resolveLibraryPageInput('999', 12), {
    page: 11,
    oneBasedPage: 12,
    wasClamped: true
  })
  assert.equal(resolveLibraryPageInput('', 12), null)
  assert.equal(resolveLibraryPageInput('1.5', 12), null)
  assert.equal(resolveLibraryPageInput('1e2', 12), null)
  assert.equal(resolveLibraryPageInput('หน้า 2', 12), null)
  assert.equal(resolveLibraryPageInput('1234567890', 12), null)
})

test('exposes a reusable and accessible top or bottom pagination contract', () => {
  assert.match(componentSource, /Author\/creator: nattapat2871 \(https:\/\/nattapat2871\.me\)/)
  assert.match(componentSource, /placement: LibraryPaginationPlacement/)
  assert.match(componentSource, /data-library-pagination=\{placement\}/)
  assert.match(componentSource, /normalizeIdSegment\(idPrefix\)[\s\S]*placement[\s\S]*normalizeIdSegment\(generatedId\)/)
  assert.match(componentSource, /<nav aria-label=\{`\$\{labels\.navigation\} \(\$\{placementLabel\}\)`\}/)
  assert.match(componentSource, /const shouldAnnounceResults = announceResults \?\? placement === 'top'/)
  assert.match(componentSource, /statusText\?: string/)
  assert.match(componentSource, /className="sr-only"[\s\S]*statusText/)
  assert.match(componentSource, /role=\{shouldAnnounceResults \? 'status' : undefined\}/)
  assert.match(componentSource, /aria-live=\{shouldAnnounceResults \? 'polite' : undefined\}/)
  assert.match(componentSource, /aria-current=\{safeCurrentPage === page \? 'page' : undefined\}/)
  assert.match(componentSource, /inputMode="numeric"/)
  assert.match(componentSource, /aria-invalid=\{Boolean\(pageInputError\)\}/)
  assert.match(componentSource, /aria-describedby=\{pageInputError \? errorId : undefined\}/)
  assert.match(componentSource, /role="alert"/)
  assert.match(componentSource, /resolveLibraryPageInput\(pageInput, totalPages\)/)
  assert.match(componentSource, /if \(nextPage !== currentPage\) onPageChange\(nextPage\)/)
  assert.match(componentSource, /if \(resolution\.page !== currentPage\) onPageChange\(resolution\.page\)/)
  assert.match(componentSource, /<label htmlFor=\{inputId\}[\s\S]*\{labels\.jumpToPage\}[\s\S]*<\/label>/)
})
