#!/usr/bin/env node

/**
 * @file scripts/headless-ci.js
 * 
 * Thin Headless CI Runner for KD Code & Krusch:
 * Executes pre-commit staging, sandboxed verification, and 2PC atomic apply
 * without Electron, UI, or browser dependencies.
 * 
 * Usage:
 *   node scripts/headless-ci.js <projectPath> [--patch=<patchFile>] [--allow-roots=<roots>]
 *   kdcode ci <projectPath> [--patch=<patchFile>]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Dynamically resolve Krusch harness components
const kruschHarnessPath = process.env.KRUSCH_HARNESS || path.resolve(REPO_ROOT, '../krusch/bin/krusch.js');
const kruschRoot = path.dirname(path.dirname(kruschHarnessPath));
const stateManagerModule = path.resolve(kruschRoot, 'src/brain/state-manager.js');
const contractModule = path.resolve(kruschRoot, 'src/verify/contract.js');

if (!fs.existsSync(stateManagerModule) || !fs.existsSync(contractModule)) {
  console.error(`✗ Cannot find Krusch modules in: ${kruschRoot}`);
  process.exit(1);
}

const { KruschStateManager } = await import(stateManagerModule);
const { KruschVerificationContract } = await import(contractModule);

// Default forbidden write roots / paths for safe defaults
const DEFAULT_FORBIDDEN_PATTERNS = [
  /^\.git\//,
  /^\.env(?:\..*)?$/,
  /credentials(?:\.json)?$/i,
  /id_rsa(?:\..*)?$/i,
  /secrets?(?:\..*)?$/i
];

function isForbiddenPath(relPath) {
  return DEFAULT_FORBIDDEN_PATTERNS.some(pat => pat.test(relPath));
}

async function runHeadlessCI() {
  const args = process.argv.slice(2);
  const projectArg = args.find(a => !a.startsWith('--'));
  const patchArg = args.find(a => a.startsWith('--patch='))?.split('=')[1];
  const goalArg = args.find(a => a.startsWith('--goal='))?.split('=')[1] || 'Headless CI Automated Verification';

  if (!projectArg) {
    console.error(`
Usage:
  node scripts/headless-ci.js <projectPath> [--patch=<patch.json>] [--goal="description"]
`);
    process.exit(1);
  }

  const projectPath = path.resolve(projectArg);
  if (!fs.existsSync(projectPath)) {
    console.error(`✗ Target project path does not exist: ${projectPath}`);
    process.exit(1);
  }

  console.log('────────────────────────────────────────────────────────────────────────');
  console.log('🤖 KD CODE HEADLESS CI RUNNER');
  console.log(`📁 Target Repository: ${projectPath}`);
  console.log('────────────────────────────────────────────────────────────────────────\n');

  // Load project verification contract if present
  const contract = KruschVerificationContract.loadContract(projectPath);
  if (contract) {
    console.log(`[Contract] Found krusch.verify.json:`);
    console.log(`  Test Command:     "${contract.command || 'auto-detect'}"`);
    console.log(`  Sandboxed:        ${contract.sandbox !== false}`);
    if (contract.forbiddenPaths) console.log(`  Forbidden Paths:  ${contract.forbiddenPaths.join(', ')}`);
    if (contract.allowedWriteRoots) console.log(`  Allowed Roots:    ${contract.allowedWriteRoots.join(', ')}`);
  } else {
    console.log(`[Contract] No krusch.verify.json found. Auto-detecting test harness...`);
  }

  // Load patch file if provided
  let stagedFiles = [];
  if (patchArg) {
    const patchPath = path.resolve(patchArg);
    if (!fs.existsSync(patchPath)) {
      console.error(`✗ Patch file not found: ${patchPath}`);
      process.exit(1);
    }
    const rawPatch = JSON.parse(fs.readFileSync(patchPath, 'utf-8'));
    stagedFiles = Array.isArray(rawPatch) ? rawPatch : rawPatch.files || [rawPatch];
    console.log(`[Patch] Loaded ${stagedFiles.length} file modification(s) from ${path.basename(patchPath)}`);
  } else {
    console.log(`[Patch] No patch file specified. Verifying repository working state...`);
  }

  // Safer Defaults Step 1: Write root allowlist & forbidden path check
  for (const item of stagedFiles) {
    const rel = item.filePath || item.file_path;
    if (isForbiddenPath(rel)) {
      console.error(`\n❌ SECURITY REFUSAL: Proposed diff touches sensitive forbidden path '${rel}'.`);
      console.error(`   Apply rejected. Working tree untouched.`);
      process.exit(1);
    }

    if (contract?.forbiddenPaths?.includes(rel)) {
      console.error(`\n❌ CONTRACT VIOLATION: Proposed diff touches contract forbidden path '${rel}'.`);
      console.error(`   Apply rejected. Working tree untouched.`);
      process.exit(1);
    }

    if (contract?.allowedWriteRoots?.length > 0) {
      const isAllowed = contract.allowedWriteRoots.some(root => rel.startsWith(root));
      if (!isAllowed) {
        console.error(`\n❌ WRITE ROOT VIOLATION: Path '${rel}' is outside allowed write roots: ${contract.allowedWriteRoots.join(', ')}`);
        console.error(`   Apply rejected. Working tree untouched.`);
        process.exit(1);
      }
    }
  }

  // Step 2: Initialize task in PostgreSQL
  const taskId = `ci_task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  console.log(`\n[Step 1] Registering CI task in PostgreSQL (Task ID: ${taskId})...`);
  await KruschStateManager.createTask({
    id: taskId,
    goal: goalArg,
    projectPath,
    phase: stagedFiles.length > 0 ? 'IMPLEMENT' : 'APPROVAL_GATE'
  });

  // Step 3: Stage diffs in PostgreSQL (Disk untouched)
  const stagedDiffRecords = [];
  for (const item of stagedFiles) {
    const rel = item.filePath || item.file_path;
    const full = path.join(projectPath, rel);
    const orig = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
    const staged = item.stagedContent !== undefined ? item.stagedContent : item.content;

    const record = await KruschStateManager.stageDiff(taskId, {
      projectPath,
      filePath: rel,
      originalContent: orig,
      stagedContent: staged,
      diffPatch: item.diffPatch || `--- a/${rel}\n+++ b/${rel}\n`
    });
    stagedDiffRecords.push(record);
    console.log(`  ✓ Staged '${rel}' (Diff ID #${record.id}, SHA-256: ${record.sha256_hash.slice(0, 12)}...)`);
  }

  // Step 4: Sandboxed Verification
  console.log(`\n[Step 2] Executing sandboxed test verification...`);
  await KruschStateManager.updateTask(taskId, { phase: 'VERIFY' });

  let verifResult;
  try {
    verifResult = await KruschVerificationContract.runInStagedTree(projectPath, stagedDiffRecords, {
      command: contract?.command
    });
  } catch (err) {
    verifResult = {
      command: contract?.command || 'unknown',
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: err.message,
      durationMs: 0
    };
  }

  await KruschStateManager.recordVerificationRun(taskId, {
    command: verifResult.command,
    passed: verifResult.passed,
    exitCode: verifResult.exitCode,
    stdout: verifResult.stdout,
    stderr: verifResult.stderr,
    durationMs: verifResult.durationMs || 0
  });

  if (!verifResult.passed) {
    console.error(`\n❌ VERIFICATION FAILED (Exit Code: ${verifResult.exitCode})`);
    if (verifResult.stderr) console.error(`   ${verifResult.stderr}`);
    if (verifResult.stdout) console.error(`   ${verifResult.stdout}`);
    console.error(`\n🔒 Disk Write Invariant Preserved: Working tree remains 100% untouched.`);
    try {
      await KruschStateManager.updateTask(taskId, { phase: 'ABORTED' });
    } catch (_) {}
    process.exit(1);
  }

  console.log(`  ✓ Sandboxed verification PASSED (Exit Code: 0, Duration: ${verifResult.durationMs}ms)`);

  // Step 5: 2PC Atomic Apply
  console.log(`\n[Step 3] Executing 2PC Two-Phase Commit to physical working tree...`);
  await KruschStateManager.updateTask(taskId, { phase: 'APPROVAL_GATE' });
  const applyRes = await KruschStateManager.applyDiffBatch(taskId, null, projectPath);
  await KruschStateManager.updateTask(taskId, { phase: 'COMMITTED' });

  console.log(`  ✓ 2PC Apply Journal Created (Journal ID #${applyRes.journalId})`);
  console.log(`  ✓ Committed ${applyRes.appliedCount} file(s) cleanly to disk.`);
  console.log(`  ✓ Task phase: COMMITTED`);

  console.log('\n────────────────────────────────────────────────────────────────────────');
  console.log('✅ HEADLESS CI SUCCESS: Verification contracts satisfied & disk committed.');
  console.log('────────────────────────────────────────────────────────────────────────\n');
  process.exit(0);
}

runHeadlessCI().catch(err => {
  console.error('\n✗ Headless CI Fatal Error:', err);
  process.exit(1);
});
