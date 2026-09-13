# Author/creator: nattapat2871 (https://nattapat2871.me)
param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$LauncherPath,
  [Parameter(Mandatory=$true)][int]$ParentId,
  [Parameter(Mandatory=$true)][ValidateSet('all-users', 'current-user')][string]$InstallScope,
  [Parameter(Mandatory=$true)][string]$StatusPath,
  [Parameter(Mandatory=$true)][string]$CancellationPath,
  [Parameter(Mandatory=$true)][string]$AttemptId,
  [Parameter(Mandatory=$true)][string]$Nonce
)
$ErrorActionPreference = 'Stop'
$parentStopped = $false
$statusPathValidated = $false
function Write-UpdateStatus([string]$State, [string]$Detail, [int]$InstallerPid = 0) {
  if ($Detail.Length -gt 1000) { $Detail = $Detail.Substring(0, 1000) }
  $payload = [ordered]@{
    schemaVersion=1
    attemptId=$AttemptId
    nonce=$Nonce
    state=$State
    detail=$Detail
    at=[DateTime]::UtcNow.ToString('o')
    helperPid=$PID
  }
  if ($InstallerPid -gt 0) { $payload.installerPid = $InstallerPid }
  $status = $payload | ConvertTo-Json -Compress
  $temporary = $StatusPath + '.' + $Nonce + '.tmp'
  if (Test-Path -LiteralPath $temporary) { throw 'Unsafe automatic update temporary status path.' }
  [IO.File]::WriteAllText($temporary, $status, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $StatusPath -Force
}
function Test-UpdateCancelled() {
  if (-not (Test-Path -LiteralPath $CancellationPath)) { return $false }
  $marker = Get-Item -LiteralPath $CancellationPath
  if ($marker.PSIsContainer -or
      ($marker.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $marker.Length -lt 2 -or $marker.Length -gt 4096) {
    throw 'Unsafe automatic update cancellation marker.'
  }
  try { $payload = Get-Content -LiteralPath $CancellationPath -Raw | ConvertFrom-Json }
  catch { throw 'Invalid automatic update cancellation marker.' }
  if ($payload.schemaVersion -ne 1 -or $payload.attemptId -ne $AttemptId -or $payload.nonce -ne $Nonce) {
    throw 'Mismatched automatic update cancellation marker.'
  }
  return $true
}
try {
  $installer = Get-Item -LiteralPath $InstallerPath
  $launcher = Get-Item -LiteralPath $LauncherPath
  $workDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
  $expectedStatusName = 'startup-install-status-' + $AttemptId + '.json'
  $expectedCancellationName = 'startup-install-cancel-' + $AttemptId + '.json'
  $expectedHelperName = 'install-startup-update-' + $AttemptId + '.ps1'
  if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
      $AttemptId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' -or
      $Nonce -notmatch '^[0-9a-fA-F]{64}$' -or $ParentId -lt 1 -or
      $installer.PSIsContainer -or $launcher.PSIsContainer -or
      $installer.Extension -ne '.exe' -or $launcher.Extension -ne '.exe' -or
      ($installer.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      ($launcher.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $installer.DirectoryName -ne $workDirectory -or
      [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($StatusPath)) -ne $workDirectory -or
      [IO.Path]::GetFileName($StatusPath) -ne $expectedStatusName -or
      [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($CancellationPath)) -ne $workDirectory -or
      [IO.Path]::GetFileName($CancellationPath) -ne $expectedCancellationName -or
      [IO.Path]::GetFileName($PSCommandPath) -ne $expectedHelperName) {
    throw 'Unsafe automatic update paths.'
  }
  foreach ($candidate in @($StatusPath, ($StatusPath + '.' + $Nonce + '.tmp'), $CancellationPath)) {
    if ((Test-Path -LiteralPath $candidate) -and
        ((Get-Item -LiteralPath $candidate).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Unsafe automatic update status path.'
    }
  }
  if (Test-UpdateCancelled) { throw 'Automatic installer handoff was cancelled.' }
  $statusPathValidated = $true
  if ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash -ne $ExpectedSha256) {
    throw 'Automatic installer checksum mismatch.'
  }
  $parent = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
  if (-not $parent -or [IO.Path]::GetFullPath($parent.Path) -ne $launcher.FullName) {
    throw 'The update parent is not the expected launcher.'
  }
  Write-UpdateStatus 'ready' 'Waiting for the launcher to exit.'
  # Never kill the launcher or games. Failure to exit safely aborts the install.
  $exitDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not $parent.HasExited) {
    if (Test-UpdateCancelled) { throw 'Automatic installer handoff was cancelled.' }
    if ([DateTime]::UtcNow -ge $exitDeadline) { throw 'The launcher did not exit safely.' }
    Start-Sleep -Milliseconds 100
    $parent.Refresh()
  }
  if (Test-UpdateCancelled) { throw 'Automatic installer handoff was cancelled.' }
  $parentStopped = $true
  $verifiedInstaller = Get-Item -LiteralPath $InstallerPath
  if ($verifiedInstaller.PSIsContainer -or
      ($verifiedInstaller.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $verifiedInstaller.FullName -ne $installer.FullName -or
      (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash -ne $ExpectedSha256) {
    throw 'Automatic installer changed before execution.'
  }
  if (Test-UpdateCancelled) { throw 'Automatic installer handoff was cancelled.' }
  # NSIS requires /D last, without quotes; it consumes the remaining path.
  # Preserve the verified registered installation scope. All Users updates
  # still show the normal Windows UAC confirmation; Current User updates stay
  # silent. NSIS requires /D last and consumes the remaining path.
  $scopeArgument = if ($InstallScope -eq 'all-users') { '/allusers' } else { '/currentuser' }
  $installerArguments = '/S --updated --force-run ' + $scopeArgument + ' /D=' + $launcher.DirectoryName
  $startOptions = @{ FilePath=$InstallerPath; ArgumentList=$installerArguments; PassThru=$true; WindowStyle='Hidden' }
  $installation = Start-Process @startOptions
  if (-not $installation -or $installation.Id -lt 1) { throw 'Windows did not start the verified installer.' }
  Write-UpdateStatus 'installing' 'Running the verified installer.' $installation.Id
  # Wait for the installer only, not its relaunched Electron process tree.
  $installation.WaitForExit()
  if ($installation.ExitCode -ne 0) { throw "Installer exited with code $($installation.ExitCode)." }
  Write-UpdateStatus 'installed' 'Installer completed successfully.' $installation.Id
} catch {
  $failureMessage = $_.Exception.Message
  if ($statusPathValidated) {
    try { Write-UpdateStatus 'failed' $failureMessage } catch { [Diagnostics.Debug]::WriteLine($_.Exception.Message) }
  }
  if (-not $parentStopped) { [Console]::Error.WriteLine($failureMessage) }
  if ($parentStopped -and (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) {
    # Return to the original manual update UI, without another automatic loop.
    Start-Process -FilePath $LauncherPath -ArgumentList '--auto-update-fallback'
  }
  exit 1
} finally {
  try {
    $helper = Get-Item -LiteralPath $PSCommandPath -ErrorAction SilentlyContinue
    if ($helper -and -not ($helper.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        $helper.DirectoryName -eq [IO.Path]::GetFullPath($PSScriptRoot) -and
        $helper.Name -eq ('install-startup-update-' + $AttemptId + '.ps1')) {
      Remove-Item -LiteralPath $helper.FullName -Force -ErrorAction SilentlyContinue
    }
  } catch { [Diagnostics.Debug]::WriteLine($_.Exception.Message) }
  try {
    $cancellation = Get-Item -LiteralPath $CancellationPath -ErrorAction SilentlyContinue
    if ($cancellation -and -not ($cancellation.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        $cancellation.DirectoryName -eq [IO.Path]::GetFullPath($PSScriptRoot) -and
        $cancellation.Name -eq ('startup-install-cancel-' + $AttemptId + '.json')) {
      Remove-Item -LiteralPath $cancellation.FullName -Force -ErrorAction SilentlyContinue
    }
  } catch { [Diagnostics.Debug]::WriteLine($_.Exception.Message) }
}
