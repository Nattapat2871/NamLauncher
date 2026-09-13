// Author/creator: nattapat2871 (https://nattapat2871.me)
// Opt-in only: the existing unsigned DMG workflow remains unchanged.
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const base = require('../../package.json').build
const run = promisify(execFile)

module.exports = {
  ...base,
  forceCodeSigning: true,
  mac: {
    ...base.mac,
    identity: process.env.CSC_NAME || undefined,
    notarize: true,
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }]
  },
  afterSign: async (context) => {
    const application = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
    const signature = await run('/usr/bin/codesign', ['--display', '--verbose=4', application])
    if (!/^Authority=Developer ID Application:/m.test(signature.stderr) || !/^TeamIdentifier=[A-Z0-9]+$/m.test(signature.stderr)) {
      throw new Error('Automatic macOS updates require a Developer ID Application signature; ad-hoc signing is not supported.')
    }
    // Fail closed if signing/notarization credentials were missing or invalid.
    await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', application])
  }
}
