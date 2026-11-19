@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install Node.js and retry.
  pause
  exit /b 1
)
node "%~dp0codex\installer.mjs" uninstall
set "RESULT=%ERRORLEVEL%"
echo.
if not defined DEEP_PTC_NO_PAUSE pause
exit /b %RESULT%
