@echo off
rem ---------------------------------------------------------------
rem  TraderTrain - restart the app window with a clean cache
rem  Use this when the window still shows an OLD build after a code change.
rem  It: kills this app's own Chrome profile only, clears its cache
rem      (IndexedDB / market data are NOT touched), then relaunches.
rem ---------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
set "PROFILE=%ROOT%.chrome-profile"

echo [1/3] closing app window (profile: %PROFILE%)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*TraderTrain*.chrome-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul

echo [2/3] clearing browser cache (keeps market data)
if exist "%PROFILE%\Default\Cache"          rd /s /q "%PROFILE%\Default\Cache" 2>nul
if exist "%PROFILE%\Default\Code Cache"     rd /s /q "%PROFILE%\Default\Code Cache" 2>nul
if exist "%PROFILE%\Default\GPUCache"       rd /s /q "%PROFILE%\Default\GPUCache" 2>nul
if exist "%PROFILE%\Default\Service Worker" rd /s /q "%PROFILE%\Default\Service Worker" 2>nul

echo [3/3] launching
timeout /t 1 >nul
call "%ROOT%start.bat"
