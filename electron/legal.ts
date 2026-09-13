import axios from 'axios'
import legalBundle from '../shared/legal.json'
import { LAUNCHER_USER_AGENT } from './appIdentity'

// Author/creator: nattapat2871 (https://nattapat2871.me)

export type LegalLanguage = 'en' | 'th'

export type LegalSection = {
  title: string
  body: string
}

export type LegalDocument = {
  version: string
  updatedAt: string
  language: LegalLanguage
  title: string
  intro: string
  acceptance: string
  terms: LegalSection[]
  privacy: LegalSection[]
  references: Array<{ label: string; url: string }>
  source: 'remote' | 'bundled'
}

type LegalBundle = typeof legalBundle

const LEGAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/
const MAX_LEGAL_BUNDLE_BYTES = 512 * 1024
const MAX_LEGAL_SECTIONS = 32
const MAX_LEGAL_REFERENCES = 20
const MAX_LEGAL_TITLE_LENGTH = 240
const MAX_LEGAL_BODY_LENGTH = 12_000
const UNSAFE_LEGAL_TEXT_PATTERN = /[\u0000-\u001f\u007f]/
const ALLOWED_LEGAL_REFERENCE_HOSTS = new Set([
  'minecraft.net',
  'www.minecraft.net',
  'microsoft.com',
  'www.microsoft.com',
  'discord.com',
  'www.discord.com',
  'modrinth.com',
  'www.modrinth.com',
  'curseforge.com',
  'www.curseforge.com'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const isBoundedText = (value: unknown, maximum: number, minimum = 1) => (
  typeof value === 'string'
  && value.trim().length >= minimum
  && value.length <= maximum
  && !UNSAFE_LEGAL_TEXT_PATTERN.test(value)
)

const isLegalDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !LEGAL_DATE_PATTERN.test(value)) return false
  const calendarDate = value.split('.', 1)[0]
  const parsed = new Date(`${calendarDate}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === calendarDate
}

const parseLegalVersion = (value: string) => {
  const [calendarDate, revision = '0'] = value.split('.')
  return { calendarDate, revision: Number(revision) || 0 }
}

const isLegalSection = (value: unknown) => (
  isRecord(value)
  && isBoundedText(value.title, MAX_LEGAL_TITLE_LENGTH)
  && isBoundedText(value.body, MAX_LEGAL_BODY_LENGTH)
)

const isLegalSectionList = (value: unknown) => (
  Array.isArray(value)
  && value.length > 0
  && value.length <= MAX_LEGAL_SECTIONS
  && value.every(isLegalSection)
)

const isLegalReference = (value: unknown) => {
  if (!isRecord(value) || !isBoundedText(value.label, 160) || !isBoundedText(value.url, 2_048)) return false
  try {
    const parsed = new URL(value.url as string)
    return parsed.protocol === 'https:'
      && ALLOWED_LEGAL_REFERENCE_HOSTS.has(parsed.hostname.toLowerCase())
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
  } catch {
    return false
  }
}

const isLocalizedLegalDocument = (value: unknown) => (
  isRecord(value)
  && isBoundedText(value.title, MAX_LEGAL_TITLE_LENGTH)
  && isBoundedText(value.intro, 2_000)
  && isBoundedText(value.acceptance, 2_000)
  && isLegalSectionList(value.terms)
  && isLegalSectionList(value.privacy)
)

const toLegalDocument = (
  bundle: LegalBundle,
  language: LegalLanguage,
  source: LegalDocument['source']
): LegalDocument => {
  const localized = bundle.documents[language] || bundle.documents.en
  return {
    ...localized,
    version: bundle.version,
    // Revisions identify consent documents, but are not part of a calendar date.
    updatedAt: bundle.updatedAt.split('.', 1)[0],
    language,
    references: bundle.references,
    source
  }
}

const isLegalBundle = (value: unknown): value is LegalBundle => {
  if (!isRecord(value)) return false
  const candidate = value as Record<string, unknown>
  if (
    candidate.author !== legalBundle.author
    || !isLegalDate(candidate.version)
    || !isLegalDate(candidate.updatedAt)
    || candidate.updatedAt !== candidate.version
    || !isRecord(candidate.documents)
    || !isLocalizedLegalDocument(candidate.documents.en)
    || !isLocalizedLegalDocument(candidate.documents.th)
    || !Array.isArray(candidate.references)
    || candidate.references.length === 0
    || candidate.references.length > MAX_LEGAL_REFERENCES
    || !candidate.references.every(isLegalReference)
  ) return false

  const referenceUrls = candidate.references.map((reference) => (reference as Record<string, unknown>).url)
  return new Set(referenceUrls).size === referenceUrls.length
}

const isCurrentOrNewerBundle = (bundle: LegalBundle) => {
  const candidate = parseLegalVersion(bundle.version)
  const current = parseLegalVersion(legalBundle.version)
  return candidate.calendarDate > current.calendarDate
    || (candidate.calendarDate === current.calendarDate && candidate.revision >= current.revision)
}

export const getBundledLegalDocument = (language: LegalLanguage) => (
  toLegalDocument(legalBundle, language, 'bundled')
)

export const fetchLegalDocument = async (
  baseUrl: string,
  language: LegalLanguage
): Promise<LegalDocument> => {
  try {
    const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/legal.json`, {
      timeout: 8000,
      responseType: 'json',
      maxContentLength: MAX_LEGAL_BUNDLE_BYTES,
      maxBodyLength: MAX_LEGAL_BUNDLE_BYTES,
      headers: {
        Accept: 'application/json',
        'User-Agent': LAUNCHER_USER_AGENT
      }
    })
    if (!isLegalBundle(response.data) || !isCurrentOrNewerBundle(response.data)) {
      throw new Error('Legal document response is invalid or outdated.')
    }
    return toLegalDocument(response.data, language, 'remote')
  } catch {
    return getBundledLegalDocument(language)
  }
}
