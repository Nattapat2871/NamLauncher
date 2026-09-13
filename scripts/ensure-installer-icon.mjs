import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ResEdit from 'resedit'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const [installerArg, iconArg] = process.argv.slice(2)

const installerPath = path.resolve(installerArg || path.join(projectRoot, 'release', `NamLauncher-${packageJson.version}-Installer.exe`))
const iconPath = path.resolve(iconArg || path.join(projectRoot, 'build', 'namlauncher.ico'))

if (!fs.existsSync(installerPath)) throw new Error(`Installer not found: ${installerPath}`)
if (!fs.existsSync(iconPath)) throw new Error(`Icon not found: ${iconPath}`)

const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath))
if (!Array.isArray(iconFile.icons) || iconFile.icons.length === 0) {
  throw new Error(`Icon file has no image entries: ${iconPath}`)
}

const executable = ResEdit.NtExecutable.from(fs.readFileSync(installerPath), { ignoreCert: true })
const resources = ResEdit.NtExecutableResource.from(executable)
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)

if (groups.length === 0 || groups.some((group) => group.icons.length === 0)) {
  throw new Error(`Installer icon resource could not be verified: ${installerPath}`)
}

console.log(`Verified installer icon resources in ${path.basename(installerPath)} (${groups.length} group${groups.length === 1 ? '' : 's'})`)
