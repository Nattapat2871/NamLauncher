#!/usr/bin/env node
// Author/creator: nattapat2871 (https://nattapat2871.me)

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')

const fail = (message) => {
  throw new Error(`Release metadata gate failed: ${message}`)
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))

const runGit = (args) => execFileSync('git', args, {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
}).trim()

const main = async () => {
  const packageJson = await readJson(path.join(projectRoot, 'package.json'))
  const version = String(packageJson.version || '').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('package.json contains an invalid release version.')

  const changelog = await readFile(path.join(projectRoot, 'website', 'content', 'changelog.md'), 'utf8')
  const normalizedChangelog = changelog.replace(/\r\n?/g, '\n')
  const sectionStart = normalizedChangelog.indexOf(`## ${version}\n`)
  if (sectionStart < 0) fail(`changelog section ${version} is missing.`)

  const nextSection = normalizedChangelog.indexOf('\n## ', sectionStart + 4)
  const releaseSection = normalizedChangelog.slice(sectionStart, nextSection < 0 ? undefined : nextSection)
  if (/^commit:\s*pending\s*$/mi.test(releaseSection)) {
    fail(`changelog ${version} still contains commit: pending.`)
  }

  const commitMatch = releaseSection.match(/^commit:\s*([0-9a-f]{40})\s*$/m)
  if (!commitMatch) fail(`changelog ${version} must contain one full 40-character commit hash.`)

  const sourceCommit = commitMatch[1]
  try {
    runGit(['cat-file', '-e', `${sourceCommit}^{commit}`])
    runGit(['merge-base', '--is-ancestor', sourceCommit, 'HEAD'])
  } catch {
    fail(`changelog commit ${sourceCommit} is not an ancestor of HEAD.`)
  }

  process.stdout.write(`Release metadata verified: ${version} (${sourceCommit})\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
