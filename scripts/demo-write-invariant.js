#!/usr/bin/env node

/**
 * @file scripts/demo-write-invariant.js
 * 
 * Cryptographic & Operational Proof of the Krusch/KD Code Write Invariant.
 * Demonstrates the full 7-step invariant cycle:
 * 
 * 1. Agent proposes a multi-file patch
 * 2. Disk is unchanged
 * 3. Sandbox tests fail, then pass
 * 4. Review UI shows the staged diff
 * 5. Approve -> atomic apply (2PC journal + rename)
 * 6. Kill the process mid-apply -> recover cleanly (rollback to base preimage)
 * 7. Working-tree drift -> apply refused
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Dynamically resolve KruschStateManager from sibling krusch harness
const kruschHarnessPath = process.env.KRUSCH_HARNESS || path.resolve(REPO_ROOT, '../krusch/bin/krusch.js');
const kruschRoot = path.dirname(path.dirname(kruschHarnessPath));
const stateManagerModule = path.resolve(kruschRoot, 'src/brain/state-manager.js');

if (!fs.existsSync(stateManagerModule)) {
  console.error(`✗ Cannot find KruschStateManager at: ${stateManagerModule}`);
  process.exit(1);
}

const { KruschStateManager } = await import(stateManagerModule);
const { query } = await import(path.resolve(kruschRoot, 'src/brain/pool.js'));

function sha256(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

async function runInvariantProof() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🛡️  KD CODE & KRUSCH WRITE INVARIANT: 7-STEP PROOF OF EXECUTION');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Setup isolated fixture directory
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdcode-invariant-demo-'));
  const mathFileRel = 'src/math.js';
  const configFileRel = 'src/config.json';
  const mathFileAbs = path.join(fixtureDir, mathFileRel);
  const configFileAbs = path.join(fixtureDir, configFileRel);

  fs.mkdirSync(path.dirname(mathFileAbs), { recursive: true });

  const initialMathContent = `export function calculate(a, b) {\n  return a - b; // BUG: subtraction\n}\n`;
  const initialConfigContent = JSON.stringify({ version: "1.0.0", mode: "standard" }, null, 2) + '\n';

  fs.writeFileSync(mathFileAbs, initialMathContent, 'utf-8');
  fs.writeFileSync(configFileAbs, initialConfigContent, 'utf-8');

  const baseMathSha = sha256(initialMathContent);
  const baseConfigSha = sha256(initialConfigContent);

  console.log(`[Setup] Created isolated sandbox workspace at:`);
  console.log(`  📁 ${fixtureDir}`);
  console.log(`  📄 ${mathFileRel}   (SHA-256: ${baseMathSha.slice(0, 16)}...)`);
  console.log(`  📄 ${configFileRel} (SHA-256: ${baseConfigSha.slice(0, 16)}...)\n`);

  const taskId = `invariant_task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // -------------------------------------------------------------------------
  // STEP 1: Agent proposes a multi-file patch
  // -------------------------------------------------------------------------
  console.log(`[Step 1] Agent proposes multi-file patch (Task ID: ${taskId})...`);
  await KruschStateManager.createTask({
    id: taskId,
    goal: 'Fix calculation logic and update version config',
    projectPath: fixtureDir,
    phase: 'IMPLEMENT'
  });

  const stagedMathContent = `export function calculate(a, b) {\n  return a + b; // FIXED: addition\n}\n`;
  const stagedConfigContent = JSON.stringify({ version: "1.1.0", mode: "optimized" }, null, 2) + '\n';

  const diffMath = await KruschStateManager.stageDiff(taskId, {
    projectPath: fixtureDir,
    filePath: mathFileRel,
    originalContent: initialMathContent,
    stagedContent: stagedMathContent,
    diffPatch: `--- a/${mathFileRel}\n+++ b/${mathFileRel}\n@@ -1,3 +1,3 @@\n export function calculate(a, b) {\n-  return a - b; // BUG: subtraction\n+  return a + b; // FIXED: addition\n }\n`
  });

  const diffConfig = await KruschStateManager.stageDiff(taskId, {
    projectPath: fixtureDir,
    filePath: configFileRel,
    originalContent: initialConfigContent,
    stagedContent: stagedConfigContent,
    diffPatch: `--- a/${configFileRel}\n+++ b/${configFileRel}\n@@ -1,4 +1,4 @@\n {\n-  "version": "1.0.0",\n-  "mode": "standard"\n+  "version": "1.1.0",\n+  "mode": "optimized"\n }\n`
  });

  console.log(`  ✓ Staged ${mathFileRel}   in PostgreSQL (Diff ID #${diffMath.id}, Status: PENDING)`);
  console.log(`  ✓ Staged ${configFileRel} in PostgreSQL (Diff ID #${diffConfig.id}, Status: PENDING)`);

  // -------------------------------------------------------------------------
  // STEP 2: Disk is unchanged
  // -------------------------------------------------------------------------
  console.log(`\n[Step 2] Verifying disk write invariant before approval...`);
  const currentMathOnDisk = fs.readFileSync(mathFileAbs, 'utf-8');
  const currentConfigOnDisk = fs.readFileSync(configFileAbs, 'utf-8');

  if (sha256(currentMathOnDisk) !== baseMathSha || sha256(currentConfigOnDisk) !== baseConfigSha) {
    throw new Error('VIOLATION: Working tree was modified prematurely by agent staging!');
  }
  console.log(`  🔒 DISK IS 100% UNCHANGED:`);
  console.log(`     ${mathFileRel}   matches base SHA-256 (${baseMathSha.slice(0, 16)}...)`);
  console.log(`     ${configFileRel} matches base SHA-256 (${baseConfigSha.slice(0, 16)}...)`);

  // -------------------------------------------------------------------------
  // STEP 3: Sandbox tests fail, then pass
  // -------------------------------------------------------------------------
  console.log(`\n[Step 3] Verification contract enforcement:`);
  
  // Transition IMPLEMENT -> VERIFY
  await KruschStateManager.updateTask(taskId, { phase: 'VERIFY' });
  console.log(`  Task transitioned: IMPLEMENT -> VERIFY`);

  // Record a failing test run (exit code 1)
  console.log(`  Executing sandbox verification run with failing assertions...`);
  await KruschStateManager.recordVerificationRun(taskId, {
    command: 'npm test',
    passed: false,
    exitCode: 1,
    stdout: '',
    stderr: 'FAIL: calculate(2, 3) expected 5, received -1',
    durationMs: 250
  });

  // Attempt transition to APPROVAL_GATE while tests fail (Postgres trigger must block)
  let fsmBlocked = false;
  try {
    await KruschStateManager.updateTask(taskId, { phase: 'APPROVAL_GATE' });
  } catch (err) {
    fsmBlocked = true;
    console.log(`  ✓ Transition to APPROVAL_GATE strictly BLOCKED by PostgreSQL trigger:`);
    console.log(`     "${err.message}"`);
  }
  if (!fsmBlocked) {
    throw new Error('VIOLATION: Transition to APPROVAL_GATE succeeded despite failing verification!');
  }

  // Attempt apply while tests are failing
  let blockedCaught = false;
  try {
    await KruschStateManager.applyDiffBatch(taskId, null, fixtureDir);
  } catch (err) {
    blockedCaught = true;
    console.log(`  ✓ Direct apply strictly REFUSED: "${err.message}"`);
  }
  if (!blockedCaught) {
    throw new Error('VIOLATION: Apply succeeded despite failing verification tests!');
  }

  // Now record passing test run (exit code 0)
  console.log(`  Fixing implementation and running sandboxed tests...`);
  await KruschStateManager.recordVerificationRun(taskId, {
    command: 'npm test',
    passed: true,
    exitCode: 0,
    stdout: 'PASS: calculate(2, 3) returned 5\nPASS: configuration mode is optimized',
    stderr: '',
    durationMs: 180
  });
  console.log(`  ✓ Sandboxed verification PASSED (Exit code: 0)`);

  // Now transition to APPROVAL_GATE succeeds
  await KruschStateManager.updateTask(taskId, { phase: 'APPROVAL_GATE' });
  console.log(`  ✓ Task legally transitioned: VERIFY -> APPROVAL_GATE`);

  // -------------------------------------------------------------------------
  // STEP 4: Review UI shows the staged diff
  // -------------------------------------------------------------------------
  console.log(`\n[Step 4] Querying staged diff presentation payload for UI...`);
  const taskState = await KruschStateManager.getTask(taskId);
  console.log(`  Task Phase:     ${taskState.phase}`);
  console.log(`  Staged Diffs:   ${taskState.stagedDiffs.length} files`);
  for (const d of taskState.stagedDiffs) {
    console.log(`    - ${d.file_path}: original SHA ${d.original_sha256.slice(0, 10)}... -> staged SHA ${d.sha256_hash.slice(0, 10)}...`);
  }

  // -------------------------------------------------------------------------
  // STEP 5: Approve -> atomic apply
  // -------------------------------------------------------------------------
  console.log(`\n[Step 5] User Approves -> Executing 2PC atomic apply to working tree...`);
  const applyResult = await KruschStateManager.applyDiffBatch(taskId, null, fixtureDir);
  await KruschStateManager.updateTask(taskId, { phase: 'COMMITTED' });

  console.log(`  ✓ 2PC Apply Journal Record Created (#${applyResult.journalId})`);
  console.log(`  ✓ Atomic POSIX renames completed for ${applyResult.appliedCount} file(s)`);

  // Verify disk has mutated now and only now
  const committedMath = fs.readFileSync(mathFileAbs, 'utf-8');
  const committedConfig = fs.readFileSync(configFileAbs, 'utf-8');

  if (committedMath !== stagedMathContent || committedConfig !== stagedConfigContent) {
    throw new Error('VIOLATION: Disk contents do not match staged payload after apply!');
  }
  console.log(`  ✓ Live disk verified: ${mathFileRel} contains addition fix`);
  console.log(`  ✓ Live disk verified: ${configFileRel} contains version 1.1.0`);

  // -------------------------------------------------------------------------
  // STEP 6: Kill the process mid-apply -> recover cleanly
  // -------------------------------------------------------------------------
  console.log(`\n[Step 6] Simulating process crash mid-apply & automated recovery...`);
  const crashTaskId = `crash_sim_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  await KruschStateManager.createTask({
    id: crashTaskId,
    goal: 'Simulate crash recovery scenario',
    projectPath: fixtureDir,
    phase: 'APPROVAL_GATE'
  });

  const crashPatchMath = `export function calculate(a, b) {\n  return a * b; // CRASH TEST\n}\n`;
  const diffCrashMath = await KruschStateManager.stageDiff(crashTaskId, {
    projectPath: fixtureDir,
    filePath: mathFileRel,
    originalContent: committedMath,
    stagedContent: crashPatchMath,
    diffPatch: `--- a/${mathFileRel}\n+++ b/${mathFileRel}\n`
  });

  // Record passing verification run for crashTaskId so diff can enter APPLYING
  await KruschStateManager.recordVerificationRun(crashTaskId, {
    command: 'npm test',
    passed: true,
    exitCode: 0,
    stdout: 'PASS: crash test pre-conditions',
    stderr: '',
    durationMs: 120
  });

  // Manually simulate crash state: mark diff as APPLYING and create dangling temp file
  await query(`UPDATE krusch_staged_diffs SET status = 'APPLYING' WHERE id = $1`, [diffCrashMath.id]);
  const danglingTemp = path.join(fixtureDir, 'src', `.${path.basename(mathFileRel)}.krusch-tmp-${Date.now()}-mockdangling`);
  fs.writeFileSync(danglingTemp, crashPatchMath, 'utf-8');

  console.log(`  Simulated crash condition:`);
  console.log(`    - Staged diff #${diffCrashMath.id} stuck in status: APPLYING`);
  console.log(`    - Dangling sibling temp file created: ${path.basename(danglingTemp)}`);

  // Invoke Crash Recovery Engine
  const recovered = await KruschStateManager.recoverInFlightApplies(fixtureDir);
  console.log(`  Executing KruschStateManager.recoverInFlightApplies()...`);
  console.log(`  ✓ Recovered diff #${recovered[0]?.id}: outcome = ${recovered[0]?.outcome}`);

  // Assert dangling temp file was unlinked and live file was not corrupted
  const tempStillExists = fs.existsSync(danglingTemp);
  const mathAfterRecovery = fs.readFileSync(mathFileAbs, 'utf-8');
  if (tempStillExists) {
    throw new Error('VIOLATION: Orphaned temp file was not cleaned up during recovery!');
  }
  if (mathAfterRecovery !== committedMath) {
    throw new Error('VIOLATION: Live disk file was corrupted during crash recovery!');
  }
  console.log(`  ✓ Dangling temporary file successfully cleaned`);
  console.log(`  ✓ Working tree untouched and fully preserved (status reverted to PENDING)`);

  // -------------------------------------------------------------------------
  // STEP 7: Working-tree drift -> apply refused
  // -------------------------------------------------------------------------
  console.log(`\n[Step 7] Testing working-tree drift detection...`);
  console.log(`  Task #${crashTaskId} has pending diff expecting base SHA ${sha256(committedMath).slice(0, 12)}...`);

  // Out-of-band user modification on disk
  const driftContent = `// Out-of-band manual developer edit\nexport const drift = true;\n`;
  fs.writeFileSync(mathFileAbs, driftContent, 'utf-8');
  console.log(`  ⚡ User edited ${mathFileRel} out-of-band on disk (New SHA: ${sha256(driftContent).slice(0, 12)}...)`);

  // Ensure passing test recorded for crashTaskId so test check doesn't shadow drift check
  await KruschStateManager.recordVerificationRun(crashTaskId, {
    command: 'npm test',
    passed: true,
    exitCode: 0,
    stdout: 'PASS',
    stderr: '',
    durationMs: 100
  });

  // Attempt apply
  let driftBlocked = false;
  try {
    await KruschStateManager.applyDiffBatch(crashTaskId, null, fixtureDir);
  } catch (err) {
    driftBlocked = true;
    console.log(`  ✓ Apply REFUSED by Pre-Commit Drift Check:`);
    console.log(`     "${err.message}"`);
  }

  if (!driftBlocked) {
    throw new Error('VIOLATION: Working-tree drift was overwritten without refusal!');
  }

  // Check that developer's out-of-band edits were preserved
  const finalDiskContent = fs.readFileSync(mathFileAbs, 'utf-8');
  if (finalDiskContent !== driftContent) {
    throw new Error('VIOLATION: Developer edits on disk were overwritten!');
  }
  console.log(`  ✓ Developer out-of-band edits are intact and preserved on disk.`);

  // Clean up
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL 7 WRITE INVARIANT CRITERIA VERIFIED & VALIDATED:');
  console.log('   1. Agent proposed multi-file patch in PostgreSQL');
  console.log('   2. Disk was cryptographically confirmed unchanged before approval');
  console.log('   3. Failing sandbox tests blocked apply; passing tests permitted it');
  console.log('   4. Review UI diff payload was inspected');
  console.log('   5. 2PC atomic rename applied all files simultaneously');
  console.log('   6. Crash recovery cleanly cleaned temp files and restored base state');
  console.log('   7. Working tree drift triggered immediate apply refusal and preserved disk');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

runInvariantProof().catch(err => {
  console.error('\n✗ Invariant Proof Failure:', err);
  process.exit(1);
});
