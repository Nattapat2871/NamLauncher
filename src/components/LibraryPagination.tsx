// Author/creator: nattapat2871 (https://nattapat2871.me)

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_LIBRARY_PAGE_SIZE,
  DEFAULT_LIBRARY_PAGE_WINDOW,
  clampLibraryPage,
  getLibraryPageWindow,
  getLibraryTotalPages,
  resolveLibraryPageInput
} from '../libraryPagination'

export type LibraryPaginationPlacement = 'top' | 'bottom'

export type LibraryPaginationLabels = Readonly<{
  navigation: string
  top: string
  bottom: string
  previous: string
  next: string
  jumpToPage: string
  go: string
  invalidPage: string
  loading?: string
  pageButton: (oneBasedPage: number) => string
}>

export type LibraryPaginationProps = Readonly<{
  idPrefix: string
  placement: LibraryPaginationPlacement
  currentPage: number
  totalHits: number
  resultText: string
  statusText?: string
  labels: LibraryPaginationLabels
  onPageChange: (page: number) => void
  pageSize?: number
  maxVisiblePages?: number
  loading?: boolean
  announceResults?: boolean
  className?: string
}>

const normalizeIdSegment = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.replace(/^-+|-+$/g, '') || 'library-pagination'
}

export const LibraryPagination = ({
  idPrefix,
  placement,
  currentPage,
  totalHits,
  resultText,
  statusText,
  labels,
  onPageChange,
  pageSize = DEFAULT_LIBRARY_PAGE_SIZE,
  maxVisiblePages = DEFAULT_LIBRARY_PAGE_WINDOW,
  loading = false,
  announceResults,
  className = ''
}: LibraryPaginationProps) => {
  const generatedId = useId()
  const idBase = useMemo(() => [
    normalizeIdSegment(idPrefix),
    placement,
    normalizeIdSegment(generatedId)
  ].join('-'), [generatedId, idPrefix, placement])
  const totalPages = getLibraryTotalPages(totalHits, pageSize)
  const safeCurrentPage = clampLibraryPage(currentPage, totalPages)
  const pageNumbers = getLibraryPageWindow(safeCurrentPage, totalPages, maxVisiblePages)
  const [pageInput, setPageInput] = useState(String(safeCurrentPage + 1))
  const [pageInputError, setPageInputError] = useState('')
  const pageInputRef = useRef<HTMLInputElement | null>(null)
  const placementLabel = labels[placement]
  const shouldAnnounceResults = announceResults ?? placement === 'top'
  const inputId = `${idBase}-page-input`
  const errorId = `${idBase}-page-error`

  useEffect(() => {
    setPageInput(String(safeCurrentPage + 1))
    setPageInputError('')
  }, [safeCurrentPage, totalPages])

  const requestPage = (page: number) => {
    if (loading) return
    setPageInputError('')
    const nextPage = clampLibraryPage(page, totalPages)
    setPageInput(String(nextPage + 1))
    if (nextPage !== currentPage) onPageChange(nextPage)
  }

  const submitPageJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    const resolution = resolveLibraryPageInput(pageInput, totalPages)
    if (!resolution) {
      setPageInputError(labels.invalidPage)
      pageInputRef.current?.focus()
      return
    }

    setPageInputError('')
    setPageInput(String(resolution.oneBasedPage))
    if (resolution.page !== currentPage) onPageChange(resolution.page)
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 p-4 ${className}`.trim()}
      data-library-pagination={placement}
    >
      <p
        className="text-xs font-bold text-slate-500"
        role={shouldAnnounceResults ? 'status' : undefined}
        aria-live={shouldAnnounceResults ? 'polite' : undefined}
        aria-atomic={shouldAnnounceResults ? 'true' : undefined}
      >
        {shouldAnnounceResults && !loading && statusText ? (
          <>
            <span aria-hidden="true">{resultText}</span>
            <span className="sr-only">{statusText}</span>
          </>
        ) : (loading && labels.loading ? labels.loading : resultText)}
      </p>

      <nav aria-label={`${labels.navigation} (${placementLabel})`} className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={loading || safeCurrentPage === 0}
          onClick={() => requestPage(safeCurrentPage - 1)}
          className="h-9 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-300 transition-colors duration-150 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {labels.previous}
        </button>

        <div className="flex items-center gap-0.5">
          {pageNumbers[0] > 0 && (
            <span className="px-1 text-xs font-black text-slate-600" aria-hidden="true">…</span>
          )}
          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              disabled={loading}
              onClick={() => requestPage(page)}
              aria-current={safeCurrentPage === page ? 'page' : undefined}
              aria-label={labels.pageButton(page + 1)}
              className={`relative h-9 min-w-8 rounded-md px-2 font-mono text-xs font-black transition-colors ${
                safeCurrentPage === page
                  ? 'bg-blue-500/12 text-blue-100 after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-blue-300'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-100'
              }`}
            >
              {page + 1}
            </button>
          ))}
          {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
            <span className="px-1 text-xs font-black text-slate-600" aria-hidden="true">…</span>
          )}
        </div>

        <button
          type="button"
          disabled={loading || safeCurrentPage >= totalPages - 1}
          onClick={() => requestPage(safeCurrentPage + 1)}
          className="h-9 rounded-md border border-slate-700 px-3 text-xs font-black text-slate-300 transition-colors duration-150 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {labels.next}
        </button>

        <form className="ml-1 flex shrink-0 items-center gap-1.5" onSubmit={submitPageJump} noValidate>
          <label htmlFor={inputId} className="shrink-0 whitespace-nowrap text-[11px] font-black text-slate-500">
            {labels.jumpToPage}
          </label>
          <div className="relative">
            <input
              ref={pageInputRef}
              id={inputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={9}
              value={pageInput}
              onChange={(event) => {
                setPageInput(event.target.value)
                if (pageInputError) setPageInputError('')
              }}
              onFocus={(event) => event.currentTarget.select()}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(pageInputError)}
              aria-describedby={pageInputError ? errorId : undefined}
              className="h-9 w-16 rounded-md border border-slate-700 bg-slate-950/40 px-2 text-center font-mono text-xs font-black tabular-nums text-slate-100 outline-none transition-colors focus:border-blue-400/60 disabled:cursor-wait disabled:opacity-50"
            />
            {pageInputError && (
              <span id={errorId} className="sr-only" role="alert">{pageInputError}</span>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-9 rounded-md border border-blue-400/35 bg-blue-500/10 px-2.5 text-xs font-black text-blue-100 transition-colors hover:bg-blue-500/20 disabled:cursor-wait disabled:opacity-50"
          >
            {labels.go}
          </button>
        </form>
      </nav>
    </div>
  )
}

export default LibraryPagination
