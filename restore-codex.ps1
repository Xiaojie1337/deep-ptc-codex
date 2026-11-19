$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "codex/installer.mjs") restore
exit $LASTEXITCODE
