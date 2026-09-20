#!/usr/bin/env node

/**
 * @file bin/kdcode.js
 * Unified single-command launcher and diagnostics control plane for KD Code.
 * 
 * Commands:
 *   kdcode up                Start Postgres, bridge, harness, memory, and UI
 *   kdcode doctor | health   Detailed healthcheck with actionable missing-piece reports
 *   kdcode demo-invariant    Run 7-step write invariant proof script
 *   kdcode verify-models     Verify zero context loss across Claude -> Gemini -> Ollama
 *   kdcode ci [projectPath]  Headless CI mode (staging + verify + 2PC apply)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ECOSYSTEM_CONFIG_PATH = path.join(REPO_ROOT, 'krusch-ecosystem.json');

function loadEcosystemConfig() {
  if (!fs.existsSync(ECOSYSTEM_CONFIG_PATH)) {
    throw new Error(`Missing ecosystem configuration at ${ECOSYSTEM_CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(ECOSYSTEM_CONFIG_PATH, 'utf-8'));
}

/**
 * Check TCP port connectivity
 */
function probeTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Check sibling repository existence, entrypoint, and version compatibility
 */
function checkSibling(name, config) {
  const envVar = config.envVar;
  let repoPath = null;

  if (process.env[envVar]) {
    repoPath = path.resolve(process.env[envVar]);
    if (!fs.existsSync(repoPath)) {
      return {
        name,
        ok: false,
        error: `Configured ${envVar}="${process.env[envVar]}" does not exist on disk.`,
        fix: `Update ${envVar} or remove it to use default path: ${config.defaultPath}`
      };
    }
  } else {
    repoPath = path.resolve(REPO_ROOT, config.defaultPath);
  }

  if (!fs.existsSync(repoPath)) {
    return {
      name,
      ok: false,
      error: `Repository directory not found at: ${repoPath}`,
      fix: `Clone repository: git clone ${config.repoUrl} ${repoPath}`
    };
  }

  // Check entrypoint
  const entrypointPath = path.join(repoPath, config.entrypoint);
  if (!fs.existsSync(entrypointPath)) {
    return {
      name,
      ok: false,
      error: `Entrypoint '${config.entrypoint}' missing in ${repoPath}`,
      fix: `Ensure repository is built or subpath is valid: ls -la ${repoPath}`
    };
  }

  // Check version in package.json
  const pkgPath = path.join(repoPath, 'package.json');
  let currentVersion = 'unknown';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      currentVersion = pkg.version || 'unknown';
    } catch (_) {}
  }

  // Simple semver check
  const minVersion = config.minVersion;
  const isCompatible = semverGte(currentVersion, minVersion);

  // Capability check for krusch: ensure 2PC recovery and verification contracts are present
  if (name === 'krusch') {
    const stateManagerPath = path.join(repoPath, 'src/brain/state-manager.js');
    const contractPath = path.join(repoPath, 'src/verify/contract.js');
    if (!fs.existsSync(stateManagerPath) || !fs.existsSync(contractPath)) {
      return {
        name,
        ok: false,
        error: `Required harness modules missing in ${repoPath} (requires state-manager.js & contract.js)`,
        fix: `Update krusch to commit ${config.pinnedCommit || 'latest'}: git -C ${repoPath} pull origin main`
      };
    }
  }

  return {
    name,
    ok: isCompatible,
    currentVersion,
    minVersion,
    pinnedCommit: config.pinnedCommit || null,
    repoPath,
    entrypointPath,
    error: isCompatible ? null : `Version ${currentVersion} does not satisfy minimum required ${minVersion}`,
    fix: isCompatible ? null : `Pull latest changes: git -C ${repoPath} pull`
  };
}

function semverGte(current, target) {
  if (current === 'unknown' || !current) return true; // graceful allow if unversioned dev checkout
  const cParts = current.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  const tParts = target.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const c = cParts[i] || 0;
    const t = tParts[i] || 0;
    if (c > t) return true;
    if (c < t) return false;
  }
  return true;
}

/**
 * Command: kdcode doctor / health
 */
async function runDoctor() {
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log('🩺 KD CODE ECOSYSTEM DOCTOR & DIAGNOSTIC PROBE');
  console.log('────────────────────────────────────────────────────────────────────────\n');

  const config = loadEcosystemConfig();
  let hasFailures = false;

  // 1. PostgreSQL Persistence Substrate
  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const dbUp = await probeTcp(dbHost, dbPort, 2500);

  if (dbUp) {
    console.log(`  🟢 PostgreSQL Database: Connected (${dbHost}:${dbPort})`);
  } else {
    hasFailures = true;
    console.log(`  🔴 PostgreSQL Database: Unreachable (${dbHost}:${dbPort})`);
    console.log(`     Fix: Start container with 'docker compose up -d db' or verify PostgreSQL is running.`);
  }

  // 2. Sibling Repositories & Version Pin Verification
  console.log('\n  📦 Ecosystem Sibling Dependencies:');
  for (const [name, sibConfig] of Object.entries(config.siblings)) {
    const check = checkSibling(name, sibConfig);
    if (check.ok) {
      const pinInfo = check.pinnedCommit ? ` [pinned: ${check.pinnedCommit}]` : '';
      console.log(`     🟢 ${name.padEnd(20)} v${check.currentVersion} (min: ${check.minVersion})${pinInfo} -> ${check.entrypointPath}`);
    } else {
      hasFailures = true;
      console.log(`     🔴 ${name.padEnd(20)} FAILED`);
      console.log(`        Issue: ${check.error}`);
      console.log(`        Fix:   ${check.fix}`);
    }
  }

  // 3. Bridge HTTP & MCP Engine
  const bridgePort = config.services.bridge.defaultPort;
  const bridgeHost = config.services.bridge.defaultHost;
  const bridgeUp = await probeTcp(bridgeHost, bridgePort, 1500);

  if (bridgeUp) {
    console.log(`\n  🟢 Bridge Daemon: Running (http://${bridgeHost}:${bridgePort})`);
    try {
      const res = await fetch(`http://${bridgeHost}:${bridgePort}/api/health`);
      if (res.ok) {
        const data = await res.json();
        console.log(`     Branding: ${data.branding}`);
      }
    } catch (_) {}
  } else {
    console.log(`\n  ⚪ Bridge Daemon: Not running on port ${bridgePort} (Start with: node bin/kdcode.js up)`);
  }

  // 4. Memory Plane Health via CLI
  console.log('\n  🧠 Memory & Staging Substrates:');
  try {
    const healthProc = spawnSync('node', ['scripts/context-cli.js', 'health'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 10000
    });
    if (healthProc.status === 0) {
      const lines = healthProc.stdout.split('\n').filter(l => l.includes('Server is healthy') || l.includes('Vector Dimensions') || l.includes('Episodic memories') || l.includes('Extracted symbols'));
      for (const line of lines) {
        console.log(`     ${line.trim()}`);
      }
    } else {
      console.log(`     ⚠️ Memory check returned non-zero status: ${(healthProc.stderr || healthProc.stdout).trim()}`);
    }
  } catch (err) {
    console.log(`     ⚠️ Memory check error: ${err.message}`);
  }

  console.log('\n────────────────────────────────────────────────────────────────────────');
  if (hasFailures) {
    console.log('❌ Doctor found issues requiring attention before running tasks.');
    process.exit(1);
  } else {
    console.log('✅ Ecosystem is fully healthy, verified, and operational.');
    process.exit(0);
  }
}

/**
 * Command: kdcode up
 */
async function runUp(options = {}) {
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log('🚀 BOOTING KD CODE DEVELOPMENT WORKBENCH');
  console.log('────────────────────────────────────────────────────────────────────────\n');

  const config = loadEcosystemConfig();

  // Step 1: Ensure PostgreSQL is running
  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  let dbUp = await probeTcp(dbHost, dbPort, 2000);

  if (!dbUp && !options.skipDb) {
    console.log(`[Step 1] PostgreSQL is down on ${dbHost}:${dbPort}. Attempting Docker startup...`);
    const composeUp = spawnSync('docker', ['compose', 'up', '-d', 'db'], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });

    if (composeUp.status !== 0) {
      console.error('\n✗ Failed to launch PostgreSQL container via docker compose.');
      console.error('  Please ensure Docker is running, or start PostgreSQL manually on port 5432.');
      process.exit(1);
    }

    process.stdout.write('  Waiting for PostgreSQL readiness... ');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      dbUp = await probeTcp(dbHost, dbPort, 1000);
      if (dbUp) break;
      process.stdout.write('.');
    }

    if (!dbUp) {
      console.log('\n✗ PostgreSQL failed to become reachable within 15 seconds.');
      process.exit(1);
    }
    console.log(' CONNECTED!');
  } else {
    console.log(`[Step 1] PostgreSQL is reachable at ${dbHost}:${dbPort}.`);
  }

  // Step 2: Validate Siblings
  console.log('\n[Step 2] Validating sibling repositories & version compatibility...');
  for (const [name, sibConfig] of Object.entries(config.siblings)) {
    const check = checkSibling(name, sibConfig);
    if (!check.ok) {
      console.error(`\n✗ Sibling '${name}' check failed:`);
      console.error(`  Error: ${check.error}`);
      console.error(`  Action: ${check.fix}\n`);
      process.exit(1);
    }
    console.log(`  ✓ ${name} (v${check.currentVersion}) -> ${check.entrypointPath}`);
  }

  // Step 3: Run Database Migrations
  console.log('\n[Step 3] Verifying database schema & running migrations...');
  const migProc = spawnSync('node', ['../krusch/bin/krusch.js', 'init'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 15000
  });
  if (migProc.status === 0) {
    console.log('  ✓ Krusch harness & context tables initialized.');
  } else {
    console.warn('  ⚠️ Migration warning:\n' + (migProc.stderr || migProc.stdout));
  }

  // Step 4: Launch Bridge Daemon
  const bridgePort = options.port || config.services.bridge.defaultPort;
  const bridgeHost = config.services.bridge.defaultHost;
  const isBridgeRunning = await probeTcp(bridgeHost, bridgePort, 1000);

  if (isBridgeRunning) {
    console.log(`\n[Step 4] Bridge Daemon is already active on http://${bridgeHost}:${bridgePort}`);
  } else {
    console.log(`\n[Step 4] Starting Bridge Daemon on http://${bridgeHost}:${bridgePort}...`);
    const bridgeProcess = spawn('node', ['scripts/context-cli.js', 'serve', String(bridgePort)], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false
    });

    // Wait for bridge to come alive
    let bridgeAlive = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      bridgeAlive = await probeTcp(bridgeHost, bridgePort, 800);
      if (bridgeAlive) break;
    }

    if (!bridgeAlive) {
      console.error('✗ Bridge daemon failed to start within timeout.');
      bridgeProcess.kill();
      process.exit(1);
    }
    console.log(`  ✓ Bridge daemon operational on http://${bridgeHost}:${bridgePort}`);
  }

  // Step 5: Web UI Launch
  if (options.noUi) {
    console.log('\n✓ KD Code ecosystem backend is running (UI skipped via --no-ui).');
    return;
  }

  const webPort = options.webPort || config.services.web.defaultPort;
  console.log(`\n[Step 5] Launching KD Code Workbench UI (Port ${webPort})...`);
  console.log(`────────────────────────────────────────────────────────────────────────`);
  console.log(`🌐 Workbench URL:    http://localhost:${webPort}`);
  console.log(`🔌 Bridge API:      http://${bridgeHost}:${bridgePort}`);
  console.log(`────────────────────────────────────────────────────────────────────────\n`);

  // Try bun first, then npx vite
  const hasBun = spawnSync('which', ['bun']).status === 0;
  const uiCmd = hasBun ? 'bun' : 'npm';
  const uiArgs = hasBun ? ['run', 'dev:web'] : ['run', 'dev'];

  const uiProcess = spawn(uiCmd, uiArgs, {
    cwd: path.join(REPO_ROOT, 'apps/web'),
    stdio: 'inherit'
  });

  const shutdown = () => {
    console.log('\n[KD Code] Shutting down services...');
    uiProcess.kill();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Main Entrypoint
 */
async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'up':
    case 'start': {
      const options = {
        noUi: args.includes('--no-ui'),
        skipDb: args.includes('--skip-db'),
        port: parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3778', 10),
        webPort: parseInt(args.find(a => a.startsWith('--web-port='))?.split('=')[1] || '5733', 10)
      };
      await runUp(options);
      break;
    }
    case 'doctor':
    case 'health': {
      await runDoctor();
      break;
    }
    case 'demo-invariant': {
      const demoScript = path.join(REPO_ROOT, 'scripts/demo-write-invariant.js');
      const proc = spawn('node', [demoScript, ...args], { stdio: 'inherit' });
      proc.on('close', code => process.exit(code || 0));
      break;
    }
    case 'verify-models': {
      const switchScript = path.join(REPO_ROOT, 'scripts/verify-model-switch.js');
      const proc = spawn('node', [switchScript, ...args], { stdio: 'inherit' });
      proc.on('close', code => process.exit(code || 0));
      break;
    }
    case 'ci': {
      const ciScript = path.join(REPO_ROOT, 'scripts/headless-ci.js');
      const proc = spawn('node', [ciScript, ...args], { stdio: 'inherit' });
      proc.on('close', code => process.exit(code || 0));
      break;
    }
    case 'bench': {
      const benchScript = path.join(REPO_ROOT, 'scripts/bench.js');
      const proc = spawn('node', [benchScript, ...args], { stdio: 'inherit' });
      proc.on('close', code => process.exit(code || 0));
      break;
    }
    default: {
      console.log(`
KD Code Unified CLI (v0.1.0)
Usage:
  kdcode up [--no-ui] [--port=3778] [--web-port=5733]  Start full ecosystem stack
  kdcode doctor | health                               Inspect health and missing pieces
  kdcode demo-invariant                                Run 7-step write invariant proof
  kdcode verify-models                                 Verify prompt packaging & prefix parity across providers
  kdcode bench [--iterations=25]                       Run measured performance & reliability benchmarks
  kdcode ci <projectPath> [--patch=<file>]             Run headless CI sandbox & 2PC apply
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
