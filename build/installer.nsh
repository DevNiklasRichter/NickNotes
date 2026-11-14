; The per-user NickNotes service may run without the app (login autostart).
; Stop it before files are replaced and remove its autostart entry on a real uninstall.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM nicknotes-backend.exe'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM nicknotes-backend.exe'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NickNotes Dienst"
  ${endIf}
!macroend
