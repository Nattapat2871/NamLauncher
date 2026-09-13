// Author/creator: nattapat2871 (https://nattapat2871.me)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  OFFLINE_USERNAME_ERROR_MESSAGE,
  isOfflineUsernameValidationError,
  isValidOfflineUsername,
  sanitizeOfflineUsernameInput
} from '../shared/offlineUsername.ts'
import { redactLabeledPlayerNames } from '../shared/privacyRedaction.ts'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')

test('accepts only Minecraft-compatible offline usernames at the length boundaries', () => {
  for (const value of ['abc', 'abc_123', 'abcdefghijklmnop']) {
    assert.equal(isValidOfflineUsername(value), true, `${value} should be valid`)
  }

  for (const value of [
    'ab',
    'abcdefghijklmnopq',
    'ชื่อไทย',
    '玩家',
    'abc😊',
    'abc-def',
    'abc def'
  ]) {
    assert.equal(isValidOfflineUsername(value), false, `${value} should be invalid`)
  }
})

test('sanitizes typing and paste input without allowing unsupported characters or overflow', () => {
  assert.equal(sanitizeOfflineUsernameInput('ชื่อไทย'), '')
  assert.equal(sanitizeOfflineUsernameInput('Player_ไทย-01!'), 'Player_01')
  assert.equal(sanitizeOfflineUsernameInput('abcdefghijklmnopq'), 'abcdefghijklmnop')
})

test('recognizes the offline validation rejection through the wrapped IPC message', () => {
  assert.equal(isOfflineUsernameValidationError(OFFLINE_USERNAME_ERROR_MESSAGE), true)
  assert.equal(
    isOfflineUsernameValidationError(`Error invoking remote method 'login-offline': Error: ${OFFLINE_USERNAME_ERROR_MESSAGE}`),
    true
  )
  assert.equal(isOfflineUsernameValidationError('Unexpected IPC crash'), false)
})

test('redacts labeled player values without corrupting ordinary validation prose', () => {
  assert.equal(
    redactLabeledPlayerNames('username: SecretPlayer'),
    'username: [redacted-player]'
  )
  assert.equal(
    redactLabeledPlayerNames('Login successful for user: SecretPlayer'),
    'Login successful for user: [redacted-player]'
  )
  assert.equal(
    redactLabeledPlayerNames('Offline login request for user: SecretPlayer'),
    'Offline login request for user: [redacted-player]'
  )
  assert.equal(
    redactLabeledPlayerNames(OFFLINE_USERNAME_ERROR_MESSAGE),
    OFFLINE_USERNAME_ERROR_MESSAGE
  )
  assert.equal(
    redactLabeledPlayerNames('offline profile is joining an online-mode server'),
    'offline profile is joining an online-mode server'
  )
})

test('wires input-time validation, accessible guidance, and backend enforcement', () => {
  assert.match(appSource, /sanitizeOfflineUsernameInput\(event\.target\.value\)/)
  assert.match(appSource, /isValidOfflineUsername\(offlineName\)/)
  assert.match(appSource, /htmlFor="offline-username"/)
  assert.match(appSource, /aria-describedby="offline-username-requirements"/)
  assert.match(appSource, /aria-invalid=\{offlineNameInputRejected\}/)
  assert.match(appSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="login-modal-title"/)
  assert.equal((appSource.match(/id="login-modal-title"/g) || []).length, 2)
  assert.match(appSource, /data-launcher-autofocus="true"/)
  assert.match(appTextSource, /'auth\.offline\.requirements':/)
  assert.match(appTextSource, /'auth\.offline\.invalidCharacters':/)
  assert.match(mainSource, /if \(!isValidOfflineUsername\(cleanName\)\)/)
  assert.match(mainSource, /throw new Error\(OFFLINE_USERNAME_ERROR_MESSAGE\)/)
})

test('keeps invalid offline names out of automatic launcher error reports', () => {
  assert.match(preloadSource, /isOfflineUsernameValidationError\(message\)/)
  assert.match(mainSource, /isOfflineUsernameValidationError\(detail\)/)
  assert.match(mainSource, /redactLabeledPlayerNames\(text\)/)
})
