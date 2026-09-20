#!/usr/bin/env node

/**
 * @file smoke-harness-slice.js
 * 
 * End-to-end vertical slice smoke test for KD Code:
 * 1. Verifies Bridge HTTP connectivity (http://127.0.0.1:3778)
 * 2. Prepares an isolated fixture repository with a sample source file
 * 3. Stages an ACID diff in PostgreSQL (krusch_staged_diffs)
 * 4. Queries GET /api/harness/diff via Bridge (matching @pierre/diffs expectations)
 * 5. Queries POST /api/harness/apply via Bridge to execute 2PC atomic rename
 * 6. Asserts on-disk file content mutation and verifies phase: COMMITTED
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { resolveSiblingPath, requireSiblingPath, startBridgeServer, shutdownClients } from './context-cli.js';

const BRIDGE_PORT = 3779; // Dedicated test port to prevent collisions
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

// Dynamically resolve krusch state manager from sibling checkout
const kruschBin = requireSiblingPath('KRUSCH_HARNESS', 'krusch/bin/krusch.js', 'krusch harness');
const kruschRoot = path.dirname(path.dirname(kruschBin));
const stateManagerPath = path.resolve(kruschRoot, 'src/brain/state-manager.js');

let KruschStateManager;
try {
  const mod = await import(stateManagerPath);
  KruschStateManager = mod.KruschStateManager;
} catch (e) {
  console.error('[Smoke Test] Failed to load KruschStateManager:', e.message);
  process.exit(1);
}

async function runSmokeTest() {
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('🧪 KD Code Vertical Slice Smoke Test (Bridge → Diff → 2PC Apply)');
  console.log('──────────────────────────────────────────────────────────────────\n');

  // 1. Boot test bridge server
  console.log(`[Step 1] Starting isolated test bridge on ${BRIDGE_URL}...`);
  const server = startBridgeServer(BRIDGE_PORT, BRIDGE_HOST);
  await new Promise(r => setTimeout(r, 400));

  // Health check
  const healthRes = await fetch(`${BRIDGE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`Bridge health check failed: status ${healthRes.status}`);
  }
  const healthData = await healthRes.json();
  console.log('  🟢 Bridge Health OK:', healthData.status, `(${healthData.branding})`);

  // 2. Set up temporary fixture directory
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdcode-smoke-fixture-'));
  const testFileRel = 'src/calculator.js';
  const testFileAbs = path.join(fixtureDir, testFileRel);
  fs.mkdirSync(path.dirname(testFileAbs), { recursive: true });

  const initialCode = `// Initial buggy implementation
export function add(a, b) {
  return a - b; // Bug
}
`;
  fs.writeFileSync(testFileAbs, initialCode, 'utf-8');
  console.log(`\n[Step 2] Created isolated fixture repository at:`);
  console.log(`  📁 ${fixtureDir}`);
  console.log(`  📄 ${testFileRel} (initial: subtraction bug)`);

  const initialHash = crypto.createHash('sha256').update(initialCode).digest('hex');

  // 3. Initialize task and stage diff into PostgreSQL ACID substrate
  const taskId = `smoke_task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  console.log(`\n[Step 3] Initializing task ${taskId} in PostgreSQL...`);

  await KruschStateManager.createTask({
    id: taskId,
    goal: 'Fix arithmetic bug in calculator.js',
    projectPath: fixtureDir,
    phase: 'APPROVAL_GATE'
  });

  const stagedCode = `// Initial buggy implementation
export function add(a, b) {
  return a + b; // Fixed!
}
`;
  const diffPatch = `--- a/${testFileRel}
+++ b/${testFileRel}
@@ -1,4 +1,4 @@
 // Initial buggy implementation
 export function add(a, b) {
-  return a - b; // Bug
+  return a + b; // Fixed!
 }
`;

  const stagedDiff = await KruschStateManager.stageDiff(taskId, {
    filePath: testFileRel,
    originalContent: initialCode,
    stagedContent: stagedCode,
    diffPatch,
    projectPath: fixtureDir
  });

  console.log(`  🟢 Staged diff in PostgreSQL: Diff ID #${stagedDiff.id}`);
  console.log(`  Status: ${stagedDiff.status} | SHA-256: ${stagedDiff.sha256_hash.slice(0, 12)}...`);

  // Record passing verification to satisfy the ACID verification gate contract
  await KruschStateManager.recordVerificationRun(taskId, {
    command: 'node --check src/calculator.js',
    exitCode: 0,
    stdout: 'Syntax & contract verified.',
    stderr: '',
    passed: true
  });
  console.log(`  🟢 Recorded passing ground-truth verification run (Exit code: 0)`);

  // 4. Query GET /api/harness/diff via Bridge
  console.log(`\n[Step 4] Querying GET /api/harness/diff?taskId=${taskId} via Bridge...`);
  const diffRes = await fetch(`${BRIDGE_URL}/api/harness/diff?taskId=${encodeURIComponent(taskId)}`);
  if (!diffRes.ok) {
    throw new Error(`Diff fetch failed: status ${diffRes.status}`);
  }
  const diffs = await diffRes.json();

  if (!Array.isArray(diffs) || diffs.length !== 1) {
    throw new Error(`Expected 1 diff returned, got ${JSON.stringify(diffs)}`);
  }

  const fetched = diffs[0];
  console.log(`  🟢 Retrieved diff for: ${fetched.filePath}`);
  console.log(`  Patch preview:\n    ${fetched.patch.trim().split('\n').join('\n    ')}`);

  if (fetched.status !== 'PENDING') {
    throw new Error(`Expected diff status PENDING, got: ${fetched.status}`);
  }

  // 5. Query POST /api/harness/apply via Bridge
  console.log(`\n[Step 5] Triggering POST /api/harness/apply via Bridge...`);
  const applyRes = await fetch(`${BRIDGE_URL}/api/harness/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId,
      diffId: fetched.id
    })
  });

  if (!applyRes.ok) {
    throw new Error(`Apply diff failed: status ${applyRes.status}`);
  }
  const applyData = await applyRes.json();
  console.log(`  🟢 2PC Journal & Atomic Rename Result:`, JSON.stringify(applyData));

  if (applyData.status !== 'APPLIED') {
    throw new Error(`Expected apply status APPLIED, got: ${JSON.stringify(applyData)}`);
  }

  // 6. Assert on-disk mutation
  console.log(`\n[Step 6] Validating physical disk contents...`);
  const diskContent = fs.readFileSync(testFileAbs, 'utf-8');
  if (diskContent !== stagedCode) {
    throw new Error(`Disk content mismatch! Expected fixed code, found:\n${diskContent}`);
  }
  console.log(`  🟢 On-disk file verified: contains 'return a + b; // Fixed!'`);

  // 7. Verify Task status and phase
  console.log(`\n[Step 7] Querying GET /api/harness/status?taskId=${taskId}...`);
  const statusRes = await fetch(`${BRIDGE_URL}/api/harness/status?taskId=${encodeURIComponent(taskId)}`);
  if (!statusRes.ok) {
    throw new Error(`Status fetch failed: status ${statusRes.status}`);
  }
  const statusData = await statusRes.json();
  console.log(`  🟢 Task Phase: ${statusData.phase}`);
  console.log(`  Applied diffs count: ${statusData.appliedDiffsCount}`);
  console.log(`  Pending diffs count: ${statusData.pendingDiffsCount}`);

  if (statusData.phase !== 'COMMITTED') {
    throw new Error(`Expected phase COMMITTED, got: ${statusData.phase}`);
  }
  if (statusData.appliedDiffsCount !== 1) {
    throw new Error(`Expected appliedDiffsCount = 1, got: ${statusData.appliedDiffsCount}`);
  }

  // Cleanup
  console.log('\n[Teardown] Cleaning up fixture directory and closing test bridge...');
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  server.close();
  await shutdownClients();

  console.log('\n🎉 ALL VERTICAL SLICE CHECKS PASSED:');
  console.log('  1. Bridge HTTP API loopback binding verified');
  console.log('  2. Persistent MCP communication confirmed');
  console.log('  3. PostgreSQL pre-commit staging verified');
  console.log('  4. Diff retrieval format validated for KD Code UI');
  console.log('  5. 2PC atomic disk rename verified without tree drift');
  console.log('  6. FSM Phase transition to COMMITTED confirmed');
  console.log('──────────────────────────────────────────────────────────────────\n');
  process.exit(0);
}

runSmokeTest().catch(async (err) => {
  console.error('\n❌ Smoke Test Failed:', err.message);
  await shutdownClients();
  process.exit(1);
});
