$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "codex/installer.mjs") uninstall
exit $LASTEXITCODE
