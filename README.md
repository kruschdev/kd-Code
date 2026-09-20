# KD Code

<div align="center">
  <img src="./docs/assets/banner.png" alt="KD Code Architecture Banner" width="100%" />
</div>

<br />

> ⚠️ **Status: v0.1 experimental · Single maintainer · Requires PostgreSQL (`pgvector`)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/Node.js-22+-green.svg)
![Version](https://img.shields.io/badge/Release-v0.1.0-blue.svg)
![Database](https://img.shields.io/badge/Database-PostgreSQL%20(pgvector)-lightgrey.svg)
![Invariant](https://img.shields.io/badge/Write%20Invariant-2PC%20Enforced-success.svg)

**KD Code** is the developer control plane and visual workbench for the KruschDev coding ecosystem. It provides the human-in-the-loop interaction surface: thread history, staged diff reviews powered by `@pierre/diffs`, compiled state inspection, and two-phase commit (2PC) approval gates.

Rather than running a monolithic in-process server or letting AI models write directly to your codebase and hoping tests pass, KD Code is architected as **stateless glass** connected to an ACID staging harness and memory substrate.

---

## 📊 Local Microbenchmarks (Development Host)

> ℹ️ **Scope Note**: These metrics are measured local microbenchmarks of 2PC apply, drift refusal, staged-tree sandbox execution, and context assembly across $N=25$ trials on a single development workstation, not an ecosystem-wide production SLA.

| Metric | Measured Value | Architecture Substrate / Test Contract |
|---|---|---|
| **2PC Apply Success Rate** | **100.0%** | Atomic tempfile `fsync` + POSIX rename via `applyDiffBatch` (N=25) |
| **2PC Apply Median Latency** | **32.19ms** | Pre-commit drift check, durable journal insert, and filesystem rename |
| **Drift Refusal Rate** | **100.0%** | Pre-apply preimage SHA-256 validation prevents overwrite (N=25) |
| **Drift Detection Latency** | **11.53ms** | Working tree disk inspection before rename phase |
| **Sandboxed Verification Latency** | **0.16s** | Isolated staged-tree copy + `node --test` (`krusch.verify.json`) |
| **Context Assembly Latency** | **16.53ms** | AST symbol retrieval, active file leases, and repo mapping |
| **Compiled State Size** | **~0.8 KB** | Minified active FSM, open files, task leases, and AST symbols |

*Measured on 2026-09-20 · Machine: Intel(R) Core(TM) i7-5820K CPU @ 3.30GHz (12 vCPUs, x64) · Node.js v22.23.2 · Reproduce: `node bin/kdcode.js bench --iterations=25`*

---

## 🎯 The Three Jobs of the Workbench UI

KD Code is not trying to clone every editor feature. It focuses on three core jobs:

1. **Thread + 2PC Approval Queue**: Inspect model reasoning and pending actions with real-time FSM phase progression (`INIT` → `PLAN` → `IMPLEMENT` → `VERIFY` → `APPROVAL_GATE` → `COMMITTED`).
2. **Staged Diff Review Center-Stage**: Pre-commit diffs rendered via `@pierre/diffs` occupying the focal view, ensuring you review exactly what will be written before any disk mutation occurs.
3. **Compiled State & Routing Inspector**: Full transparency into **"Why this model?"** (L1 Syntactic Gate vs L2 Neural Centroid, confidence score, routing archetype) and **"What will the next model see?"** with live compiled prompt state, active file concurrency leases, and secret redaction.

---

## ⚡ Unified Quick Start (`kdcode`)

All services, diagnostics, and verification proofs run through a single executable CLI:

```bash
# 1. Start full stack (Postgres check + migrations + bridge daemon + web UI)
node bin/kdcode.js up

# 2. Run ecosystem diagnostics (fails with specific missing piece and fix action)
node bin/kdcode.js doctor

# 3. Prove the 7-step write invariant with live test execution
node bin/kdcode.js demo-invariant

# 4. Verify prompt packaging & injected prefix parity across Claude and Gemini/Ollama
node bin/kdcode.js verify-models

# 5. Run real measured reliability and latency benchmarks
node bin/kdcode.js bench --iterations=25

# 6. Run headless CI mode (sandboxed test verification & 2PC apply without Electron)
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-good-refactor.json
```

---

## 🔒 The Write Invariant: Staged Diffs & 2PC Apply

**KD Code never mutates physical working tree files directly during model reasoning.**

```text
[ LLM Proposes Patch ]
          │
          ▼
1. Pre-Commit Staging ──────► Stored in PostgreSQL (krusch_staged_diffs)
                              Physical disk remains 100% UNTOUCHED
          │
          ▼
2. Sandboxed Verification ──► Isolated test execution (krusch.verify.json)
                              If tests fail: apply refused, task aborted
          │
          ▼
3. Visual Diff Review ──────► Rendered in KD Code UI via @pierre/diffs
          │
          ▼
4. Two-Phase Commit (2PC) ──► Developer clicks "Approve"
                              - Validates working tree SHA-256 (no drift)
                              - Acquires single-writer file lease
                              - Writes to .krusch_tmp with fsync
                              - Atomic filesystem rename
                              - Logs commit to krusch_apply_journal
```

### Proving the Invariant
Run the automated demonstration to watch the full lifecycle execute against real files and PostgreSQL:
```bash
node bin/kdcode.js demo-invariant
```
The script validates:
1. Multi-file patch proposed.
2. Disk verified unchanged via cryptographic hashes.
3. Sandboxed test fails, then passes.
4. Review state generated.
5. Atomic 2PC apply committed.
6. Process kill simulated mid-apply with clean journal recovery.
7. External working-tree drift detected and apply rejected.

---

## 🛡️ Safer Defaults

- **Strict Verification Gating**: No diff can transition to `APPROVAL_GATE` or `COMMITTED` without a recorded passing test run if `krusch.verify.json` exists.
- **Write Root Allowlist**: Diffs attempting to mutate paths outside `allowedWriteRoots` are rejected before sandbox creation.
- **Forbidden Path Protection**: Default and contract protection for `.env`, `credentials.json`, `id_rsa`, and sensitive paths.
- **Visible Concurrency Leases**: Active file leases and lock holders are visible in both the UI inspector and CLI (`kdcode doctor`).
- **Secret & Token Redaction**: In-flight chat messages, compiled context, and staged diffs automatically redact API keys (`sk-...`, `AIza...`), bearer tokens, and credentials.

---

## 📂 Architecture & Pinned Ecosystem Layout

Sibling services reside alongside KD Code or are configured via environment overrides:

| Component | Minimum Version | Default Path | Environment Override | Responsibility |
|---|---|---|---|---|
| **KD Code UI** | `0.1.0` | `.` | — | Workbench UI, diff review, approval gates |
| **Coding Harness** | `>=0.1.0` | `../krusch/bin/krusch.js` | `KRUSCH_HARNESS` | 2PC journal, task FSM, file leases |
| **Memory Plane** | `>=1.6.0` | `../krusch-context-mcp/src/index.js` | `KRUSCH_CONTEXT_MCP` | Episodic memory, AST symbol graph, steering |
| **Pre-Router** | `>=1.0.0` | `../krusch-pre-router/dist/index.js` | `KRUSCH_PRE_ROUTER` | L1 syntactic cost gating & archetype routing |

Pinned compatibility is defined centrally in [`krusch-ecosystem.json`](./krusch-ecosystem.json) and validated on every boot by `kdcode doctor`.

---

## 🧪 Reference Repository (10-Minute Reproduction)

A zero-dependency reference project with verification contracts is available in [`examples/reference-repo`](./examples/reference-repo):

```bash
# Test baseline
cd examples/reference-repo && node --test test/*.test.js

# Test A: Known-good refactor (passes verification -> 2PC commit)
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-good-refactor.json

# Test B: Known-bad hallucination (fails verification -> apply refused, disk untouched)
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-bad-test-failure.json

# Test C: Sensitive path modification (contract violation -> apply refused, disk untouched)
node bin/kdcode.js ci examples/reference-repo --patch=examples/reference-repo/fixtures/known-bad-forbidden-write.json
```

---

## 📄 License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) for details.
