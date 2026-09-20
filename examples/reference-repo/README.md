# Reference Verification Repository

A minimal, zero-dependency reference project demonstrating **KD Code & Krusch Verification Contracts**, sandboxed pre-commit validation, and the Two-Phase Commit (2PC) write invariant.

---

## 🎯 Purpose

In KD Code, **agents never mutate working trees directly**. All proposed diffs are:
1. Held in PostgreSQL pre-commit staging.
2. Verified against project test suites inside an isolated sandbox (`krusch.verify.json`).
3. Refused immediately if tests fail, write boundaries are breached, or forbidden files are touched.
4. Committed atomically via 2PC journal only after explicit review or CI approval.

---

## ⏱️ 10-Minute Reproduction Guide

### Prerequisites
Make sure PostgreSQL is running and the KD Code CLI is available:
```bash
# Verify ecosystem health
node bin/kdcode.js doctor
```

### 1. Test Baseline Health
The reference repo uses Node's native test runner (`node --test`), requiring zero `node_modules`:
```bash
node --test test/*.test.js
```
*Expected: 5 tests pass.*

---

### 2. Scenario A: Known-Good Refactor (Sandboxed Test Pass → Atomic Apply)
Run the headless CI runner against a multi-file patch that introduces `modulo()` and `clamp()` with valid tests:

```bash
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-good-refactor.json
```

**What happens:**
1. The patch is staged in PostgreSQL (`krusch_staged_diffs`). The physical disk remains untouched.
2. A temporary sandbox clone is created.
3. Tests run via `krusch.verify.json` (`node --test test/*.test.js`) and pass (Exit code 0).
4. Sandboxed verification is recorded in PostgreSQL (`krusch_verification_runs`).
5. 2PC journal applies the modifications cleanly to `src/calculator.js` and `test/calculator.test.js`.

---

### 3. Scenario B: Known-Bad Hallucination (Broken Logic → Test Failure → Apply Refused)
Run the headless CI runner against a patch containing inverted arithmetic logic (`add()` returns `a - b`):

```bash
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-bad-test-failure.json
```

**What happens:**
1. Staged in PostgreSQL without touching disk.
2. Sandboxed test runner executes `node --test` in the sandbox.
3. Test fails with assertion error (`AssertionError: 2 - 3 == 5`).
4. **Apply refused.** Exit code 1.
5. **Disk Write Invariant Preserved:** The working tree on disk remains 100% untouched.

---

### 4. Scenario C: Known-Bad Security Breach (Forbidden File Modification Refused)
Run the headless CI runner against a patch attempting to overwrite `.env`:

```bash
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-bad-forbidden-write.json
```

**What happens:**
1. KD Code inspects the patch against `krusch.verify.json` and default security rules.
2. Identifies `.env` as a forbidden file outside `allowedWriteRoots: ["src/", "test/"]`.
3. **Execution terminates immediately:** `❌ SECURITY REFUSAL: Proposed diff touches sensitive forbidden path '.env'`.
4. Sandboxed execution is aborted. No disk write occurs.

---

## 📋 Verification Contract Schema (`krusch.verify.json`)

```json
{
  "name": "reference-repo-contract",
  "version": "1.0.0",
  "command": "node --test test/*.test.js",
  "sandbox": true,
  "timeoutMs": 15000,
  "allowedWriteRoots": [
    "src/",
    "test/"
  ],
  "forbiddenPaths": [
    ".env",
    "config/secrets.json",
    "private/"
  ]
}
```
