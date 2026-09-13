// Author/creator: nattapat2871 (https://nattapat2871.me)
import crypto from 'node:crypto'
import fs from 'node:fs'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const normalizeLauncherInstallerSha256 = (value: unknown) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SHA256_PATTERN.test(normalized) ? normalized : null
}

export const getFileSha256 = (filePath: string) => (
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
)

export const assertFileSha256 = (filePath: string, expectedSha256: unknown) => {
  const normalized = normalizeLauncherInstallerSha256(expectedSha256)
  if (!normalized) throw new Error('The launcher release does not provide a valid SHA-256 checksum.')
  const actual = getFileSha256(filePath)
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(normalized, 'hex'))) {
    throw new Error('The launcher installer failed SHA-256 integrity verification.')
  }
  return normalized
}
