// Author/creator: nattapat2871 (https://nattapat2871.me)
// This process intentionally exits immediately after the updater handshake so
// the isolated smoke test proves the detached PowerShell helper survives it.
import { readFile, writeFile } from 'node:fs/promises'
import { launchWindowsAutoInstaller } from '../../electron/updates/windowsAutoInstaller.ts'

const [requestPath, resultPath] = process.argv.slice(2)
if (!requestPath || !resultPath) throw new Error('Missing isolated updater handoff fixture paths.')
const options = JSON.parse(await readFile(requestPath, 'utf8'))
const handoff = await launchWindowsAutoInstaller(options)
await writeFile(resultPath, JSON.stringify(handoff), { flag: 'wx' })
