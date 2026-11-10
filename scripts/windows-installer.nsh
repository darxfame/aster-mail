; An update must wait for a graceful application exit, never kill an active writer.
!macro customCheckAppRunning
  StrCpy $R1 0
  aster_wait_for_exit:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        IntOp $R1 $R1 + 1
        ${if} $R1 < 60
          Sleep 500
          Goto aster_wait_for_exit
        ${endIf}
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY aster_wait_for_exit
      SetErrorLevel 2
      Quit
    ${endIf}
!macroend
