import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const VERSION = '1.0.0';
export const codexHome = () => resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
export const dataHome = () => join(codexHome(), 'deep-ptc');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function readText(path, fallback = null) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${path}`);
    if (stat.size > 1024 * 1024) throw new Error(`File exceeds 1 MiB: ${path}`);
    return readFileSync(path, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function readJson(path, fallback) {
  const text = readText(path);
  return text === null ? fallback : JSON.parse(text);
}
export function atomicWrite(path, text) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error(`Write exceeds 1 MiB: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
  try { renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export const writeJson = (path, value) => atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
export function settings() {
  const input = readJson(join(dataHome(), 'settings.json'), {});
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('settings.enabled must be boolean');
  if (input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.some(s => typeof s !== 'string' || !s.trim()))) throw new Error('settings.aliases must be nonempty strings');
  if (input.blockLongSleeps !== undefined && typeof input.blockLongSleeps !== 'boolean') throw new Error('settings.blockLongSleeps must be boolean');
  return { enabled: input.enabled !== false, aliases: input.aliases ?? [], blockLongSleeps: input.blockLongSleeps !== false };
}
export function gate(model, config = settings()) {
  if (!config.enabled) return { active: false, model: typeof model === 'string' ? model : null, reason: 'disabled' };
  if (typeof model !== 'string' || !model.trim()) return { active: false, model: null, reason: 'live-model-missing' };
  const normalized = model.trim().toLowerCase();
  // Substring match: any model slug or routed name containing deepseek (or the common typo deepseep) activates the gate.
  const named = /deepsee(?:k|p)/u.test(normalized);
  const alias = config.aliases.some(value => value.toLowerCase() === normalized);
  return { active: named || alias, model, reason: named ? 'deepseek-slug' : alias ? 'explicit-alias' : 'other-model' };
}
export function parseArgs(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (key === 'approve' || key === 'help') flags[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Value required: ${arg}`);
      flags[key] = argv[++i];
    }
  }
  return { flags, positional };
}
