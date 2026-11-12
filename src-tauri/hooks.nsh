!macro NSIS_HOOK_POSTINSTALL
  ; Создаем ярлык на рабочем столе для быстрого доступа
  CreateShortCut "$DESKTOP\OmniTool.lnk" "$INSTDIR\omnitool.exe" "" "$INSTDIR\omnitool.exe" 0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Удаляем ярлык с рабочего стола при деинсталляции
  Delete "$DESKTOP\OmniTool.lnk"
!macroend
