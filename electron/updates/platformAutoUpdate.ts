// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import type { StartupUpdateTarget } from '../../shared/startupUpdate.ts'

const MAX_UPDATE_BYTES = 512 * 1024 * 1024

export const getLinuxInstallCommand = (target: StartupUpdateTarget, installer: string, exists = fs.existsSync) => {
  if (!path.posix.isAbsolute(installer) || /[\0\r\n]/.test(installer)) throw new Error('Invalid Linux installer path.')
  const choices = target === 'linux-deb-x64'
    ? [['/usr/bin/apt-get', 'install', '--yes', installer]]
    : target === 'linux-rpm-x64'
      ? [['/usr/bin/dnf', 'install', '--assumeyes', installer], ['/usr/bin/zypper', '--non-interactive', 'install', installer]]
      : target === 'linux-pacman-x64' ? [['/usr/bin/pacman', '-U', '--noconfirm', installer]] : []
  const command = choices.find(([binary]) => exists(binary))
  if (!command || !exists('/usr/bin/pkexec')) throw new Error('A supported package manager and PolicyKit are required; use the manual installer.')
  // Never use a shell, disable signature checks, force downgrades, or repair
  // unrelated system packages automatically.
  return { file: '/usr/bin/pkexec', args: command }
}

const sha512 = async (file: string) => {
  const digest = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
  return digest.digest('base64')
}

export const replaceAppImageSafely = async (source: string, destination: string, expectedSha512: string) => {
  if (!path.isAbsolute(destination)) throw new Error('APPIMAGE must be an absolute path.')
  const info = await fs.promises.lstat(destination)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('APPIMAGE must be a regular file.')
  const token = crypto.randomUUID()
  const staged = path.join(path.dirname(destination), `.${path.basename(destination)}.${token}.update`)
  const backup = path.join(path.dirname(destination), `.${path.basename(destination)}.${token}.previous`)
  try {
    await fs.promises.copyFile(source, staged, fs.constants.COPYFILE_EXCL)
    if (await sha512(staged) !== expectedSha512) throw new Error('Staged AppImage checksum mismatch.')
    await fs.promises.chmod(staged, 0o755)
    await fs.promises.link(destination, backup)
    // Atomic on Linux: the old running executable stays valid; backup is kept.
    await fs.promises.rename(staged, destination)
    return backup
  } finally {
    await fs.promises.rm(staged, { force: true })
  }
}

const withDeadline = async <T>(task: Promise<T>, milliseconds: number, onTimeout = () => {}) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error('Automatic update timed out.')) }, milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

export const installPlatformAutoUpdate = async (options: {
  target: Exclude<StartupUpdateTarget, 'windows-x64'>
  feedBase: string
  version: string
  assertSafe: () => void
  onProgress: (percent: number) => void
  onInstalling: () => void
  relaunch: (executable?: string) => void
  quit: () => void
  beforeNativeQuit: () => void
  logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void }
}) => {
  const { AppImageUpdater, DebUpdater, RpmUpdater, PacmanUpdater, MacUpdater } = await import('electron-updater')
  const Updater = options.target === 'macos-universal' ? MacUpdater
    : options.target === 'linux-deb-x64' ? DebUpdater
      : options.target === 'linux-rpm-x64' ? RpmUpdater
        : options.target === 'linux-pacman-x64' ? PacmanUpdater : AppImageUpdater
  const updater = new Updater({ provider: 'generic', url: options.feedBase, useMultipleRangeRequest: false })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.allowPrerelease = false
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
  updater.logger = options.logger
  let lastError: Error | null = null
  updater.on('error', (error: Error) => { lastError = error; options.logger.warn('Automatic updater:', error.message) })
  updater.on('download-progress', ({ percent }: { percent: number }) => options.onProgress(percent))
  const checked = await withDeadline(updater.checkForUpdates(), 20000)
  if (!checked?.isUpdateAvailable || checked.updateInfo.version !== options.version) throw new Error('Automatic update feed does not match the announced release.')
  const feed = new URL(options.feedBase)
  const extension = options.target === 'macos-universal' ? '.zip'
    : options.target === 'linux-deb-x64' ? '.deb'
      : options.target === 'linux-rpm-x64' ? '.rpm'
        : options.target === 'linux-pacman-x64' ? '.pkg.tar.zst' : '.appimage'
  if (checked.updateInfo.files.length !== 1) throw new Error('Automatic update feed must identify one exact package.')
  for (const file of checked.updateInfo.files) {
    const url = new URL(file.url, feed)
    if (url.origin !== feed.origin || url.username || url.password || !url.pathname.toLowerCase().endsWith(extension)
      || !Number.isSafeInteger(file.size) || !file.size || file.size < 1 || file.size > MAX_UPDATE_BYTES || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
      throw new Error('Automatic update metadata failed validation.')
    }
  }
  const files = await withDeadline(updater.downloadUpdate(checked.cancellationToken), 300000, () => checked.cancellationToken?.cancel())
  if (lastError) throw lastError
  options.assertSafe()
  options.onInstalling()
  if (options.target === 'macos-universal') {
    // Native Squirrel verifies code signing. Never disable this requirement.
    const { autoUpdater: nativeUpdater } = await import('electron')
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        nativeUpdater.removeListener('update-downloaded', done)
        nativeUpdater.removeListener('error', failed)
      }
      const done = () => { cleanup(); resolve() }
      const failed = (error: Error) => { cleanup(); reject(error) }
      const timer = setTimeout(() => failed(new Error('Native macOS update staging timed out.')), 120000)
      nativeUpdater.once('update-downloaded', done)
      nativeUpdater.once('error', failed)
      try { nativeUpdater.checkForUpdates() } catch (error) { failed(error as Error) }
    })
    options.assertSafe()
    options.beforeNativeQuit()
    updater.quitAndInstall(true, true)
    return
  }
  const installer = files[0]
  const info = checked.updateInfo.files[0]
  if (!installer || !info || !fs.lstatSync(installer).isFile() || fs.lstatSync(installer).isSymbolicLink() || await sha512(installer) !== info.sha512) {
    throw new Error('Downloaded automatic installer checksum mismatch.')
  }
  if (options.target === 'linux-appimage-x64') {
    const destination = process.env.APPIMAGE || ''
    const backup = await replaceAppImageSafely(installer, destination, info.sha512)
    options.logger.info(`Previous AppImage retained at ${backup}`)
    options.relaunch(destination)
  } else {
    const command = getLinuxInstallCommand(options.target, installer)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, { shell: false, stdio: 'ignore' })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Package installation failed or authorization was cancelled (${code}).`)))
    })
    options.relaunch()
  }
  options.quit()
}
