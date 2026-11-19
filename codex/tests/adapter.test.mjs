import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexCommand } from '../installer.mjs';
import { nativeAvailable } from './support.mjs';
const nativeTest = (name, fn) => test(name, { skip: !nativeAvailable && 'Codex CLI unavailable' }, fn);
import { gate } from '../marketplace/plugins/deep-ptc-deepseek/scripts/common.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = join(root, 'codex/marketplace/plugins/deep-ptc-deepseek/scripts');
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'deep-ptc-codex-'));
  const home = join(folder, '配置 home'), workspace = join(folder, '项目 work');
  mkdirSync(home); mkdirSync(workspace);
  return { folder, home, workspace, env: { ...process.env, CODEX_HOME: home } };
}
function run(f, script, args = [], input) {
  return spawnSync(process.execPath, [script, ...args], { env: f.env, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 60000, windowsHide: true });
}
function ok(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim() ? JSON.parse(result.stdout) : null; }
const helper = (f, ...args) => run(f, join(scripts, 'ptc.mjs'), args);
const hook = (f, event) => run(f, join(scripts, 'hook.mjs'), [], event);
const installer = (f, command) => run(f, join(root, 'codex/installer.mjs'), [command]);

for (const model of ['deepseek-chat', 'DeepSeek-R1', 'deepseek-v4.1-flash', 'vendor/deepseek-v4', 'ccs-catcode-123/deepseek-v4.1-flash', 'not-deepseek', 'deepseeker', 'gpt/deepseekish', 'my-deepseek-router-v2', 'DEEPSEEK', 'deepseep-v4.1-flash', 'ccs-route/deepseep-v4', 'DeepSeep-R1']) {
  test(`gate activates ${model}`, () => assert.equal(gate(model, { enabled: true, aliases: [] }).active, true));
}
for (const model of [undefined, null, '', 'gpt-6.1-sol', 'claude-sonnet', 'ds-router', 'deep-seek', 'gpt-deep']) {
  test(`gate ignores ${String(model)}`, () => assert.equal(gate(model, { enabled: true, aliases: [] }).active, false));
}
test('gate needs an explicit alias and respects disabled', () => {
  assert.equal(gate('ds-router', { enabled: true, aliases: ['DS-router'] }).active, true);
  assert.equal(gate('deepseek-chat', { enabled: false, aliases: [] }).active, false);
});
test('all lifecycle hooks use current model, emit structured output, and never create profile files', () => {
  const f = fixture();
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostCompact']) {
    const active = ok(hook(f, { hook_event_name: event, model: 'deepseek-chat', cwd: f.workspace }));
    assert.equal(active.hookSpecificOutput.hookEventName, event);
    assert.match(active.hookSpecificOutput.additionalContext, /live model=deepseek-chat/u);
    assert.match(active.hookSpecificOutput.additionalContext, /current DeepSeek turn/u);
    for (const model of ['gpt-6.1-sol', undefined]) {
      const inactive = hook(f, { hook_event_name: event, model, cwd: f.workspace });
      assert.equal(inactive.status, 0); assert.equal(inactive.stdout, '');
    }
  }
  assert.equal(existsSync(join(f.home, 'deep-ptc')), false);
});
test('invalid JSON hook input fails without fake activation', () => {
  const f = fixture();
  const result = spawnSync(process.execPath, [join(scripts, 'hook.mjs')], { env: f.env, input: '{bad', encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /inactive/u);
});
test('long-sleep guard applies only to DeepSeek shell calls', () => {
  const f = fixture();
  const event = { hook_event_name: 'PreToolUse', model: 'deepseek-chat', tool_name: 'exec_command', tool_input: { cmd: 'Start-Sleep -Seconds 30', shell: 'powershell' } };
  assert.equal(ok(hook(f, event)).hookSpecificOutput.permissionDecision, 'deny');
  event.model = 'gpt-6.1-sol'; assert.equal(hook(f, event).stdout, '');
  event.model = 'deepseek-chat'; event.tool_input.cmd = 'Write-Output "Start-Sleep 30"';
  assert.equal(hook(f, event).stdout, '');
  event.tool_input = { command: 'sleep 10', shell: '/bin/bash' };
  assert.equal(ok(hook(f, event)).hookSpecificOutput.permissionDecision, 'deny');
  event.tool_input.command = 'sleep 2'; assert.equal(hook(f, event).stdout, '');
});
test('settings persist aliases and off-switch without touching Codex configuration', () => {
  const f = fixture();
  ok(helper(f, 'settings', '--alias', 'ds-private'));
  assert.equal(ok(helper(f, 'status', '--model', 'ds-private')).active, true);
  ok(helper(f, 'settings', '--enabled', 'false'));
  assert.equal(ok(helper(f, 'status', '--model', 'deepseek-chat')).active, false);
  assert.equal(existsSync(join(f.home, 'config.toml')), false);
});
test('cards propose, approve, history and restore exact bytes; read creates nothing', () => {
  const f = fixture();
  const path = join(f.workspace, 'PROJECT-CARDS.md');
  assert.deepEqual(ok(helper(f, 'cards', 'list', '--cwd', f.workspace)).cards, []);
  assert.equal(existsSync(join(f.home, 'deep-ptc')), false);
  const change = join(f.folder, 'change.json');
  writeFileSync(change, JSON.stringify({ kind: 'features', title: '验收', items: ['第一个功能'] }));
  const proposal = ok(helper(f, 'cards', 'propose', '--cwd', f.workspace, '--file', change));
  assert.equal(existsSync(path), false);
  assert.equal(helper(f, 'cards', 'accept', '--cwd', f.workspace, '--id', proposal.id).status, 1);
  const accepted = ok(helper(f, 'cards', 'accept', '--cwd', f.workspace, '--id', proposal.id, '--approve'));
  const bytes = readFileSync(path, 'utf8');
  assert.match(bytes, /第一个功能/u);
  assert.equal(ok(helper(f, 'cards', 'list', '--cwd', f.workspace)).cards[0].items[0].id, 'F1');
  ok(helper(f, 'cards', 'restore', '--cwd', f.workspace, '--id', accepted.historyId, '--approve'));
  assert.equal(existsSync(path), false);
  const history = ok(helper(f, 'cards', 'history', '--cwd', f.workspace));
  ok(helper(f, 'cards', 'restore', '--cwd', f.workspace, '--id', history[0].id, '--approve'));
  assert.equal(readFileSync(path, 'utf8'), bytes);
});
test('external edits invalidate proposals; fresh edits preserve unmanaged Markdown', () => {
  const f = fixture(), path = join(f.workspace, 'PROJECT-CARDS.md'), change = join(f.folder, 'change.json');
  writeFileSync(change, JSON.stringify({ kind: 'features', items: ['new'] }));
  const stale = ok(helper(f, 'cards', 'propose', '--cwd', f.workspace, '--file', change));
  writeFileSync(path, '# User notes\r\nKeep me verbatim.\r\n');
  const result = helper(f, 'cards', 'accept', '--cwd', f.workspace, '--id', stale.id, '--approve');
  assert.equal(result.status, 1); assert.match(result.stderr, /CONFLICT/u);
  const fresh = ok(helper(f, 'cards', 'propose', '--cwd', f.workspace, '--file', change));
  ok(helper(f, 'cards', 'accept', '--cwd', f.workspace, '--id', fresh.id, '--approve'));
  assert.match(readFileSync(path, 'utf8'), /Keep me verbatim\./u);
});
test('checkpoint stores real recovery data without changing project files', () => {
  const f = fixture(), file = join(f.folder, 'checkpoint.json');
  writeFileSync(file, JSON.stringify({ objective: 'finish adapter', nextAction: 'test restore', evidence: ['gate passed'] }));
  ok(helper(f, 'checkpoint', 'save', '--cwd', f.workspace, '--file', file));
  assert.equal(ok(helper(f, 'checkpoint', 'show', '--cwd', f.workspace)).nextAction, 'test restore');
  assert.equal(existsSync(join(f.workspace, 'PROJECT-CARDS.md')), false);
});
nativeTest('native plugin install -> upgrade -> restore -> restore preserves original config exactly', () => {
  const f = fixture(), config = join(f.home, 'config.toml');
  const original = 'model = "gpt-test"\n\n[profiles.keep]\nmodel = "gpt-keep"\n';
  writeFileSync(config, original);
  const first = ok(installer(f, 'install'));
  assert.equal(first.plugin.enabled, true);
  assert.equal(first.trustRequired, true);
  assert.equal(existsSync(join(f.home, 'deep-ptc/marketplace/plugins/deep-ptc-deepseek/scripts/ptc.mjs')), true);
  const installedConfig = readFileSync(config, 'utf8');
  const second = ok(installer(f, 'install')); assert.notEqual(second.backup, first.backup);
  assert.equal(ok(installer(f, 'restore')).configHashMatches, true);
  assert.equal(readFileSync(config, 'utf8'), installedConfig);
  assert.equal(ok(installer(f, 'restore')).filesMatch, true);
  assert.equal(readFileSync(config, 'utf8'), original);
  assert.equal(ok(installer(f, 'restore')).action, 'nothing-to-restore');
});
nativeTest('restore guards later config edits; uninstall keeps them and preserves project data', () => {
  const f = fixture(), config = join(f.home, 'config.toml');
  ok(installer(f, 'install'));
  const later = readFileSync(config, 'utf8') + '\n[profiles.later]\nmodel = "gpt-later"\n';
  writeFileSync(config, later);
  const failure = installer(f, 'restore');
  assert.equal(failure.status, 1); assert.match(failure.stderr, /changed after installation/u);
  assert.equal(readFileSync(config, 'utf8'), later);
  ok(helper(f, 'settings', '--alias', 'keep-this'));
  assert.equal(ok(installer(f, 'uninstall')).action, 'uninstalled');
  assert.match(readFileSync(config, 'utf8'), /gpt-later/u);
  assert.equal(ok(helper(f, 'settings')).aliases[0], 'keep-this');
  assert.equal(ok(installer(f, 'status')).native.plugin, undefined);
});
nativeTest('first install and restore on an empty profile removes only the new config', () => {
  const f = fixture(); ok(installer(f, 'install')); ok(installer(f, 'restore'));
  assert.equal(existsSync(join(f.home, 'config.toml')), false);
  assert.equal(existsSync(join(f.home, 'deep-ptc/marketplace')), false);
});

nativeTest('approved installation trusts only this plugin and round-trips exact configuration', () => {
  const f = fixture(), config = join(f.home, 'config.toml');
  const before = 'model = "keep-model"\nsandbox_mode = "read-only"\napproval_policy = "on-request"\n';
  writeFileSync(config, before);
  const installed = ok(run(f, join(root, 'codex/installer.mjs'), ['install', '--approve']));
  assert.equal(installed.trustRequired, false);
  assert.equal(installed.hooks.hooks.length, 4);
  assert.ok(installed.hooks.hooks.every(h => h.trustStatus === 'trusted' && h.enabled));
  assert.equal(installed.activationReady, true);
  const after = readFileSync(config, 'utf8');
  for (const line of before.trim().split('\n')) assert.ok(after.includes(line));
  ok(installer(f, 'restore'));
  assert.equal(readFileSync(config, 'utf8'), before);
});
nativeTest('failed native install rolls back the original configuration and archives failed files', () => {
  const f = fixture(), config = join(f.home, 'config.toml');
  writeFileSync(config, 'model = "original"\n');
  const real = codexCommand(), shim = join(f.folder, 'codex-fail-once.js'), marker = join(f.folder, 'failed.marker');
  writeFileSync(shim, `const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='plugin'&&args[1]==='add'&&!fs.existsSync(${JSON.stringify(marker)})){
fs.writeFileSync(${JSON.stringify(marker)},'failed');console.error('injected install failure');process.exit(42);}
const r=cp.spawnSync(${JSON.stringify(real.bin)},[...${JSON.stringify(real.prefix)},...args],{env:process.env,stdio:'inherit',windowsHide:true});process.exit(r.status??1);`);
  f.env.CODEX_BIN = shim;
  const result = installer(f, 'install');
  assert.equal(result.status, 1); assert.match(result.stderr, /rollback=completed/u);
  assert.equal(readFileSync(config, 'utf8'), 'model = "original"\n');
  assert.equal(existsSync(join(f.home, 'deep-ptc/managed.json')), false);
  assert.equal(existsSync(join(f.home, 'deep-ptc/marketplace')), false);
});

nativeTest('approved uninstall removes only its own hook trust entries and preserves later preferences', () => {
  const f = fixture(), config = join(f.home, 'config.toml');
  ok(run(f, join(root, 'codex/installer.mjs'), ['install', '--approve']));
  writeFileSync(config, readFileSync(config, 'utf8') + '\n[profiles.keep_after]\nmodel = "keep-after"\n');
  ok(installer(f, 'uninstall'));
  const after = readFileSync(config, 'utf8');
  assert.match(after, /keep-after/u);
  assert.doesNotMatch(after, /trusted_hash/u);
});
test('helper rejects oversized checkpoint before persisting an unreadable state', () => {
  const f = fixture(), file = join(f.folder, 'large.json');
  writeFileSync(file, JSON.stringify({ objective: 'keep readable', nextAction: 'stop', evidence: 'x'.repeat(1024 * 1024) }));
  const result = helper(f, 'checkpoint', 'save', '--cwd', f.workspace, '--file', file);
  assert.equal(result.status, 1); assert.match(result.stderr, /1 MiB/u);
  assert.equal(ok(helper(f, 'checkpoint', 'show', '--cwd', f.workspace)), null);
});
