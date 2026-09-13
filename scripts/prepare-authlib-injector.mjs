import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const version = '1.2.7'
const expectedSha256 = 'eaf14bc5acffc7d885bd5bd5942b99f36d6299302beae356b2fc5807fe42652b'
const sourceCommit = '4d92d3b2cb62f06484ddef44ccd70490db29b8cd'
const outputDirectory = path.resolve('build')
const jarPath = path.join(outputDirectory, `authlib-injector-${version}.jar`)
const licensePath = path.join(outputDirectory, 'authlib-injector-LICENSE.txt')
const jarUrl = `https://github.com/yushijinhun/authlib-injector/releases/download/v${version}/authlib-injector-${version}.jar`
const licenseUrl = `https://raw.githubusercontent.com/yushijinhun/authlib-injector/${sourceCommit}/LICENSE`

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const fetchBuffer = async (url) => {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

await mkdir(outputDirectory, { recursive: true })

let jar = null
try {
  const cached = await readFile(jarPath)
  if (sha256(cached) === expectedSha256) jar = cached
} catch {
  // The pinned artifact will be downloaded below.
}

if (!jar) {
  jar = await fetchBuffer(jarUrl)
  const actualSha256 = sha256(jar)
  if (actualSha256 !== expectedSha256) {
    throw new Error(`authlib-injector checksum mismatch: expected ${expectedSha256}, received ${actualSha256}`)
  }
  await writeFile(jarPath, jar)
}

try {
  await readFile(licensePath)
} catch {
  await writeFile(licensePath, await fetchBuffer(licenseUrl))
}

process.stdout.write(`authlib-injector ${version} ready (${expectedSha256.slice(0, 12)}…)\n`)
