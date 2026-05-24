!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\icons\icon.ico" 0 +4
    CreateShortCut "$DESKTOP\Baker Desk.lnk" "$INSTDIR\baker-desk.exe" "" "$INSTDIR\icons\icon.ico" 0
    CreateDirectory "$SMPROGRAMS"
    CreateShortCut "$SMPROGRAMS\Baker Desk.lnk" "$INSTDIR\baker-desk.exe" "" "$INSTDIR\icons\icon.ico" 0
!macroend

