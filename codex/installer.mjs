#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, codexHome, dataHome, hash, parseArgs, readJson, readText, VERSION, writeJson } from './marketplace/plugins/deep-ptc-deepseek/scripts/common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'deep-ptc-deepseek@deep-ptc-local';
const MARKET = 'deep-ptc-local';
const source = join(HERE, 'marketplace');
const root = dataHome();
const destination = join(root, 'marketplace');
const configPath = join(codexHome(), 'config.toml');
const statePath = join(root, 'managed.json');
const backupRoot = join(root, 'backups');
const report = [];

function safeManaged(path) {
  const absolute = resolve(path);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error(`Outside managed directory: ${absolute}`);
  let at = root;
  if (existsSync(at) && lstatSync(at).isSymbolicLink()) throw new Error(`Refusing linked data directory: ${at}`);
  for (const part of rel.split(sep)) {
    at = join(at, part);
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) throw new Error(`Refusing symlink: ${at}`);
  }
  return absolute;
}
function tree(path) {
  const files = {};
  if (!existsSync(path)) return files;
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported in plugin bundles: ${full}`);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files[relative(path, full).split(sep).join('/')] = hash(readFileSync(full));
      else throw new Error(`Unsupported bundle entry: ${full}`);
    }
  }
  walk(path);
  return files;
}
const equal = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
function copy(from, to) {
  safeManaged(to);
  tree(from);
  if (existsSync(to)) throw new Error(`Target already exists: ${to}`);
  cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  if (!equal(tree(from), tree(to))) throw new Error(`Copy verification failed: ${to}`);
}
function move(from, to) {
  safeManaged(from); safeManaged(to);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) throw new Error(`Archive already exists: ${to}`);
  renameSync(from, to);
}
export function codexCommand() {
  const candidates = process.env.CODEX_BIN ? [resolve(process.env.CODEX_BIN)] :
    (process.env.PATH ?? '').split(delimiter).flatMap(folder => [join(folder, process.platform === 'win32' ? 'codex.exe' : 'codex'), join(folder, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]);
  for (const path of candidates) {
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    if (/\.js$/iu.test(path)) {
      if (process.platform === 'win32') {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
        const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
        const executable = join(dirname(path), '..', 'node_modules', '@openai', packageName, 'vendor', `${arch}-pc-windows-msvc`, 'bin', 'codex.exe');
        if (existsSync(executable)) return { bin: resolve(executable), prefix: [] };
      }
      return { bin: process.execPath, prefix: [path] };
    }
    if (/\.(cmd|ps1|bat)$/iu.test(path)) {
      const js = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(js)) return { bin: process.execPath, prefix: [js] };
      continue;
    }
    return { bin: path, prefix: [] };
  }
  throw new Error('Codex CLI not found. Install/update Codex CLI, or set CODEX_BIN to the real executable or npm codex.js.');
}
function cli(args, { allowFailure = false, json = true } = {}) {
  const command = codexCommand();
  const result = spawnSync(command.bin, [...command.prefix, ...args], { env: { ...process.env, CODEX_HOME: codexHome() }, encoding: 'utf8', timeout: 60000, windowsHide: true, cwd: codexHome() });
  report.push({ command: `codex ${args.join(' ')}`, exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`codex ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  if (!json) return result.stdout.trim();
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`Codex did not return valid JSON for ${args.join(' ')}`); }
}
function registry() {
  const plugins = cli(['plugin', 'list', '--json']).installed ?? [];
  const marketplaces = cli(['plugin', 'marketplace', 'list', '--json']).marketplaces ?? [];
  return { plugin: plugins.find(p => p.pluginId === NAME), marketplace: marketplaces.find(p => p.name === MARKET) };
}
function currentConfig() { const text = readText(configPath); return { text, hash: text === null ? null : hash(text) }; }
function restoreConfig(text) {
  if (text === null) { if (existsSync(configPath)) unlinkSync(configPath); }
  else atomicWrite(configPath, text);
}
function deregister() {
  const present = registry();
  if (present.plugin) cli(['plugin', 'remove', NAME, '--json']);
  if (present.marketplace) cli(['plugin', 'marketplace', 'remove', MARKET, '--json']);
}
function register() {
  cli(['plugin', 'marketplace', 'add', destination, '--json']);
  cli(['plugin', 'add', NAME, '--json']);
  const result = registry();
  if (!result.plugin?.enabled) throw new Error('Plugin did not become enabled');
  return result.plugin;
}
function newBackup(action) {
  const id = new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8);
  const path = safeManaged(join(backupRoot, id));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const config = currentConfig();
  if (config.text !== null) writeFileSync(join(path, 'config.before.toml'), config.text, { mode: 0o600, flag: 'wx' });
  const previous = readJson(statePath, null);
  const manifest = { version: 1, id, action, createdAt: new Date().toISOString(),
    configExisted: config.text !== null, beforeConfigHash: config.hash, previousState: previous,
    beforeFiles: tree(destination), afterConfigHash: null, afterFiles: null };
  writeJson(join(path, 'manifest.json'), manifest);
  return { path, manifest, config };
}
function finishBackup(backup) {
  backup.manifest.afterConfigHash = currentConfig().hash;
  backup.manifest.afterFiles = tree(destination);
  writeJson(join(backup.path, 'manifest.json'), backup.manifest);
  writeJson(join(backup.path, 'DIFF.json'), { before: backup.manifest.beforeFiles, after: backup.manifest.afterFiles });
  writeJson(join(backup.path, 'VERIFICATION.json'), report);
}

function hookControl(action, approve = false) {
  const result = spawnSync(process.execPath, [join(HERE, 'hook-control.mjs'), action, ...(approve ? ['--approve'] : [])], {
    env: { ...process.env, CODEX_HOME: codexHome() }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  report.push({ command: `hook-control ${action}`, exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
  if (result.error || result.status !== 0) throw new Error(`Hook ${action} failed: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout);
}

function install({ approveHooks = false } = {}) {
  const version = cli(['--version'], { json: false });
  const state = readJson(statePath, null), native = registry();
  if (!state && (native.plugin || native.marketplace || existsSync(destination))) throw new Error('A same-name plugin/marketplace or unmanaged target already exists; refusing to overwrite it.');
  if (state && !equal(tree(destination), state.files)) throw new Error('Installed plugin files were edited. Preserve those changes before updating.');
  const backup = newBackup('install');
  const stage = safeManaged(join(root, `stage-${randomUUID()}`));
  copy(source, stage);
  let promoted = false;
  try {
    if (state) deregister();
    if (existsSync(destination)) move(destination, join(backup.path, 'marketplace'));
    move(stage, destination);
    promoted = true;
    const plugin = register();
    const hooks = hookControl(approveHooks ? 'trust' : 'inspect', approveHooks);
    writeJson(statePath, { version: VERSION, backupId: backup.manifest.id, files: tree(destination), hookKeys: hooks.hooks.map(h => h.key) });
    finishBackup(backup);
    return { action: 'installed', version: VERSION, codex: version, plugin, backup: backup.path,
      restartRequired: true, hooks, activationReady: hooks.hooks.every(h => h.enabled && h.trustStatus === 'trusted'), trustRequired: hooks.hooks.some(h => h.trustStatus !== 'trusted'), note: 'Restart Codex/open a new conversation. If trustRequired is true, review/approve this plugin in /hooks, or rerun install --approve. Gating uses the live hook model.' };
  } catch (error) {
    // Keep every failed bundle for diagnosis instead of recursively deleting it.
    let rollbackError;
    try {
      deregister();
      if (promoted && existsSync(destination)) move(destination, join(backup.path, 'failed-marketplace'));
      if (existsSync(join(backup.path, 'marketplace'))) copy(join(backup.path, 'marketplace'), destination);
      if (state) register();
      restoreConfig(backup.config.text);
      if (state) writeJson(statePath, state); else if (existsSync(statePath)) unlinkSync(statePath);
    } catch (failure) { rollbackError = failure.message; }
    writeJson(join(backup.path, 'VERIFICATION.json'), report);
    throw new Error(`${error.message}; backup=${backup.path}; rollback=${rollbackError ?? 'completed'}`);
  }
}
function restore() {
  const state = readJson(statePath, null);
  if (!state) return { action: 'nothing-to-restore' };
  if (!/^[0-9TZ-]+-[0-9a-f]{8}$/u.test(state.backupId)) throw new Error('Invalid backup ID');
  const path = safeManaged(join(backupRoot, state.backupId));
  const manifest = readJson(join(path, 'manifest.json'), null);
  if (!manifest || manifest.id !== state.backupId || manifest.action !== 'install') throw new Error('Invalid backup manifest');
  if (currentConfig().hash !== manifest.afterConfigHash) throw new Error('config.toml changed after installation. Restore stopped without changes; use uninstall to remove only this plugin and keep later configuration.');
  if (!equal(tree(destination), manifest.afterFiles)) throw new Error('Installed plugin files changed. Restore stopped to preserve those edits.');
  const original = manifest.configExisted ? readText(join(path, 'config.before.toml')) : null;
  if ((original === null ? null : hash(original)) !== manifest.beforeConfigHash) throw new Error('Config backup checksum mismatch');
  if (manifest.previousState && !equal(tree(join(path, 'marketplace')), manifest.beforeFiles)) throw new Error('Plugin backup checksum mismatch');
  const undo = newBackup('restore');
  let archived = false, replacement = false;
  try {
    deregister();
    if (existsSync(destination)) { move(destination, join(undo.path, 'marketplace')); archived = true; }
    if (manifest.previousState) {
      copy(join(path, 'marketplace'), destination);
      replacement = true;
      register();
      writeJson(statePath, manifest.previousState);
    } else if (existsSync(statePath)) unlinkSync(statePath);
    restoreConfig(original);
    if (currentConfig().hash !== manifest.beforeConfigHash || !equal(tree(destination), manifest.beforeFiles)) throw new Error('Restore verification failed');
    finishBackup(undo);
    return { action: 'restored', restoredBackup: path, preservedCurrent: undo.path, configHashMatches: true, filesMatch: true };
  } catch (error) {
    let rollbackError;
    try {
      deregister();
      if (replacement && existsSync(destination)) move(destination, join(undo.path, 'failed-replacement'));
      if (archived) copy(join(undo.path, 'marketplace'), destination);
      register();
      restoreConfig(undo.config.text);
      writeJson(statePath, state);
    } catch (failure) { rollbackError = failure.message; }
    writeJson(join(undo.path, 'VERIFICATION.json'), report);
    throw new Error(`${error.message}; archive=${undo.path}; rollback=${rollbackError ?? 'completed'}`);
  }
}
function uninstall() {
  const state = readJson(statePath, null);
  if (!state) return { action: 'not-managed-nothing-removed' };
  const backup = newBackup('uninstall');
  let archived = false;
  try {
    if (state.hookKeys?.length) hookControl('untrust', true);
    deregister();
    if (existsSync(destination)) { move(destination, join(backup.path, 'marketplace')); archived = true; }
    unlinkSync(statePath);
    finishBackup(backup);
    return { action: 'uninstalled', preservedFiles: backup.path, retainedData: root, note: 'Settings, project cards, checkpoints and backups are intentionally retained.' };
  } catch (error) {
    let rollbackError;
    try {
      if (archived) copy(join(backup.path, 'marketplace'), destination);
      register(); restoreConfig(backup.config.text); writeJson(statePath, state);
    } catch (failure) { rollbackError = failure.message; }
    writeJson(join(backup.path, 'VERIFICATION.json'), report);
    throw new Error(`${error.message}; backup=${backup.path}; rollback=${rollbackError ?? 'completed'}`);
  }
}
export function main(argv) {
  const { positional: [action], flags } = parseArgs(argv);
  if (flags.help || !action) return { help: 'node codex/installer.mjs install|restore|uninstall|status\nCODEX_HOME selects the target profile. CODEX_BIN can select a Codex executable.\nNode >=20 and Codex CLI with plugin + hook support are required.\ninstall --approve explicitly trusts only this bundled plugin hooks.\n' };
  if (action === 'status') return { version: VERSION, home: codexHome(), managed: readJson(statePath, null), native: registry(), hooks: readJson(statePath, null) ? hookControl('inspect') : null };
  if (!['install', 'restore', 'uninstall'].includes(action)) throw new Error(`Unknown action: ${action}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  safeManaged(join(root, 'operation.lock'));
  let fd;
  try { fd = openSync(join(root, 'operation.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another installation operation is active, or operation.lock needs inspection after an interruption'); throw error; }
  try { return action === 'install' ? install({ approveHooks: flags.approve === true }) : action === 'restore' ? restore() : uninstall(); }
  finally { closeSync(fd); unlinkSync(join(root, 'operation.lock')); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = main(process.argv.slice(2)); process.stdout.write(result.help ?? JSON.stringify(result, null, 2) + '\n'); }
  catch (error) { process.stderr.write(`deep-ptc installer: ${error.message}\n`); process.exitCode = 1; }
}

