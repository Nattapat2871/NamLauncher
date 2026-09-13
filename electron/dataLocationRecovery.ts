// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  hasLauncherInstances,
  listCommonWindowsLauncherDataCandidates,
  selectUniqueLegacyLauncherDataPath
} from '../shared/dataLocationRecovery.ts'

const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:\\$/

export const getReadyFixedWindowsDriveRoots = () => {
  if (process.platform !== 'win32') return []

  try {
    const powershellPath = fs.realpathSync(path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ))
    const output = execFileSync(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [IO.DriveType]::Fixed -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName }'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 4_096
    })

    return Array.from(new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => WINDOWS_DRIVE_ROOT_PATTERN.test(value))
        .map((value) => value[0].toUpperCase() + value.slice(1))
    ))
  } catch {
    return []
  }
}

export const recoverLegacyLauncherDataPath = ({
  defaultDataPath,
  packagedDataPath
}: {
  defaultDataPath: string
  packagedDataPath: string
}) => {
  if (hasLauncherInstances(packagedDataPath)) return ''

  return selectUniqueLegacyLauncherDataPath({
    defaultDataPath,
    candidatePaths: listCommonWindowsLauncherDataCandidates(getReadyFixedWindowsDriveRoots()),
    excludedPaths: [packagedDataPath]
  })
}
