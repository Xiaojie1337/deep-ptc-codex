@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install Node.js and retry.
  pause
  exit /b 1
)
echo Installing the local plugin and trusting ONLY its four reviewed hooks.
echo No model, API key, global sandbox or approval_policy setting will be changed.
node "%~dp0codex\installer.mjs" install --approve
set "RESULT=%ERRORLEVEL%"
echo.
if not defined DEEP_PTC_NO_PAUSE pause
exit /b %RESULT%
