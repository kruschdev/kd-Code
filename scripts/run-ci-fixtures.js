#!/usr/bin/env node

/**
 * @file scripts/run-ci-fixtures.js
 * 
 * Executes all 3 reference repo CI fixtures and asserts strict contract outcomes:
 * 1. known-good-refactor.json   -> Exit code 0, 2PC applied, disk verified modified
 * 2. known-bad-test-failure.json -> Exit code 1, test failure in sandbox, disk verified untouched
 * 3. known-bad-forbidden-write.json -> Exit code 1, forbidden path refusal, disk verified untouched
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const REF_REPO = path.join(REPO_ROOT, 'examples/reference-repo');

function assert(condition, message) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function runGit(args, cwd = REPO_ROOT) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' });
}

function getFileContent(relPath) {
  const abs = path.join(REF_REPO, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🧪 RUNNING REFERENCE REPO CI FIXTURE VERIFICATIONS');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Ensure clean baseline from HEAD
  runGit(['checkout', 'HEAD', '--', 'examples/reference-repo']);
  const baselineCalcContent = getFileContent('src/calculator.js');
  assert(baselineCalcContent !== null, 'src/calculator.js must exist in reference-repo');

  // -------------------------------------------------------------------------
  // Fixture 1: Known-Good Refactor
  // -------------------------------------------------------------------------
  console.log('[Fixture 1/3] Testing: known-good-refactor.json (Expected: Exit 0 & 2PC Committed)');
  const res1 = spawnSync('node', [
    'bin/kdcode.js',
    'ci',
    'examples/reference-repo',
    '--patch=examples/reference-repo/fixtures/known-good-refactor.json'
  ], { cwd: REPO_ROOT, encoding: 'utf-8' });

  assert(res1.status === 0, `Fixture 1 expected exit code 0, got ${res1.status}.\nOutput:\n${res1.stdout}\n${res1.stderr}`);
  const modifiedCalcContent = getFileContent('src/calculator.js');
  assert(modifiedCalcContent !== baselineCalcContent, 'Fixture 1: Disk must reflect refactored calculator code');
  assert(modifiedCalcContent.includes('export function modulo(a, b)'), 'Fixture 1: modulo function must be present on disk');
  assert(modifiedCalcContent.includes('export function clamp(val, min, max)'), 'Fixture 1: clamp function must be present on disk');
  console.log('  ✓ Exit code: 0');
  console.log('  ✓ Working tree updated and verified on disk.');

  // Reset working tree before fixture 2
  runGit(['checkout', 'HEAD', '--', 'examples/reference-repo']);
  assert(getFileContent('src/calculator.js') === baselineCalcContent, 'Working tree reset cleanly');

  // -------------------------------------------------------------------------
  // Fixture 2: Known-Bad Test Failure (Hallucination)
  // -------------------------------------------------------------------------
  console.log('\n[Fixture 2/3] Testing: known-bad-test-failure.json (Expected: Exit 1 & Disk Untouched)');
  const res2 = spawnSync('node', [
    'bin/kdcode.js',
    'ci',
    'examples/reference-repo',
    '--patch=examples/reference-repo/fixtures/known-bad-test-failure.json'
  ], { cwd: REPO_ROOT, encoding: 'utf-8' });

  assert(res2.status !== 0, `Fixture 2 expected non-zero exit code (test failure in sandbox), got 0.`);
  const calcContentAfterBad = getFileContent('src/calculator.js');
  assert(calcContentAfterBad === baselineCalcContent, 'Fixture 2: Working tree must remain 100% UNTOUCHED on test failure');
  console.log('  ✓ Exit code: non-zero (refused by test runner)');
  console.log('  ✓ Invariant preserved: disk is 100% untouched.');

  // -------------------------------------------------------------------------
  // Fixture 3: Known-Bad Forbidden Write (Security Violation)
  // -------------------------------------------------------------------------
  console.log('\n[Fixture 3/3] Testing: known-bad-forbidden-write.json (Expected: Exit 1 & Security Refusal)');
  const res3 = spawnSync('node', [
    'bin/kdcode.js',
    'ci',
    'examples/reference-repo',
    '--patch=examples/reference-repo/fixtures/known-bad-forbidden-write.json'
  ], { cwd: REPO_ROOT, encoding: 'utf-8' });

  assert(res3.status !== 0, `Fixture 3 expected non-zero exit code (forbidden path security refusal), got 0.`);
  assert(!fs.existsSync(path.join(REF_REPO, '.env')), 'Fixture 3: Forbidden .env file must NOT have been created on disk');
  console.log('  ✓ Exit code: non-zero (refused by path contract)');
  console.log('  ✓ Invariant preserved: forbidden path write rejected, disk untouched.');

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL 3 CI FIXTURES PASSED STRICT CONTRACT VERIFICATION:');
  console.log('   - Known-good: sandbox passed -> 2PC committed cleanly');
  console.log('   - Known-bad test: sandbox failed -> apply refused, disk untouched');
  console.log('   - Known-bad forbidden write: contract violated -> apply refused, disk untouched');
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
