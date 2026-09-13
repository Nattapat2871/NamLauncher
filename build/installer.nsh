; Author/creator: nattapat2871 (https://nattapat2871.me)
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

!insertmacro GetFileName
!insertmacro GetParent

!macro customHeader
  BrandingText "NamLauncher Stable ${VERSION}"
!macroend

!ifndef BUILD_UNINSTALLER
!macro customInit
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "--choose-install-mode" $R9
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      ; Manual updates deliberately show electron-builder's guarded All Users
      ; / Current User page. The selected mode then restores its registered
      ; install directory, while automatic updates preserve the existing mode.
      StrCpy $hasPerMachineInstallation "0"
      StrCpy $hasPerUserInstallation "0"
      StrCpy $installMode ""
    ${EndIf}
  ${EndIf}
!macroend

Function NormalizeLauncherInstallDirectory
  ${GetFileName} "$INSTDIR" $0
  ${GetParent} "$INSTDIR" $1
  ${GetFileName} "$1" $2

  ${If} $0 == "Launcher"
  ${AndIf} $2 == "NamLauncher"
      Return
  ${EndIf}

  ${If} $0 == "NamLauncher"
    StrCpy $INSTDIR "$INSTDIR\Launcher"
  ${Else}
    StrCpy $INSTDIR "$INSTDIR\NamLauncher\Launcher"
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom NamLauncherInstallSummaryPageCreate
!macroend

Function NamLauncherInstallSummaryPageCreate
  Call NormalizeLauncherInstallDirectory

  ${GetParent} "$INSTDIR" $1

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "Ready to install NamLauncher"
  Pop $0

  ${NSD_CreateLabel} 0 22u 100% 24u "Click Next to install the launcher automatically using the locations below."
  Pop $0

  ${NSD_CreateLabel} 0 54u 100% 12u "Launcher application"
  Pop $0

  ${NSD_CreateText} 0 70u 100% 24u "$INSTDIR"
  Pop $0
  SendMessage $0 ${EM_SETREADONLY} 1 0

  ${NSD_CreateLabel} 0 105u 100% 12u "Minecraft instances, runtimes, cache, accounts, settings, and logs"
  Pop $0

  ${NSD_CreateText} 0 121u 100% 24u "$1\NamLauncher-data"
  Pop $0
  SendMessage $0 ${EM_SETREADONLY} 1 0

  ${NSD_CreateLabel} 0 157u 100% 32u "A NamLauncher shortcut will be created on the Desktop. The launcher will be ready to open when setup finishes."
  Pop $0

  nsDialogs::Show
FunctionEnd

!macro customInstall
  ${GetParent} "$INSTDIR" $1

  DetailPrint "NamLauncher setup: checking existing launcher data."
  IfFileExists "$1\NamLauncher-data\*.*" data_ready

  IfFileExists "$INSTDIR\data\*.*" 0 check_app_sibling_data
    DetailPrint "NamLauncher setup: moving legacy app data folder."
    Rename "$INSTDIR\data" "$1\NamLauncher-data"
    Goto data_ready

  check_app_sibling_data:
  IfFileExists "$INSTDIR-data\*.*" 0 check_root_data
    DetailPrint "NamLauncher setup: moving legacy sibling data folder."
    Rename "$INSTDIR-data" "$1\NamLauncher-data"
    Goto data_ready

  check_root_data:
  IfFileExists "$1\data\*.*" 0 check_root_sibling_data
    DetailPrint "NamLauncher setup: moving legacy root data folder."
    Rename "$1\data" "$1\NamLauncher-data"
    Goto data_ready

  check_root_sibling_data:
  IfFileExists "$1-data\*.*" 0 data_ready
    DetailPrint "NamLauncher setup: moving legacy root sibling data folder."
    Rename "$1-data" "$1\NamLauncher-data"

  data_ready:
  DetailPrint "NamLauncher setup: installing launcher files to $INSTDIR."
  DetailPrint "NamLauncher setup: launcher data will live in $1\NamLauncher-data."
  DetailPrint "NamLauncher setup: existing instances and game data are kept during updates."

!macroend
!endif

!ifdef BUILD_UNINSTALLER
  Var UnDeleteAllDataCheckbox
  Var UnDeleteAllDataState

  !macro customUnWelcomePage
    UninstPage custom un.NamLauncherUninstallOptionsPageCreate un.NamLauncherUninstallOptionsPageLeave
  !macroend

  Function un.NamLauncherUninstallOptionsPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Uninstall NamLauncher"
    Pop $0

    ${NSD_CreateLabel} 0 18u 100% 40u "NamLauncher will remove the launcher app. Instances, runtimes, cache, accounts, settings, and logs are kept unless you tick the option below."
    Pop $0

    ${NSD_CreateCheckbox} 0 66u 100% 24u "Delete all NamLauncher game data and settings"
    Pop $UnDeleteAllDataCheckbox
    ${NSD_SetState} $UnDeleteAllDataCheckbox ${BST_UNCHECKED}

    nsDialogs::Show
  FunctionEnd

  Function un.NamLauncherUninstallOptionsPageLeave
    ${NSD_GetState} $UnDeleteAllDataCheckbox $UnDeleteAllDataState
  FunctionEnd

  !macro customUnInstall
    DetailPrint "NamLauncher uninstall: removing launcher application files."

    ${If} $UnDeleteAllDataState == ${BST_CHECKED}
      ${GetFileName} "$INSTDIR" $0
      ${If} $0 == "Launcher"
        ${GetParent} "$INSTDIR" $1
      ${Else}
        StrCpy $1 "$INSTDIR"
      ${EndIf}

      DetailPrint "NamLauncher uninstall: deleting game data because the option was selected."
      SetOutPath "$TEMP"
      RMDir /r "$1\NamLauncher-data"
      RMDir /r "$1\data"
      RMDir /r "$1-data"
      RMDir /r "$INSTDIR\data"
      RMDir /r "$INSTDIR-data"
      RMDir /r "$APPDATA\NamLauncher"
      RMDir /r "$LOCALAPPDATA\NamLauncher"
    ${Else}
      DetailPrint "NamLauncher uninstall: keeping game data."
    ${EndIf}
  !macroend
!endif
