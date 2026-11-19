# Security

## Reporting

Open a private security advisory on this repository (Security -> Advisories -> Report a vulnerability). Please do not file a public issue for a token/secret exposure.

## What this plugin touches

- Writes only inside `$CODEX_HOME/deep-ptc` (marketplace copy, settings, project state, backups).
- Registers the plugin through the official Codex `plugin` command.
- Trusts exactly the four hooks declared in `hooks/hooks.json`, by exact hash, through the Codex app-server config API.
- Never reads or writes API keys, provider settings, `sandbox_mode`, `approval_policy`, or `AGENTS.md`.

## Rollback

`node ./codex/installer.mjs restore` reverts the last install/upgrade byte-for-byte and refuses to run if the config or plugin files changed afterwards. `node ./codex/installer.mjs uninstall` removes only this plugin and its marketplace entry, keeping later configuration and project data.

## Backups may contain secrets

`$CODEX_HOME/deep-ptc/backups/` keeps a copy of the previous `config.toml`. Treat that directory as sensitive and never publish it. `.gitignore` excludes local backup directories from this repository.