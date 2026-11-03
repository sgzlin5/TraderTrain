@echo off
rem TraderTrain debug launcher: same profile, CDP on 9333
setlocal
set ROOT=%~dp0..
set PROFILE=%ROOT%\.chrome-profile
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
start "" "%CHROME%" --app=http://127.0.0.1:8731/app/index.html --window-size=1500,940 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --remote-debugging-port=9333
endlocal
