@echo off
rem Create a desktop shortcut for TraderTrain (with the app icon)
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make_shortcut.ps1" -Name "TraderTrain"
echo.
pause
endlocal
