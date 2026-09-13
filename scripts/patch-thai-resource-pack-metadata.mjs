// Author/creator: nattapat2871 (https://nattapat2871.me)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const archivePath = path.resolve(scriptDirectory, '..', 'build', 'resourcepacks', 'NamLauncher-Thai-Font.zip')
const archive = new AdmZip(archivePath)
const metadataEntry = archive.getEntry('pack.mcmeta')
if (!metadataEntry) throw new Error('NamLauncher Thai font pack is missing pack.mcmeta')

const metadata = JSON.parse(metadataEntry.getData().toString('utf8'))
if (
  metadata?.pack?.pack_format === 84
  && metadata?.pack?.min_format === 15
  && metadata?.pack?.max_format === 999
  && Array.isArray(metadata?.pack?.supported_formats)
  && metadata.pack.supported_formats[0] === 15
  && metadata.pack.supported_formats[1] === 999
) process.exit(0)

metadata.pack = {
  ...metadata.pack,
  pack_format: 84,
  supported_formats: [15, 999],
  min_format: 15,
  max_format: 999
}

archive.updateFile('pack.mcmeta', Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'))
archive.writeZip(archivePath)
