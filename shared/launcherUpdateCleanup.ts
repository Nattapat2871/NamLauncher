// Author/creator: nattapat2871 (https://nattapat2871.me)

export const LAUNCHER_UPDATE_CLEANUP_MAX_ATTEMPTS = 6

const LAUNCHER_UPDATE_CLEANUP_BASE_DELAY_MS = 500
const LAUNCHER_UPDATE_CLEANUP_MAX_DELAY_MS = 5_000
const RETRYABLE_LAUNCHER_UPDATE_CLEANUP_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

const getFileSystemErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code.toUpperCase() : ''
}

export const getLauncherUpdateCleanupRetryDelay = (error: unknown, attempt: number) => {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= LAUNCHER_UPDATE_CLEANUP_MAX_ATTEMPTS) {
    return null
  }
  if (!RETRYABLE_LAUNCHER_UPDATE_CLEANUP_CODES.has(getFileSystemErrorCode(error))) return null

  return Math.min(
    LAUNCHER_UPDATE_CLEANUP_BASE_DELAY_MS * (2 ** (attempt - 1)),
    LAUNCHER_UPDATE_CLEANUP_MAX_DELAY_MS
  )
}
