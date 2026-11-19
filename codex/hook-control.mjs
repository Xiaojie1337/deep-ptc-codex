#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexCommand } from './installer.mjs';
import { codexHome } from './marketplace/plugins/deep-ptc-deepseek/scripts/common.mjs';

const PLUGIN = 'deep-ptc-deepseek@deep-ptc-local';
export async function hookControl(action, approve) {
  if (!['inspect', 'trust', 'untrust'].includes(action)) throw new Error('Expected inspect|trust|untrust');
  if (action !== 'inspect' && !approve) throw new Error('Explicit --approve required to modify this plugin hook trust');
  const command = codexCommand();
  const child = spawn(command.bin, [...command.prefix, 'app-server', '--stdio'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: codexHome() });
  let serial = 0, buffer = '', stderr = '';
  const pending = new Map();
  child.stdout.on('data', part => {
    buffer += part;
    for (;;) {
      const at = buffer.indexOf('\n'); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const message = JSON.parse(line), waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
      } catch (error) { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); }
    }
  });
  child.stderr.on('data', part => { stderr = (stderr + part).slice(-4000); });
  child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`Codex app-server exited (${code}): ${stderr}`)); pending.clear(); });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const timeout = setTimeout(() => {
    for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server hook operation timed out'));
    pending.clear(); child.kill();
  }, 20000);
  try {
    await call('initialize', { clientInfo: { name: 'deep_ptc_installer', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const inspect = async () => {
      const result = await call('hooks/list', { cwds: [codexHome()] });
      const errors = result.data.flatMap(entry => entry.errors ?? []);
      if (errors.length) throw new Error('Hooks discovery errors: ' + JSON.stringify(errors));
      return result.data.flatMap(entry => entry.hooks ?? []).filter(h => h.pluginId === PLUGIN);
    };
    let hooks = await inspect();
    if (hooks.length !== 4) throw new Error(`Expected four plugin hooks, discovered ${hooks.length}. Update Codex or inspect its hook configuration.`);
    if (action !== 'inspect') {
      const expected = new Set(['preToolUse', 'postCompact', 'sessionStart', 'userPromptSubmit']);
      if (hooks.some(h => !expected.delete(h.eventName) || h.handlerType !== 'command' || !h.command?.endsWith('/scripts/hook.mjs"'))) throw new Error('Unexpected plugin hook definitions; review them before trusting');
      const edits = hooks.flatMap(h => action === 'trust' ? [
        { keyPath: `hooks.state.${JSON.stringify(h.key)}.trusted_hash`, value: h.currentHash, mergeStrategy: 'replace' },
        { keyPath: `hooks.state.${JSON.stringify(h.key)}.enabled`, value: true, mergeStrategy: 'replace' },
      ] : [ { keyPath: `hooks.state.${JSON.stringify(h.key)}`, value: null, mergeStrategy: 'replace' } ]);
      await call('config/batchWrite', { edits, reloadUserConfig: true });
      hooks = await inspect();
      if (action === 'trust' && hooks.some(h => h.trustStatus !== 'trusted')) throw new Error('Hook trust could not be verified');
    }
    return { action, hooks: hooks.map(({ key, eventName, enabled, trustStatus, currentHash }) => ({ key, eventName, enabled, trustStatus, currentHash })) };
  } finally {
    clearTimeout(timeout);
    child.stdin.end(); child.kill();
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await hookControl(process.argv[2] || 'inspect', process.argv.includes('--approve')), null, 2)); }
  catch (error) { console.error(`deep-ptc hook-control: ${error.message}`); process.exitCode = 1; }
}
