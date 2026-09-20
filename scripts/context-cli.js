#!/usr/bin/env node

/**
 * @file context-cli.js
 * CLI helper & HTTP bridge for KD Code connecting to:
 * - krusch-pre-router (Stage 0 / L1 syntactic gate)
 * - krusch-cascade-router & krusch-context-mcp (L2 neural centroid router & memory plane)
 * 
 * Usage:
 *   node scripts/context-cli.js health
 *   node scripts/context-cli.js state [project]
 *   node scripts/context-cli.js route-pipeline "<prompt>"
 *   node scripts/context-cli.js remember "<summary>" [category] [project]
 *   node scripts/context-cli.js nudge "<text>" [ruleType] [project]
 *   node scripts/context-cli.js search <query> [project]
 *   node scripts/context-cli.js symbols <query> [project]
 *   node scripts/context-cli.js nuggets <history> [project]
 *   node scripts/context-cli.js centroids
 *   node scripts/context-cli.js serve [port]
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import http from 'node:http';

const SERVER = '/home/krusch/homelab/projects/krusch-context-mcp/src/index.js';
const PRE_ROUTER_PATH = '/home/krusch/homelab/projects/krusch-pre-router/dist/index.js';

let preRouter = null;
try {
  preRouter = await import(PRE_ROUTER_PATH);
} catch (e) {
  console.warn('[KD Code Bridge] Note: krusch-pre-router dynamic import failed:', e.message);
}

const env = {
  ...process.env,
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || '5432',
  DB_NAME: process.env.DB_NAME || 'kdcode',
  DB_USER: process.env.DB_USER || 'kdcode',
  DB_PASSWORD: process.env.DB_PASSWORD || 'password',
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  DOTENV_CONFIG_QUIET: 'true',
  KRUSCH_PROFILE: 'ecosystem'
};

export async function invokeTool(toolName, toolArgs = {}) {
  const child = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 1;
  const pending = new Map();

  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      // Ignore non-JSON logs
    }
  });

  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout on ${method}`));
        }
      }, 20000);
    });
  };

  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kdcode-bridge', version: '1.0.0' }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise(r => setTimeout(r, 100));

    const res = await send('tools/call', {
      name: toolName,
      arguments: toolArgs
    });

    child.kill('SIGTERM');

    if (res.error) {
      throw new Error(`MCP error: ${JSON.stringify(res.error)}`);
    }

    return res.result?.content?.[0]?.text;
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }
}

/**
 * Dual-Stage Route Pipeline:
 * Stage 0 / L1: Deterministic fast syntactic gate (<15µs CPU)
 * Stage 1 / L2: Neural Centroid Escalation via krusch-context-mcp
 */
export async function routePipeline(prompt) {
  const t0 = performance.now();

  // 1. Stage 0 / L1 Pre-Router
  if (preRouter?.classifyPreRoute) {
    const l1 = preRouter.classifyPreRoute(prompt);
    if (l1.isFastPath) {
      const durationMs = performance.now() - t0;
      return {
        stage: 'L1_FAST_PATH',
        tier: 'fast_edge',
        role: l1.role || 'code',
        recommendedProvider: 'opencode',
        recommendedModel: 'qwen2.5-coder:7b',
        confidence: 1.0,
        reason: `L1 Syntactic Match: ${l1.reason} (${l1.ruleId || 'syntax'})`,
        durationMs: Number(durationMs.toFixed(3)),
        l1
      };
    }
  }

  // 2. Stage 1 / L2 Neural Centroid Escalation
  const l2Raw = await invokeTool('krusch_context_semantic_route', { prompt });
  let l2 = null;
  try {
    l2 = JSON.parse(l2Raw);
  } catch {
    l2 = { raw: l2Raw };
  }

  const durationMs = performance.now() - t0;
  let recommendedProvider = 'gemini';
  let recommendedModel = 'gemini-3.1-pro';

  if (l2?.matchedArchetype?.includes('code') || l2?.recommendedRole?.includes('code')) {
    recommendedProvider = 'claudeAgent';
    recommendedModel = 'claude-3-7-sonnet';
  } else if (l2?.targetTier === 'heavy' || l2?.recommendedRole === 'reasoning_deep') {
    recommendedProvider = 'gemini';
    recommendedModel = 'gemini-3.1-pro';
  }

  return {
    stage: 'L2_NEURAL_CENTROID',
    tier: l2?.targetTier || 'heavy',
    role: l2?.recommendedRole || 'general',
    matchedArchetype: l2?.matchedArchetype,
    similarity: l2?.similarity,
    confidence: l2?.confidence || 0.8,
    recommendedProvider,
    recommendedModel,
    reason: l2?.reason || 'Escalated to L2 Neural Centroid classification',
    durationMs: Number(durationMs.toFixed(3)),
    l2
  };
}

/**
 * Start a lightweight HTTP daemon for KD Code UI communication
 */
export function startBridgeServer(port = 3778) {
  const server = http.createServer(async (req, res) => {
    // Enable CORS for KD Code Web & Desktop frontends
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    // Helper to read JSON body
    const readBody = () => new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

    try {
      if (url.pathname === '/api/health') {
        const out = await invokeTool('krusch_context_health');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', branding: 'KD Code', details: out }));
        return;
      }

      if (url.pathname === '/api/route' && req.method === 'POST') {
        const body = await readBody();
        const routeResult = await routePipeline(body.prompt || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(routeResult));
        return;
      }

      if (url.pathname === '/api/state' && req.method === 'GET') {
        const project = url.searchParams.get('project') || 'krusch-ide';
        const out = await invokeTool('krusch_context_compile_state', { project });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ project, stateMarkdown: out }));
        return;
      }

      if (url.pathname === '/api/memory' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeTool('krusch_context_add_memory', {
          project: body.project || 'kdcode',
          content: body.content || body.summary || '',
          category: body.category || 'lessons'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'saved', result: out }));
        return;
      }

      if (url.pathname === '/api/nudge' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeTool('krusch_context_nugget_remember', {
          project: body.project || 'kdcode',
          key: body.key || 'kdcode:conventions',
          value: body.value || body.nudge || '',
          kind: body.kind || 'project'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'saved', result: out }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[KD Code Bridge] Server running on http://localhost:${port}`);
    console.log(`- Endpoints: /api/health, /api/route, /api/state, /api/memory, /api/nudge`);
  });

  return server;
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
KD Code Context & Router Bridge
Commands:
  health                                 Inspect context engine health & db status
  state [project]                        Compile consolidated state briefing
  route-pipeline "<prompt>"              Run dual-stage L1+L2 routing pipeline
  remember "<summary>" [cat] [project]   Persist episodic memory on Postgres plane
  nudge "<nudge>" [ruleType] [project]   Persist behavioral steering rule on Postgres plane
  search <query> [project]               Search code contents in PG-Git
  symbols <query> [project]              Search extracted AST symbols
  nuggets <query> [project]              Query proactive steering nuggets
  centroids                              List semantic routing centroids
  serve [port]                           Run local HTTP daemon (default: 3778)
`);
    return;
  }

  switch (cmd) {
    case 'health': {
      const out = await invokeTool('krusch_context_health');
      console.log(out);
      break;
    }
    case 'state': {
      const out = await invokeTool('krusch_context_compile_state', {
        project: args[0] || 'krusch-ide'
      });
      console.log(out);
      break;
    }
    case 'route-pipeline': {
      if (!args[0]) {
        console.error('Usage: route-pipeline "<prompt>"');
        process.exit(1);
      }
      const out = await routePipeline(args.join(' '));
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case 'remember': {
      if (!args[0]) {
        console.error('Usage: remember "<content>" [category] [project]');
        process.exit(1);
      }
      const out = await invokeTool('krusch_context_add_memory', {
        content: args[0],
        category: args[1] || 'lessons',
        project: args[2] || 'kdcode'
      });
      console.log(out);
      break;
    }
    case 'nudge': {
      if (!args[0]) {
        console.error('Usage: nudge "<nudge_text>" [key] [project]');
        process.exit(1);
      }
      const out = await invokeTool('krusch_context_nugget_remember', {
        key: args[1] || 'kdcode:conventions',
        value: args[0],
        kind: 'project',
        project: args[2] || 'kdcode'
      });
      console.log(out);
      break;
    }
    case 'search': {
      if (!args[0]) {
        console.error('Usage: search <query> [project]');
        process.exit(1);
      }
      const out = await invokeTool('krusch_context_search_code', {
        query: args[0],
        project: args[1]
      });
      console.log(out);
      break;
    }
    case 'symbols': {
      if (!args[0]) {
        console.error('Usage: symbols <query> [project]');
        process.exit(1);
      }
      const out = await invokeTool('krusch_context_search_symbols', {
        query: args[0],
        project: args[1]
      });
      console.log(out);
      break;
    }
    case 'nuggets': {
      const out = await invokeTool('krusch_context_nugget_nudges', {
        history: args[0] || '',
        project: args[1] || 'krusch-ide'
      });
      console.log(out);
      break;
    }
    case 'route': {
      if (!args[0]) {
        console.error('Usage: route <prompt>');
        process.exit(1);
      }
      const out = await invokeTool('krusch_context_semantic_route', {
        prompt: args.join(' ')
      });
      console.log(out);
      break;
    }
    case 'centroids': {
      const out = await invokeTool('krusch_context_list_semantic_centroids');
      console.log(out);
      break;
    }
    case 'serve': {
      const port = Number(args[0]) || 3778;
      startBridgeServer(port);
      break;
    }
    default: {
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
    }
  }
}

// Only execute CLI if directly run
if (process.argv[1]?.endsWith('context-cli.js')) {
  main().catch(err => {
    console.error('CLI Error:', err.message);
    process.exit(1);
  });
}
