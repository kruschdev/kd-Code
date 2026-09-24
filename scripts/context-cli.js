#!/usr/bin/env node

/**
 * @file context-cli.js
 * CLI helper & HTTP bridge for KD Code connecting to:
 * - krusch-pre-router (Stage 0 / L1 syntactic gate)
 * - krusch-cascade-router & krusch-context-mcp (L2 neural centroid router & memory plane)
 * - krusch harness (ACID staging & 2PC apply)
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SIBLINGS_DIR = path.resolve(REPO_ROOT, '..');

/**
 * Layered resolution for sibling repositories:
 * 1. Explicit environment variable
 * 2. Parent directory checkout convention (../<repo>/...)
 * 3. Graceful null or explicit failure
 */
export function resolveSiblingPath(envVar, relativeSubpath, description) {
  if (process.env[envVar]) {
    const customPath = path.resolve(process.env[envVar]);
    if (fs.existsSync(customPath)) {
      return customPath;
    }
    throw new Error(
      `[KD Code Bridge] Configured ${envVar}="${process.env[envVar]}" was not found on disk.`
    );
  }

  const conventionPath = path.resolve(SIBLINGS_DIR, relativeSubpath);
  if (fs.existsSync(conventionPath)) {
    return conventionPath;
  }

  return null;
}

export function requireSiblingPath(envVar, relativeSubpath, description) {
  const resolved = resolveSiblingPath(envVar, relativeSubpath, description);
  if (!resolved) {
    throw new Error(
      `[KD Code Bridge] Cannot find ${description}.\n` +
      `  Checked: ${path.resolve(SIBLINGS_DIR, relativeSubpath)}\n` +
      `  Please set environment variable ${envVar} or clone the sibling repository to ${path.resolve(SIBLINGS_DIR, path.dirname(relativeSubpath))}.`
    );
  }
  return resolved;
}

// Dynamically load optional pre-router
const preRouterPath = resolveSiblingPath('KRUSCH_PRE_ROUTER', 'krusch-pre-router/dist/index.js', 'krusch-pre-router');
let preRouter = null;
if (preRouterPath) {
  try {
    preRouter = await import(preRouterPath);
  } catch (e) {
    console.warn('[KD Code Bridge] Note: krusch-pre-router dynamic import failed:', e.message);
  }
}

const contextEnv = {
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

const harnessEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://kdcode:password@localhost:5432/kdcode',
  DOTENV_CONFIG_QUIET: 'true'
};

/**
 * Long-lived MCP Client managing a single child process across requests
 */
export class PersistentMcpClient {
  constructor(options) {
    this.name = options.name;
    this.getPath = options.getPath;
    this.args = options.args || [];
    this.env = options.env || process.env;
    this.clientInfo = options.clientInfo || { name: 'kdcode-bridge', version: '1.0.0' };
    this.child = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.initPromise = null;
    this.isShuttingDown = false;
  }

  async ensureConnected() {
    if (this.child && !this.child.killed && this.initPromise) {
      return this.initPromise;
    }

    const scriptPath = typeof this.getPath === 'function' ? this.getPath() : this.getPath;
    if (!scriptPath) {
      throw new Error(`[${this.name}] Server script path is not configured`);
    }

    this.isShuttingDown = false;
    this.initPromise = (async () => {
      this.child = spawn('node', [scriptPath, ...this.args], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: this.env
      });

      this.child.on('error', (err) => {
        console.error(`[${this.name}] Child process error:`, err.message);
        this._cleanup();
      });

      this.child.on('exit', (code, signal) => {
        if (!this.isShuttingDown) {
          console.warn(`[${this.name}] Child process exited (code=${code}, signal=${signal})`);
        }
        this._cleanup();
      });

      this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
      this.rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, timer } = this.pending.get(msg.id);
            clearTimeout(timer);
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch {
          // Non-JSON stdout or diagnostics are safely ignored
        }
      });

      // Send MCP initialize handshake
      const initRes = await this._sendRaw('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: this.clientInfo
      });

      if (initRes.error) {
        throw new Error(`[${this.name}] MCP initialize failed: ${JSON.stringify(initRes.error)}`);
      }

      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      await new Promise((r) => setTimeout(r, 50));
    })().catch((err) => {
      this._cleanup();
      throw err;
    });

    return this.initPromise;
  }

  _cleanup() {
    this.initPromise = null;
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error(`[${this.name}] Connection lost while waiting for request ${id}`));
    }
    this.pending.clear();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.child = null;
  }

  _sendRaw(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed) {
        return reject(new Error(`[${this.name}] Child process is not running`));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`[${this.name}] Timeout after ${timeoutMs}ms on ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
    });
  }

  async callTool(name, toolArgs = {}, timeoutMs = 30000) {
    await this.ensureConnected();
    const res = await this._sendRaw('tools/call', {
      name,
      arguments: toolArgs
    }, timeoutMs);

    if (res.error) {
      throw new Error(`MCP error: ${JSON.stringify(res.error)}`);
    }

    return res.result?.content?.[0]?.text;
  }

  async stop() {
    this.isShuttingDown = true;
    const child = this.child;
    this.child = null;
    this._cleanup();
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
  }
}

// Persistent clients for krusch-context-mcp and krusch harness
export const contextClient = new PersistentMcpClient({
  name: 'krusch-context-mcp',
  getPath: () => requireSiblingPath('KRUSCH_CONTEXT_MCP', 'krusch-context-mcp/src/index.js', 'krusch-context-mcp server'),
  args: [],
  env: contextEnv
});

export const harnessClient = new PersistentMcpClient({
  name: 'krusch-harness',
  getPath: () => requireSiblingPath('KRUSCH_HARNESS', 'krusch/bin/krusch.js', 'krusch harness server'),
  args: ['mcp'],
  env: harnessEnv
});

export async function invokeTool(toolName, toolArgs = {}) {
  return contextClient.callTool(toolName, toolArgs);
}

export async function invokeHarnessTool(toolName, toolArgs = {}) {
  const text = await harnessClient.callTool(toolName, toolArgs);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function shutdownClients() {
  await Promise.allSettled([contextClient.stop(), harnessClient.stop()]);
}

/**
 * Dual-Stage Route Pipeline:
 * Stage 0 / L1: Deterministic fast syntactic gate
 * Stage 1 / L2: Neural Centroid Escalation via krusch-context-mcp
 */
export async function routePipeline(prompt) {
  const t0 = performance.now();

  // 1. Stage 0 / L1 Pre-Router (if available)
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
 * Defaults to loopback interface (127.0.0.1) for local security.
 */
export function startBridgeServer(port = 3778, host = process.env.BRIDGE_HOST || '127.0.0.1') {
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

    const url = new URL(req.url, `http://${host}:${port}`);

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
        const out = await invokeTool('krusch_context_retrieve', { query: '*', project, include_state: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ project, stateMarkdown: out }));
        return;
      }

      if (url.pathname === '/api/memory' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeTool('krusch_context_remember', {
          project: body.project || 'kdcode',
          content: body.content || body.summary || '',
          category: body.category || 'lesson'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'saved', result: out }));
        return;
      }

      if (url.pathname === '/api/nudge' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeTool('krusch_context_remember', {
          project: body.project || 'kdcode',
          key: body.key || 'kdcode:conventions',
          content: body.value || body.nudge || '',
          category: 'invariant'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'saved', result: out }));
        return;
      }

      if (url.pathname === '/api/harness/run' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeHarnessTool('krusch_run', {
          goal: body.goal || body.prompt || '',
          projectPath: body.projectPath || process.cwd(),
          modelOverride: body.modelOverride,
          autoApprove: Boolean(body.autoApprove)
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }

      if (url.pathname === '/api/harness/status' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        if (!taskId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing taskId parameter' }));
          return;
        }
        const out = await invokeHarnessTool('krusch_task_status', { taskId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }

      if (url.pathname === '/api/harness/diff' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        if (!taskId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing taskId parameter' }));
          return;
        }
        const out = await invokeHarnessTool('krusch_diff', { taskId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }

      if (url.pathname === '/api/harness/apply' && req.method === 'POST') {
        const body = await readBody();
        const out = await invokeHarnessTool('krusch_apply_diff', {
          taskId: body.taskId,
          diffId: body.diffId
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, host, () => {
    console.log(`[KD Code Bridge] Server running on http://${host}:${port}`);
    console.log(`- Memory Endpoints:  /api/health, /api/route, /api/state, /api/memory, /api/nudge`);
    console.log(`- Harness Endpoints: /api/harness/run, /api/harness/status, /api/harness/diff, /api/harness/apply`);
  });

  const cleanup = async () => {
    console.log('\n[KD Code Bridge] Shutting down bridge and MCP backends...');
    server.close();
    await shutdownClients();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

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
  harness-run "<goal>" [projectPath]     Launch async engineering task in krusch harness
  harness-status <taskId>                Query task status and phase in krusch harness
  harness-diff <taskId>                  Query staged diff for task in krusch harness
  harness-apply <taskId> [diffId]        Apply staged diff via 2PC journal to disk
  serve [port]                           Run local HTTP daemon (default: 3778 on 127.0.0.1)
`);
    return;
  }

  try {
    switch (cmd) {
      case 'health': {
        const out = await invokeTool('krusch_context_health');
        console.log(out);
        break;
      }
      case 'state': {
        const out = await invokeTool('krusch_context_retrieve', {
          query: '*',
          project: args[0] || 'krusch-ide',
          include_state: true
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
        const out = await invokeTool('krusch_context_remember', {
          content: args[0],
          category: args[1] || 'lesson',
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
        const out = await invokeTool('krusch_context_remember', {
          key: args[1] || 'kdcode:conventions',
          content: args[0],
          category: 'invariant',
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
        const out = await invokeTool('krusch_context_retrieve', {
          query: args[0],
          project: args[1]
        });
        console.log(out);
        break;
      }
      case 'symbols': {
        console.log('Note: Symbol lookups are handled via Tier 2 krusch-git (krusch_git_search_symbols).');
        break;
      }
      case 'nuggets': {
        const out = await invokeTool('krusch_context_nudge', {
          trigger: 'general',
          plan: args[0] || '',
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
      case 'harness-run': {
        if (!args[0]) {
          console.error('Usage: harness-run "<goal>" [projectPath]');
          process.exit(1);
        }
        const out = await invokeHarnessTool('krusch_run', {
          goal: args[0],
          projectPath: args[1] || process.cwd()
        });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case 'harness-status': {
        if (!args[0]) {
          console.error('Usage: harness-status <taskId>');
          process.exit(1);
        }
        const out = await invokeHarnessTool('krusch_task_status', { taskId: args[0] });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case 'harness-diff': {
        if (!args[0]) {
          console.error('Usage: harness-diff <taskId>');
          process.exit(1);
        }
        const out = await invokeHarnessTool('krusch_diff', { taskId: args[0] });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case 'harness-apply': {
        if (!args[0]) {
          console.error('Usage: harness-apply <taskId> [diffId]');
          process.exit(1);
        }
        const out = await invokeHarnessTool('krusch_apply_diff', {
          taskId: args[0],
          diffId: args[1] ? Number(args[1]) : undefined
        });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      case 'serve': {
        const port = Number(args[0]) || 3778;
        startBridgeServer(port);
        // Keep daemon running
        return;
      }
      default: {
        console.error(`Unknown command: ${cmd}`);
        process.exitCode = 1;
        break;
      }
    }
  } catch (err) {
    console.error('CLI Error:', err.message);
    process.exitCode = 1;
  } finally {
    if (cmd !== 'serve') {
      await shutdownClients();
      process.exit(process.exitCode || 0);
    }
  }
}

// Only execute CLI if directly run
if (process.argv[1]?.endsWith('context-cli.js')) {
  main().catch(async (err) => {
    console.error('CLI Fatal:', err.message);
    await shutdownClients();
    process.exit(1);
  });
}
