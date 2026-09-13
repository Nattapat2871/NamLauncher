import assert from 'node:assert/strict'
// Author/creator: nattapat2871 (https://nattapat2871.me)
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')
const storageSource = await readFile(new URL('../src/storageKeys.ts', import.meta.url), 'utf8')
const legalSource = await readFile(new URL('../electron/legal.ts', import.meta.url), 'utf8')
const legalBundle = JSON.parse(await readFile(new URL('../shared/legal.json', import.meta.url), 'utf8'))

test('exposes a valid display date without losing the legal consent revision', () => {
  const module = { exports: {} }
  const compiled = ts.transpileModule(legalSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  } }).outputText
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name === '../shared/legal.json') return legalBundle
    if (name === './appIdentity') return { LAUNCHER_USER_AGENT: 'test' }
    if (name === 'axios') return {}
    throw new Error(`Unexpected legal test dependency: ${name}`)
  } })
  for (const language of ['en', 'th']) {
    const document = module.exports.getBundledLegalDocument(language)
    assert.equal(document.version, '2026-09-14.1')
    assert.equal(document.updatedAt, '2026-09-14')
    assert.equal(new Date(document.updatedAt).toISOString().slice(0, 10), '2026-09-14')
  }
})

test('requires acceptance of the current legal document version on first launch', () => {
  assert.match(storageSource, /namlauncher_legal_acceptance_v1/)
  assert.match(appSource, /setShowFirstRunSetup\(acceptedVersion !== document\.version\)/)
  assert.match(appSource, /type="checkbox"[\s\S]*checked=\{legalAccepted\}/)
  assert.match(appSource, /disabled=\{!legalDocument \|\| !legalAccepted\}/)
  assert.doesNotMatch(appSource, /chooseFirstRunDataLocation/)
})

test('stores legal acceptance and returns to the launcher after acceptance', () => {
  assert.match(appSource, /const acceptLegalTerms = \(\) => \{/)
  assert.match(appSource, /localStorage\.setItem\(storage\.legalAcceptance/)
  assert.match(appSource, /version: legalDocument\.version/)
  assert.match(appSource, /acceptedAt: new Date\(\)\.toISOString\(\)/)
  assert.match(appSource, /setShowFirstRunSetup\(false\)/)
})

test('ships complete bilingual player terms and privacy notices', () => {
  assert.equal(legalBundle.author, 'nattapat2871 (https://nattapat2871.me)')
  assert.equal(legalBundle.version, '2026-09-14.1')
  assert.equal(legalBundle.updatedAt, legalBundle.version)
  for (const language of ['en', 'th']) {
    assert.ok(legalBundle.documents[language].terms.length >= 15)
    assert.ok(legalBundle.documents[language].privacy.length >= 10)
    assert.ok(legalBundle.documents[language].acceptance.length > 20)
    for (const section of [
      ...legalBundle.documents[language].terms,
      ...legalBundle.documents[language].privacy
    ]) {
      assert.ok(section.title.length > 3)
      assert.ok(section.body.length > 20)
      assert.doesNotMatch(section.body, /<script|javascript:/i)
    }
  }
  assert.ok(legalBundle.references.length >= 6)
})

test('preserves GPL freedoms while protecting hosted systems and official branding', () => {
  const english = legalBundle.documents.en.terms.map((section) => section.body).join(' ').toLowerCase()
  const thai = legalBundle.documents.th.terms.map((section) => section.body).join(' ').toLowerCase()

  for (const phrase of [
    'reverse engineer',
    'run',
    'study',
    'copy',
    'modify',
    'impersonate',
    'credentials',
    'malware',
    'automation',
    'redistribute',
    'gpl-3.0-only',
    'hosted services',
    'trademark',
    'private service code',
    'applicable law',
    'good-faith security research',
    'responsible disclosure'
  ]) assert.ok(english.includes(phrase), `Missing protected-use term: ${phrase}`)

  assert.match(thai, /gpl-3\.0-only/)
  assert.match(thai, /กฎหมาย/)
  assert.match(thai, /การวิจัยความปลอดภัยโดยสุจริต/)
  assert.match(thai, /ระบบหรือข้อมูลโดยไม่มีสิทธิ์/)
})

test('documents actual retention, required processing, optional controls, and deletion choices', () => {
  const privacy = legalBundle.documents.en.privacy.map((section) => section.body).join(' ').toLowerCase()
  for (const phrase of [
    '7 days',
    '30 days',
    '90 days',
    'cannot be disabled',
    'does not sell personal data',
    'browser local storage',
    'os-backed encryption',
    'automatically submits',
    'player confirmation',
    'offline profiles',
    'discord',
    'request access, correction, or deletion'
  ]) assert.ok(privacy.includes(phrase), `Missing privacy disclosure: ${phrase}`)
})

test('renders legal section numbers exactly once', () => {
  assert.match(appSource, />\{section\.title\}<\/h4>/)
  assert.doesNotMatch(appSource, /\{index \+ 1\}\. \{section\.title\}/)
  for (const language of ['en', 'th']) {
    for (const group of ['terms', 'privacy']) {
      for (const section of legalBundle.documents[language][group]) {
        assert.doesNotMatch(section.title, /^\s*\d+[A-Z]?\.\s+\d+[A-Z]?\./i)
      }
    }
  }
})

test('discloses exact Discord player-head identifiers without a mismatched account fallback', () => {
  const english = legalBundle.documents.en.privacy.map((section) => section.body).join(' ').toLowerCase()
  const thai = legalBundle.documents.th.privacy.map((section) => section.body).join(' ').toLowerCase()

  for (const phrase of [
    'mc-heads.net',
    'verified public minecraft texture id',
    'legacy callers of the head-image helper',
    'profile uuid or name',
    'omits the small player image',
    'wrong head'
  ]) assert.ok(english.includes(phrase), `Missing Discord head disclosure: ${phrase}`)

  assert.doesNotMatch(english, /safe account fallback|account-image fallback/)
  assert.match(thai, /mc-heads\.net/)
  assert.match(thai, /texture id/)
  assert.match(thai, /uuid หรือชื่อโปรไฟล์/)
  assert.match(thai, /ไม่ส่งภาพผู้เล่นขนาดเล็ก/)
  assert.match(thai, /แสดงหัวผิด/)
})

test('uses unique bounded HTTPS references and validates remote legal bundles defensively', () => {
  const referenceUrls = new Set()
  for (const reference of legalBundle.references) {
    const parsed = new URL(reference.url)
    assert.equal(parsed.protocol, 'https:')
    assert.equal(parsed.username, '')
    assert.equal(parsed.password, '')
    assert.ok(parsed.port === '' || parsed.port === '443')
    assert.equal(referenceUrls.has(parsed.href), false)
    referenceUrls.add(parsed.href)
  }

  assert.match(legalSource, /MAX_LEGAL_BUNDLE_BYTES = 512 \* 1024/)
  assert.match(legalSource, /ALLOWED_LEGAL_REFERENCE_HOSTS/)
  assert.match(legalSource, /const isLegalDate/)
  assert.match(legalSource, /const parseLegalVersion/)
  assert.ok(legalSource.includes("parsed.protocol === 'https:'"))
  assert.match(legalSource, /maxContentLength: MAX_LEGAL_BUNDLE_BYTES/)
  assert.match(legalSource, /candidate\.author !== legalBundle\.author/)
  assert.match(legalSource, /candidate\.updatedAt !== candidate\.version/)
  assert.match(legalSource, /isCurrentOrNewerBundle/)
  const localizedSpread = legalSource.indexOf('...localized')
  assert.ok(localizedSpread >= 0)
  assert.ok(legalSource.indexOf('version: bundle.version', localizedSpread) > localizedSpread)
})

test('lets users reopen and refresh the legal document from Settings', () => {
  assert.match(appTextSource, /settings\.legal\.button/)
  assert.match(appSource, /const openLegalReview = async \(\) =>/)
  assert.match(appSource, /getLegalDocument\(language\)/)
  assert.match(appSource, /onClick=\{openLegalReview\}/)
})
