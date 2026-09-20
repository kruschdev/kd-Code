import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('Write Invariant 7-Step Proof', () => {
  it('passes all 7 cryptographic and transactional invariants', () => {
    const res = spawnSync('node', ['scripts/demo-write-invariant.js'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 30000
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('ALL 7 WRITE INVARIANT CRITERIA VERIFIED & VALIDATED');
    expect(res.stdout).toContain('DISK IS 100% UNCHANGED');
    expect(res.stdout).toContain('Real sandboxed tests failed');
    expect(res.stdout).toContain('Sandboxed verification PASSED');
    expect(res.stdout).toContain('2PC Apply Journal Record Created');
    expect(res.stdout).toContain('Worker process terminated (Signal: SIGKILL)');
    expect(res.stdout).toContain('Dangling temporary file successfully cleaned');
    expect(res.stdout).toContain('Apply REFUSED by Pre-Commit Drift Check');
  });
});
