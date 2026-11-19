import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexCommand } from '../installer.mjs';
import { nativeAvailable } from './support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function sse(res, name, event) { res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...event })}\n\n`); }

test('real Codex model requests include hook context only for DeepSeek (offline mock provider)', { timeout: 120000, skip: !nativeAvailable && 'Codex CLI unavailable' }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'deep-ptc-live-hooks-'));
  const home = join(folder, 'home'), workspace = join(folder, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  const env = { ...process.env, CODEX_HOME: home };
  const install = spawnSync(process.execPath, [join(root, 'codex/installer.mjs'), 'install', '--approve'], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(install.status, 0, install.stderr);
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    if (!req.url.includes('/responses')) { res.writeHead(404); res.end('{}'); return; }
    const payload = JSON.parse(body); requests.push(payload);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const response = { id: 'resp_mock', object: 'response', created_at: 1, status: 'in_progress', model: payload.model, output: [] };
    const item = { id: 'msg_mock', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
    sse(res, 'response.created', { response });
    sse(res, 'response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    sse(res, 'response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    sse(res, 'response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'OK' });
    sse(res, 'response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'OK' });
    sse(res, 'response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
    sse(res, 'response.output_item.done', { output_index: 0, item });
    sse(res, 'response.completed', { response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const command = codexCommand(), port = server.address().port;
  // Fail closed for any unrelated CLI metadata lookup: only the loopback mock is reachable via these proxies.
  env.HTTP_PROXY = env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
  env.NO_PROXY = '127.0.0.1,localhost';
  try {
    for (const model of ['deepseek-chat', 'gpt-6.1-sol']) {
      const args = [...command.prefix, 'exec', '--json', '--skip-git-repo-check', '--ephemeral', '--model', model,
        '-c', 'features.remote_plugin=false', '-c', 'model_provider="localtest"', '-c', `model_providers.localtest={name="Offline hook test",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
        'Reply OK. This is an offline plugin integration test.'];
      const result = await new Promise((resolve, reject) => {
        const child = spawn(command.bin, args, { env, cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part);
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Codex timeout: ${stderr}`)); }, 45000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const matched = requests.filter(r => r.model === model);
      assert.ok(matched.length > 0, `No local provider request for ${model}`);
      const hasContext = matched.some(r => JSON.stringify(r).includes('[Deep PTC gate: ON; live model=' + model));
      assert.equal(hasContext, model.startsWith('deepseek'), `${model}: hook context gate mismatch; stderr=${result.stderr}; stdout=${result.stdout}`);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
