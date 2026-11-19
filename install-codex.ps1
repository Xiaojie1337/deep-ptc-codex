$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "codex/installer.mjs") install --approve
exit $LASTEXITCODE
