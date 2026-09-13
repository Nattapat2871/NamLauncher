// Author/creator: nattapat2871 (https://nattapat2871.me)
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'))
const packages = lock.packages || {}
const requiredNativePackages = []

for (const [packagePath, metadata] of Object.entries(packages)) {
  if (!packagePath.startsWith('node_modules/') || metadata.dev || metadata.optional) continue

  const packageRoot = path.join(projectRoot, packagePath)
  try {
    await access(path.join(packageRoot, 'binding.gyp'))
    requiredNativePackages.push(packagePath.slice('node_modules/'.length))
  } catch {
    // JavaScript-only production dependency.
  }
}

if (requiredNativePackages.length > 0) {
  throw new Error(
    `Native production dependencies require an Electron rebuild: ${requiredNativePackages.join(', ')}. `
      + 'Re-enable build.npmRebuild and use a supported platform compiler before packaging.'
  )
}

console.log('No required native production addons need an Electron rebuild.')
