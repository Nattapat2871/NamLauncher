import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/minecraft-launcher-core/package.json'
)

if (existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (packageJson.dependencies?.request) {
    delete packageJson.dependencies.request
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  }
}
