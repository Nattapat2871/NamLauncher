import fs from 'node:fs'
import path from 'node:path'
import { loadBuildEnvValue } from './env-utils.mjs'

const token = loadBuildEnvValue('NAMLAUNCHER_ERROR_REPORT_TOKEN')

if (!token) {
  console.error('NAMLAUNCHER_ERROR_REPORT_TOKEN is required to verify the packaged Electron main bundle.')
  process.exit(1)
}

const mainBundlePath = path.resolve('dist-electron', 'main.js')
if (!fs.existsSync(mainBundlePath)) {
  console.error(`Electron main bundle was not found at ${mainBundlePath}.`)
  process.exit(1)
}

const source = fs.readFileSync(mainBundlePath, 'utf8')

if (source.includes('__NAMLAUNCHER_ERROR_REPORT_TOKEN__')) {
  console.error('Electron main bundle still contains the token placeholder; Vite define injection did not run.')
  process.exit(1)
}

if (!source.includes(token)) {
  console.error('Electron main bundle does not contain the injected error report token.')
  process.exit(1)
}

process.stdout.write('Verified error report token injection in Electron main bundle.\n')
