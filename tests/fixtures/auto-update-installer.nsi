# Author/creator: nattapat2871 (https://nattapat2871.me)
Unicode true
!include FileFunc.nsh
!include LogicLib.nsh
Name "NamLauncher isolated updater fixture"
OutFile "${FIXTURE_OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
InstallDir "$TEMP\NamLauncher-isolated-fixture"
Section
  ${GetParameters} $0
  !ifdef FAIL_INSTALL
    SetErrorLevel 7
    Quit
  !endif
  FileOpen $0 "$INSTDIR\installed-version.txt" w
  FileWrite $0 "2.0.0-fixture"
  FileClose $0
  FileOpen $1 "$INSTDIR\installer-arguments.txt" w
  FileWrite $1 "$CMDLINE"
  FileClose $1
  Exec '"$INSTDIR\Launcher.exe" --updated'
SectionEnd
