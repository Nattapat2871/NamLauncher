// Author/creator: nattapat2871 (https://nattapat2871.me)

export const OFFLINE_USERNAME_MIN_LENGTH = 3
export const OFFLINE_USERNAME_MAX_LENGTH = 16
export const OFFLINE_USERNAME_HTML_PATTERN = '[A-Za-z0-9_]{3,16}'
export const OFFLINE_USERNAME_ERROR_MESSAGE = 'Offline username must be 3-16 characters and use only letters, numbers, or underscore.'

const OFFLINE_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/
const UNSUPPORTED_OFFLINE_USERNAME_CHARACTERS = /[^A-Za-z0-9_]/g

export const sanitizeOfflineUsernameInput = (value: unknown) => (
  String(value ?? '')
    .replace(UNSUPPORTED_OFFLINE_USERNAME_CHARACTERS, '')
    .slice(0, OFFLINE_USERNAME_MAX_LENGTH)
)

export const isValidOfflineUsername = (value: unknown) => (
  OFFLINE_USERNAME_PATTERN.test(String(value ?? ''))
)

export const isOfflineUsernameValidationError = (value: unknown) => (
  String(value ?? '').includes(OFFLINE_USERNAME_ERROR_MESSAGE)
)
