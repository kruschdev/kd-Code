#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const SERVER = '/home/krusch/homelab/projects/krusch-context-mcp/src/index.js';
let nextId = 1;
const pending = new Map();

const env = {
  ...process.env,
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'kdcode',
  DB_USER: 'kdcode',
  DB_PASSWORD: 'password',
  OLLAMA_URL: 'http://localhost:11434',
  DOTENV_CONFIG_QUIET: 'true',
  KRUSCH_PROFILE: 'ecosystem'
};

const child = spawn('node', [SERVER], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env
});

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  } catch (e) {
    // Non-JSON debug output
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    child.stdin.write(msg + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on ${method} (id=${id})`));
      }
    }, 15000);
  });
}

async function main() {
  console.log('Connecting to krusch-context-mcp with KRUSCH_PROFILE=ecosystem...');
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'krusch-ide-checker', version: '1.0.0' }
  });
  console.log('Server info:', init.result?.serverInfo);

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise(r => setTimeout(r, 200));

  console.log('\nFetching tools list...');
  const toolsRes = await send('tools/list');
  const tools = toolsRes.result?.tools || [];
  console.log(`Discovered ${tools.length} exposed tools:`);
  for (const t of tools) {
    console.log(` - ${t.name}: ${t.description?.slice(0, 70)}...`);
  }

  console.log('\nCalling krusch_context_health_check...');
  const healthRes = await send('tools/call', {
    name: 'krusch_context_health_check',
    arguments: {}
  });
  console.log('Health check result:', healthRes.result?.content?.[0]?.text);

  console.log('\nCalling krusch_context_list_semantic_centroids...');
  const centroidRes = await send('tools/call', {
    name: 'krusch_context_list_semantic_centroids',
    arguments: {}
  });
  console.log('Semantic centroids result:', centroidRes.result?.content?.[0]?.text);

  child.kill('SIGTERM');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  child.kill('SIGTERM');
  process.exit(1);
});
