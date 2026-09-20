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
│ • krusch-pre-router (<15µs)   │ │ • krusch-context-mcp      │
│ • krusch-cascade-router (L2)  │ │   (Pinned v1.6.3)         │
│ • OpenRouter / Anthropic /    │ │ • AST symbol graph & RRF  │
│   Gemini / Ollama adapters    │ │ • Holographic steering    │
└───────────────────────────────┘ └───────────────────────────┘
```

---

## 🏛️ Ecosystem Division of Responsibility

| Concern | Single Owner | Repo / Component |
|---|---|---|
| **Workbench, UI, Diff Viewer, Chat, Remote Client** | KD Code | `krusch-ide` (`apps/web`, `apps/desktop`) |
| **Execution, Staged Diffs, Test Sandboxing, 2PC Apply** | krusch | `krusch` (`bin/krusch.js`, PostgreSQL FSM) |
| **Fast Syntactic Cost Gating (<15µs)** | krusch-pre-router | `krusch-pre-router` (Stage 0 / L1 gate) |
| **Model Cascade & Specialist Routing** | krusch-cascade-router | `krusch-cascade-router` (Stage 2 cascade) |
| **Episodic Memory, AST Symbols, Steering Nuggets** | krusch-context-mcp | `krusch-context-mcp` (v1.6.3 memory plane) |
| **Ecosystem Bridge Daemon** | KD Bridge | `scripts/context-cli.js serve 3778` |

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

The bridge daemon connects KD Code to `krusch-context-mcp` (memory/steering) and `krusch-pre-router`:

```bash
bun run bridge
```

To verify connectivity and database health:
```bash
bun run bridge:status
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

KD Code does not run a fragile, in-process RAG loop. Instead, all context recall, symbol navigation, and behavioral steering are delegated to the pinned **`krusch-context-mcp`** service (v1.6.3):

- **Zero Context Loss Across Model Switches:** State is compiled from PostgreSQL (`krusch_context_compile_state`), allowing you to switch between Gemini 3.1, Claude 3.7, or local Ollama models with seamless retention of architectural invariants.
- **AST Symbol Extraction & Reciprocal Rank Fusion (RRF):** Dense vector similarity is combined with AST code symbol extraction to guarantee pinpoint recall of function signatures and type contracts.
- **Holographic Steering Nuggets:** Prior debugging learnings and negative constraints are indexed and injected as proactive nudges before each turn.

---

## 🔒 The Write Invariant: `krusch` Staging & 2PC Apply

KD Code never mutates physical disk files directly during agent reasoning:

1. **Pre-Commit Staging**: All diffs proposed by models are stored in PostgreSQL (`krusch_staged_diffs`) with SHA-256 validation. Physical disk files remain untouched.
2. **Sandboxed Verification**: Automated tests execute against an isolated staged-tree sandbox (`krusch.verify.json`).
3. **Diff Review in KD Code**: Staged diffs are rendered in KD Code via `@pierre/diffs`.
4. **Two-Phase Commit**: Clicking "Approve" triggers `krusch_apply_diff`, which executes a 2PC journal write (temp file + `fsync` + atomic rename). If working tree drift is detected, the write is refused.

---

## 🛠️ Configuration

Configuration is loaded via `.env` (refer to `.env.example`):

- **`DATABASE_URL`**: Primary PostgreSQL connection string (e.g. `postgres://kdcode:password@localhost:5432/kdcode`).
- **`OLLAMA_URL`**: Local inference/embedding server (default: `http://localhost:11434`).
- **`GEMINI_API_KEY`**: Cloud provider credentials for Gemini models.
- **`ANTHROPIC_API_KEY`**: Cloud provider credentials for Claude models.

---

## 🤝 Contributing & Ecosystem Links

- **krusch**: [github.com/kruschdev/krusch](https://github.com/kruschdev/krusch)
- **krusch-context-mcp**: [github.com/kruschdev/krusch-context-mcp](https://github.com/kruschdev/krusch-context-mcp)
- **krusch-pre-router**: [github.com/kruschdev/krusch-pre-router](https://github.com/kruschdev/krusch-pre-router)

## License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) for details.
