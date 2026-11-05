@echo off
rem TraderTrain launcher
rem  - serves the project on a FIXED port 8733 (IndexedDB origin depends on it)
rem  - uses a dedicated Chrome profile (.chrome-profile) that holds the app data
setlocal
set PORT=8733
set ROOT=%~dp0
set PROFILE=%ROOT%.chrome-profile
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "PLOCAL=%LocalAppData%"

rem ---- pick a working python: the Windows Store "python" stub silently does nothing ----
set "PYEXE="
py -3 -c "print(1)" >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3"
if not defined PYEXE (
  python -c "print(1)" >nul 2>&1
  if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
  py -c "print(1)" >nul 2>&1
  if not errorlevel 1 set "PYEXE=py"
)

rem skip starting a second server if the port is already listening
netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  if defined PYEXE (
    start "" /min cmd /c "cd /d "%ROOT%" && %PYEXE% tools\serve.py --port %PORT% --root ."
  ) else (
    echo Python not found, falling back to PowerShell server
    start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\serve.ps1" -Port %PORT% -Root "%ROOT%"
  )
  timeout /t 3 /nobreak >nul
)

set URL=http://127.0.0.1:%PORT%/app/index.html
set "CHROME="
if exist "%PF%\Google\Chrome\Application\chrome.exe" set "CHROME=%PF%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%PF86%\Google\Chrome\Application\chrome.exe" set "CHROME=%PF86%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%PLOCAL%\Google\Chrome\Application\chrome.exe" set "CHROME=%PLOCAL%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%PF86%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME if exist "%PF%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%PF%\Microsoft\Edge\Application\msedge.exe"

if not defined CHROME (
  echo Chrome/Edge not found. Open manually: %URL%
  pause
  exit /b 1
)

echo Python  : %PYEXE%
echo Browser : %CHROME%
echo Profile : %PROFILE%
echo URL     : %URL%
start "" "%CHROME%" --app=%URL% --window-size=1500,940 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check
endlocal
