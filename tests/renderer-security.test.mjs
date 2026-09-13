// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const runtimeGlobals = await readFile(new URL('../public/runtime-globals.js', import.meta.url), 'utf8')

test('renderer CSP blocks inline script, plugins, embedding, and arbitrary network connections', () => {
  assert.match(html, /script-src 'self';/)
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/)
  assert.match(html, /object-src 'none'/)
  assert.match(html, /frame-ancestors 'none'/)
  assert.match(html, /base-uri 'none'/)
  const connectTokens = html.match(/connect-src\s+([^;]+);/)?.[1].trim().split(/\s+/) || []
  assert.ok(!connectTokens.includes('https:'), 'connect-src must not allow every HTTPS host')
  assert.match(html, /https:\/\/launchermeta\.mojang\.com/)
  assert.match(html, /<script type="module" src="\/runtime-globals\.js"><\/script>/)
})

test('browser compatibility shim exposes frozen empty environment data only', () => {
  assert.match(runtimeGlobals, /Object\.freeze\(\{ env: Object\.freeze\(\{\}\) \}\)/)
  assert.doesNotMatch(runtimeGlobals, /require\(|ipcRenderer|process\.env\s*=/)
})
