import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const kruschHarnessPath =
  process.env.KRUSCH_HARNESS || path.resolve(REPO_ROOT, "../krusch/bin/krusch.js");
const kruschRoot = path.dirname(path.dirname(kruschHarnessPath));
const stateManagerModule = path.resolve(kruschRoot, "src/brain/state-manager.js");
const contractModule = path.resolve(kruschRoot, "src/verify/contract.js");
const hasHarness = fs.existsSync(stateManagerModule) && fs.existsSync(contractModule);

describe("Write Invariant 7-Step Proof", () => {
  it.skipIf(!hasHarness)("passes all 7 cryptographic and transactional invariants", () => {
    const res = spawnSync("node", ["scripts/demo-write-invariant.js"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 30000,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("ALL 7 WRITE INVARIANT CRITERIA VERIFIED & VALIDATED");
    expect(res.stdout).toContain("DISK IS 100% UNCHANGED");
    expect(res.stdout).toContain("Real sandboxed tests failed");
    expect(res.stdout).toContain("Sandboxed verification PASSED");
    expect(res.stdout).toContain("2PC Apply Journal Record Created");
    expect(res.stdout).toContain("Worker process terminated (Signal: SIGKILL)");
    expect(res.stdout).toContain("Dangling temporary file successfully cleaned");
    expect(res.stdout).toContain("Apply REFUSED by Pre-Commit Drift Check");
  });
});
