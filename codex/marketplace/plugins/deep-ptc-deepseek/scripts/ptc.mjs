#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, dataHome, gate, hash, parseArgs, readJson, readText, settings, VERSION, writeJson } from './common.mjs';
import { blankDoc, parseDoc, serializeDoc, writeCard } from './vendor/project-cards.mjs';

const HELP = `Deep PTC ${VERSION} (Node >=20; no npm dependencies)
  status --model <live-model-slug>
  settings [--alias <exact-router-alias>] [--remove-alias <alias>]
           [--enabled true|false] [--block-long-sleeps true|false]
  cards list|history --cwd <workspace>
  cards propose --cwd <workspace> --file <change.json>
  cards accept|reject --cwd <workspace> --id <proposal-id> [--approve]
  cards restore --cwd <workspace> --id <history-id> --approve
  checkpoint save --cwd <workspace> --file <checkpoint.json>
  checkpoint show --cwd <workspace>
Settings and version history: $CODEX_HOME/deep-ptc (default ~/.codex/deep-ptc).
Read operations create nothing. Only accept/restore modifies PROJECT-CARDS.md.
`;

function project(cwd) {
  const root = realpathSync(resolve(cwd || process.cwd()));
  let folder = root;
  for (;;) {
    if (existsSync(join(folder, 'PROJECT-CARDS.md'))) break;
    const parent = dirname(folder);
    if (parent === folder || existsSync(join(folder, '.git'))) { folder = root; break; }
    folder = parent;
  }
  const path = join(folder, 'PROJECT-CARDS.md');
  const stateDir = join(dataHome(), 'projects', hash(path));
  return { root, path, stateDir, statePath: join(stateDir, 'state.json') };
}
function baseline(path) {
  const source = readText(path);
  return { source, version: source === null ? null : hash(source), ...parseDoc(source, { trackLayout: true }) };
}
function initialState() { return { version: 1, proposals: [], history: [], checkpoint: null }; }
function locked(path, callback) {
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another writer or interrupted transaction owns ${path}; inspect before removing that lock.`);
    throw error;
  }
  try { return callback(); }
  finally { closeSync(fd); unlinkSync(path); }
}
function approved(flags) { if (!flags.approve) throw new Error('Explicit --approve required after user review'); }
function applySource(info, state, next, reason) {
  const previous = baseline(info.path);
  const record = { id: randomUUID(), at: new Date().toISOString(), reason,
    before: previous.source, afterHash: next === null ? null : hash(next) };
  const transactionPath = join(info.stateDir, 'transaction.json');
  if (existsSync(transactionPath)) throw new Error(`Unresolved transaction: ${transactionPath}`);
  const nextState = { ...state, history: [record, ...state.history].slice(0, 20) };
  if (Buffer.byteLength(JSON.stringify(nextState, null, 2) + '\n') > 1024 * 1024) throw new Error('Project history would exceed 1 MiB; archive older records before changing the document');
  // The journal survives a power loss between the document and history writes.
  writeJson(transactionPath, { path: info.path, before: previous.source, next, record, state: nextState });
  try {
    if (baseline(info.path).version !== previous.version) throw new Error('Project cards changed during write');
    if (next === null) { if (existsSync(info.path)) unlinkSync(info.path); }
    else atomicWrite(info.path, next);
    writeJson(info.statePath, nextState);
    unlinkSync(transactionPath);
  } catch (error) {
    throw new Error(`${error.message}; recovery journal retained at ${transactionPath}. Inspect before retrying.`);
  }
  return { path: info.path, historyId: record.id, version: record.afterHash };
}
function bool(value, name) {
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

export function main(argv) {
  const { positional: [command, action], flags } = parseArgs(argv);
  if (!command || flags.help) return { help: HELP };
  if (command === 'status') return { version: VERSION, ...gate(flags.model), dataHome: dataHome() };
  if (command === 'settings') {
    const path = join(dataHome(), 'settings.json');
    const mutating = ['alias', 'remove-alias', 'enabled', 'block-long-sleeps'].some(k => flags[k] !== undefined);
    if (!mutating) return settings();
    return locked(path + '.lock', () => {
      const value = settings();
      if (flags.alias) value.aliases = [...new Set([...value.aliases, flags.alias.trim()])];
      if (flags['remove-alias']) value.aliases = value.aliases.filter(x => x.toLowerCase() !== flags['remove-alias'].toLowerCase());
      if (flags.enabled !== undefined) value.enabled = bool(flags.enabled, 'enabled');
      if (flags['block-long-sleeps'] !== undefined) value.blockLongSleeps = bool(flags['block-long-sleeps'], 'block-long-sleeps');
      writeJson(path, value);
      return value;
    });
  }
  if (!['cards', 'checkpoint'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const info = project(flags.cwd);
  const readState = () => readJson(info.statePath, initialState());
  if (command === 'cards' && action === 'list') {
    const doc = baseline(info.path);
    return { path: info.path, version: doc.version, cards: doc.doc.cards, warnings: doc.warnings,
      proposals: readState().proposals };
  }
  if (command === 'cards' && action === 'history') return readState().history.map(({ before, ...row }) => ({ ...row, beforeHash: before === null ? null : hash(before) }));
  if (command === 'checkpoint' && action === 'show') return readState().checkpoint;
  return locked(join(info.stateDir, 'write.lock'), () => {
    if (existsSync(join(info.stateDir, 'transaction.json'))) throw new Error(`Unresolved transaction: ${join(info.stateDir, 'transaction.json')}`);
    const state = readState();
    const current = baseline(info.path);
    if (command === 'checkpoint' && action === 'save') {
      const value = readJson(resolve(required(flags, 'file')), null);
      if (!value || typeof value !== 'object' || Array.isArray(value) || ['objective', 'nextAction'].some(key => typeof value[key] !== 'string' || !value[key].trim())) throw new Error('Checkpoint requires nonempty objective and nextAction strings');
      state.checkpoint = { ...value, savedAt: new Date().toISOString(), workspace: info.root };
      writeJson(info.statePath, state);
      return state.checkpoint;
    }
    if (command !== 'cards') throw new Error(`Unknown action: ${command} ${action}`);
    if (action === 'propose') {
      const change = readJson(resolve(required(flags, 'file')), null);
      if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Change must be a JSON object');
      const result = writeCard(structuredClone(current.doc), change);
      if (result.error) throw new Error(result.error);
      if (state.proposals.length >= 20) throw new Error('Review pending proposals before adding more');
      const proposal = { id: randomUUID(), at: new Date().toISOString(), baseVersion: current.version, change, preview: result.card };
      state.proposals.push(proposal);
      writeJson(info.statePath, state);
      return proposal;
    }
    if (action === 'reject') {
      const id = required(flags, 'id');
      if (!state.proposals.some(p => p.id === id)) throw new Error(`Unknown proposal: ${id}`);
      state.proposals = state.proposals.filter(p => p.id !== id);
      writeJson(info.statePath, state);
      return { rejected: id };
    }
    if (action === 'accept') {
      approved(flags);
      const proposal = state.proposals.find(p => p.id === required(flags, 'id'));
      if (!proposal) throw new Error('Unknown proposal');
      if (proposal.baseVersion !== current.version) throw new Error('PROJECT_CARDS_CONFLICT: baseline changed; create and review a fresh proposal');
      const result = writeCard(structuredClone(current.doc), proposal.change);
      if (result.error) throw new Error(result.error);
      const next = serializeDoc(result.doc, current.source === null ? undefined : current);
      state.proposals = state.proposals.filter(p => p.id !== proposal.id);
      return applySource(info, state, next, `accept:${proposal.id}`);
    }
    if (action === 'restore') {
      approved(flags);
      const record = state.history.find(p => p.id === required(flags, 'id'));
      if (!record) throw new Error('Unknown history snapshot');
      return applySource(info, state, record.before, `restore:${record.id}`);
    }
    throw new Error(`Unknown action: cards ${action}`);
  });
}
function required(flags, key) {
  if (!flags[key]) throw new Error(`--${key} required`);
  return flags[key];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = main(process.argv.slice(2));
    process.stdout.write(output?.help ?? JSON.stringify(output, null, 2) + '\n');
  } catch (error) { process.stderr.write(`deep-ptc: ${error.message}\n`); process.exitCode = 1; }
}
