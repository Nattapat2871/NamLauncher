// Author/creator: nattapat2871 (https://nattapat2871.me)

import { LIBRARY_SEARCH_MAX_OFFSET } from '../shared/librarySearchFilters.ts'

export const DEFAULT_LIBRARY_PAGE_SIZE = 10
export const DEFAULT_LIBRARY_PAGE_WINDOW = 10

const normalizePositiveInteger = (value: number, fallback: number) => (
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : fallback
)

export const getLibraryTotalPages = (
  totalHits: number,
  pageSize = DEFAULT_LIBRARY_PAGE_SIZE,
  maxOffset = LIBRARY_SEARCH_MAX_OFFSET
) => {
  const safePageSize = normalizePositiveInteger(pageSize, DEFAULT_LIBRARY_PAGE_SIZE)
  const safeTotalHits = Number.isFinite(totalHits) ? Math.max(0, Math.trunc(totalHits)) : 0
  const safeMaxOffset = Number.isFinite(maxOffset)
    ? Math.max(0, Math.trunc(maxOffset))
    : LIBRARY_SEARCH_MAX_OFFSET
  const providerPageLimit = Math.floor(safeMaxOffset / safePageSize) + 1
  return Math.min(providerPageLimit, Math.max(1, Math.ceil(safeTotalHits / safePageSize)))
}

export const clampLibraryPage = (page: number, totalPages: number) => {
  const safeTotalPages = normalizePositiveInteger(totalPages, 1)
  const safePage = Number.isFinite(page) ? Math.trunc(page) : 0
  return Math.min(Math.max(0, safePage), safeTotalPages - 1)
}

export const getLibraryPageWindow = (
  currentPage: number,
  totalPages: number,
  maxVisiblePages = DEFAULT_LIBRARY_PAGE_WINDOW
) => {
  const safeTotalPages = normalizePositiveInteger(totalPages, 1)
  const windowSize = Math.min(
    safeTotalPages,
    normalizePositiveInteger(maxVisiblePages, DEFAULT_LIBRARY_PAGE_WINDOW)
  )
  const safeCurrentPage = clampLibraryPage(currentPage, safeTotalPages)
  const pagesBeforeCurrent = Math.floor((windowSize - 1) / 2)
  const windowStart = Math.min(
    Math.max(0, safeCurrentPage - pagesBeforeCurrent),
    safeTotalPages - windowSize
  )

  return Array.from({ length: windowSize }, (_, index) => windowStart + index)
}

export type LibraryPageInputResolution = Readonly<{
  page: number
  oneBasedPage: number
  wasClamped: boolean
}>

export const resolveLibraryPageInput = (
  rawValue: string,
  totalPages: number
): LibraryPageInputResolution | null => {
  const normalizedValue = rawValue.trim()
  if (!/^[0-9]{1,9}$/.test(normalizedValue)) return null

  const requestedPage = Number(normalizedValue)
  if (!Number.isSafeInteger(requestedPage)) return null

  const safeTotalPages = normalizePositiveInteger(totalPages, 1)
  const oneBasedPage = Math.min(Math.max(1, requestedPage), safeTotalPages)
  return {
    page: oneBasedPage - 1,
    oneBasedPage,
    wasClamped: oneBasedPage !== requestedPage
  }
}
