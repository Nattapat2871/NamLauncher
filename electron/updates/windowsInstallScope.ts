// Author/creator: nattapat2871 (https://nattapat2871.me)
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export type WindowsInstallScope = 'all-users' | 'current-user'

export type WindowsUninstallRecord = Readonly<{
  hive: 'HKLM' | 'HKCU'
  installLocation?: string
  displayIcon?: string
  uninstallString?: string
}>

const normalizeWindowsDirectory = (value: string) => {
  const normalized = path.win32.normalize(value.trim().replace(/^"|"$/g, ''))
  return normalized.replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
}

const executableFromCommand = (value: string) => {
  const trimmed = value.trim()
  const quoted = /^"([^"]+\.exe)"/i.exec(trimmed)
  if (quoted) return quoted[1]
  const unquoted = /^(.+?\.exe)(?:\s|$)/i.exec(trimmed)
  return unquoted?.[1] || ''
}

const pathFromDisplayIcon = (value: string) => value.trim().replace(/^"|"$/g, '').replace(/,\s*-?\d+$/, '')

const recordMatchesLauncherDirectory = (launcherDirectory: string, record: WindowsUninstallRecord) => {
  const candidates = [
    record.installLocation || '',
    path.win32.dirname(executableFromCommand(record.uninstallString || '')),
    path.win32.dirname(pathFromDisplayIcon(record.displayIcon || ''))
  ].filter((candidate) => candidate && candidate !== '.')
  return candidates.some((candidate) => normalizeWindowsDirectory(candidate) === launcherDirectory)
}

export const resolveWindowsInstallScopeFromRecords = (
  launcherPath: string,
  records: readonly WindowsUninstallRecord[]
): WindowsInstallScope => {
  if (!path.win32.isAbsolute(launcherPath) || path.win32.extname(launcherPath).toLowerCase() !== '.exe') {
    throw new Error('Windows launcher path is invalid.')
  }
  const launcherDirectory = normalizeWindowsDirectory(path.win32.dirname(launcherPath))
  const scopes = new Set<WindowsInstallScope>()
  for (const record of records) {
    if (!recordMatchesLauncherDirectory(launcherDirectory, record)) continue
    scopes.add(record.hive === 'HKLM' ? 'all-users' : 'current-user')
  }
  if (scopes.size !== 1) {
    throw new Error(scopes.size > 1
      ? 'The NamLauncher installation scope is ambiguous.'
      : 'The NamLauncher installation scope was not found in Windows.')
  }
  return [...scopes][0]
}

const parseRegistryRecords = (value: string): WindowsUninstallRecord[] => {
  const parsed: unknown = JSON.parse(value)
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.flatMap((entry): WindowsUninstallRecord[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (record.hive !== 'HKLM' && record.hive !== 'HKCU') return []
    return [{
      hive: record.hive,
      installLocation: typeof record.installLocation === 'string' ? record.installLocation : '',
      displayIcon: typeof record.displayIcon === 'string' ? record.displayIcon : '',
      uninstallString: typeof record.uninstallString === 'string' ? record.uninstallString : ''
    }]
  })
}

export const resolveWindowsInstallScope = (launcherPath: string): WindowsInstallScope => {
  if (process.platform !== 'win32') throw new Error('Windows installation scope can only be read on Windows.')
  const powershellPath = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  )
  const source = [
    "$ErrorActionPreference = 'Stop'",
    "$records = @()",
    "$roots = @(@{ Hive='HKLM'; Path='Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }, @{ Hive='HKLM'; Path='Registry::HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' }, @{ Hive='HKCU'; Path='Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' })",
    "foreach ($root in $roots) {",
    "  if (-not (Test-Path -LiteralPath $root.Path)) { continue }",
    "  foreach ($key in Get-ChildItem -LiteralPath $root.Path -ErrorAction SilentlyContinue) {",
    "    $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue",
    "    if ($item.DisplayName -notlike 'NamLauncher*') { continue }",
    "    $records += [ordered]@{ hive=$root.Hive; installLocation=[string]$item.InstallLocation; displayIcon=[string]$item.DisplayIcon; uninstallString=[string]$item.UninstallString }",
    "  }",
    "}",
    "$records | ConvertTo-Json -Compress"
  ].join('\n')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const output = execFileSync(powershellPath, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 }).trim()
  return resolveWindowsInstallScopeFromRecords(launcherPath, output ? parseRegistryRecords(output) : [])
}
