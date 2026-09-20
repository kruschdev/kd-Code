# KD Code

<div align="center">
  <img src="./docs/assets/banner.png" alt="KD Code Architecture Banner" width="100%" />
</div>

<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/Node.js-22+-green.svg)
![Effect](https://img.shields.io/badge/Effect--TS-Strict-blue.svg)
![DB](https://img.shields.io/badge/Database-PostgreSQL%20(pgvector)-lightgrey.svg)

> **Developer workbench and AI control plane: switch seamlessly between Claude, Gemini, and local models without ever losing project context or architectural state.**

**KD Code** is the visual control plane and developer workbench for the KruschDev coding ecosystem. It provides the human-in-the-loop interaction surface—chat, thread history, branch management, and rich pre-commit diff review (powered by `@pierre/diffs`).

Rather than trying to be a monolithic engine that does everything in one process, KD Code is explicitly architected as **stateless glass** sitting atop a vertical stack of specialized services:

```text
[ Developer ]
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                       KD Code                               │
│   Thin Client UI + Control Plane (Web / Electron)           │
│   • Windows, threads, composer, prompt engineering          │
│   • Native pre-commit diff viewer (@pierre/diffs)           │
│   • Approval surface & terminal manager                     │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP / MCP Bridge (:3778)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    krusch (Coding Harness)                  │
│   PostgreSQL ACID Staging & 2PC Apply Engine                │
│   • Diffs staged in Postgres (krusch_staged_diffs)          │
│   • Sandboxed test verification (krusch.verify.json)        │
│   • 2PC Apply Journal (atomic rename & disk commit)         │
│   • Task FSM, file leases, and startup crash recovery       │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌───────────────────────────────┐ ┌───────────────────────────┐
│     Routing Substrate         │ │   Memory & Context Plane  │
│ • krusch-pre-router           │ │ • krusch-context-mcp      │
│ • krusch-cascade-router       │ │ • AST symbol graph & RRF  │
│ • Provider adapters           │ │ • Steering nuggets        │
└───────────────────────────────┘ └───────────────────────────┘
```

---

## 🏛️ Ecosystem Division of Responsibility

| Concern | Single Owner | Repo / Component |
|---|---|---|
| **Workbench, UI, Diff Viewer, Chat, Remote Client** | KD Code | `krusch-ide` (`apps/web`, `apps/desktop`) |
| **Execution, Staged Diffs, Test Sandboxing, 2PC Apply** | krusch | `krusch` (`bin/krusch.js`, PostgreSQL FSM) |
| **Syntactic Cost Gating** | krusch-pre-router | `krusch-pre-router` (when running alongside) |
| **Model Cascade & Specialist Routing** | krusch-cascade-router | `krusch-cascade-router` (when running alongside) |
| **Episodic Memory, AST Symbols, Steering Nuggets** | krusch-context-mcp | `krusch-context-mcp` (v1.6.3 memory plane) |
| **Ecosystem Bridge Daemon** | KD Bridge | `scripts/context-cli.js serve 3778` (127.0.0.1) |

---

## ⚡ Quick Start

### Prerequisites

- Node.js (`>= 22.0.0`) and Bun (`>= 1.0.0`)
- Docker & Docker Compose (for PostgreSQL + `pgvector`)

### 1. Boot the PostgreSQL Persistence Layer

```bash
docker compose up -d
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Start the Ecosystem Bridge Daemon

The bridge daemon connects KD Code to `krusch-context-mcp` (memory/steering) and `krusch` (staging harness):

```bash
# Start the loopback HTTP bridge (127.0.0.1:3778)
node scripts/context-cli.js serve 3778
```

To verify connectivity and database health:
```bash
node scripts/context-cli.js health
```

### 4. Start the KD Code Workbench

For the Web UI:
```bash
bun run dev:web
```
Open [http://localhost:5733](http://localhost:5733) in your browser.

For the Electron Desktop client:
```bash
bun run dev:desktop
```

---

## 🧠 The Memory Plane: `krusch-context-mcp`

KD Code does not run a fragile, in-process RAG loop. Instead, context recall, symbol navigation, and behavioral steering are delegated to the **`krusch-context-mcp`** service:

- **Context Retention Across Model Switches:** State is compiled from PostgreSQL (`krusch_context_compile_state`), allowing you to switch between different LLM providers or local models with seamless retention of architectural invariants.
- **AST Symbol Extraction & Reciprocal Rank Fusion (RRF):** Dense vector similarity is combined with AST code symbol extraction to provide recall of function signatures and type contracts.
- **Steering Nuggets:** Prior debugging learnings and negative constraints are indexed and injected as proactive nudges before each turn.

---

## 🔒 The Write Invariant: `krusch` Staging & 2PC Apply

KD Code never mutates physical disk files directly during agent reasoning:

1. **Pre-Commit Staging**: All diffs proposed by models are stored in PostgreSQL (`krusch_staged_diffs`) with SHA-256 validation. Physical disk files remain untouched.
2. **Sandboxed Verification**: Automated tests execute against an isolated staged-tree sandbox (`krusch.verify.json`).
3. **Diff Review in KD Code**: Staged diffs are rendered in KD Code via `@pierre/diffs`.
4. **Two-Phase Commit**: Clicking "Approve" triggers `krusch_apply_diff`, which executes a 2PC journal write (temp file + `fsync` + atomic rename). If working tree drift is detected, the write is refused.

---

## 🛠️ Configuration & Sibling Repositories

Configuration is loaded via `.env` (refer to `.env.example`). Sibling components are discovered via parent directory convention (`../<repo>`) or explicit environment variables:

- **`KRUSCH_CONTEXT_MCP`**: Path to memory MCP service (default: `../krusch-context-mcp/src/index.js`).
- **`KRUSCH_HARNESS`**: Path to krusch staging engine (default: `../krusch/bin/krusch.js`).
- **`KRUSCH_PRE_ROUTER`**: Path to pre-router (default: `../krusch-pre-router/dist/index.js`).
- **`DATABASE_URL`**: Primary PostgreSQL connection string (default: `postgres://kdcode:password@localhost:5432/kdcode`).
- **`OLLAMA_URL`**: Local inference/embedding server (default: `http://localhost:11434`).

---

## 🤝 Contributing & Ecosystem Links

- **krusch**: [github.com/kruschdev/krusch](https://github.com/kruschdev/krusch)
- **krusch-context-mcp**: [github.com/kruschdev/krusch-context-mcp](https://github.com/kruschdev/krusch-context-mcp)
- **krusch-pre-router**: [github.com/kruschdev/krusch-pre-router](https://github.com/kruschdev/krusch-pre-router)

## License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) for details.
