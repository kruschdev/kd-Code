# KD Code Agent Context

> **Project Origin**: Visual workbench and developer control-plane UI for the KruschDev ecosystem. KD Code pairs directly with the headless `krusch` ACID staging harness, `krusch-pre-router`, and the `krusch-context-mcp` memory plane.

## ⚠️ Hazards & Critical Safety Rules

- **NEVER use `docker-compose down -v`**: The PostgreSQL container utilizes the `pgvector` extension and stores critical RAG embeddings, memory centroids, and orchestration queues. Wiping the volume destroys all active context. Use `docker-compose down` (without `-v`) or `docker restart`.
- **NEVER use `it.live` in tests**: The Effect integration tests are vulnerable to fiber leakage when using standard `@effect/vitest` functions. You **MUST** use the custom `itLive` wrapper from the integration harness to ensure clean teardown and prevent the test runner from hanging indefinitely.
- **Do NOT mutate disk directly from model reasoning**: In this ecosystem, all agent disk mutations must pass through `krusch` pre-commit staging (`krusch_staged_diffs`) and sandboxed verification (`krusch.verify.json`) before a 2PC commit to disk.
- **SQLITE_BUSY / SQLite Drivers**: Primary memory and orchestration occur over PostgreSQL `JSONB` and `pgvector`. Do **NOT** scaffold local SQLite files for shared state.

## 🚀 Quick Start

```bash
# 1. Start the PostgreSQL Persistence Layer
docker compose up -d

# 2. Install dependencies
bun install

# 3. Start the Ecosystem Bridge Daemon (port 3778)
bun run bridge

# 4. Start the Development Server & Workbench UI (port 5733)
bun run dev:web
# Or start the desktop Electron client:
# bun run dev:desktop
```

## 🏗️ Architecture Overview

The KruschDev ecosystem cleanly separates **visual interaction** from **transactional execution** and **persistent memory**:

- **Stateless Glass (KD Code)**: The Electron desktop app and React web UI (`apps/web`, `apps/desktop`) serve as thin clients providing rich chat, thread navigation, project management, and pre-commit diff review (`@pierre/diffs`).
- **Transactional Harness (`krusch`)**: Headless execution engine. Holds model-generated diffs in PostgreSQL (`krusch_staged_diffs`), verifies them against test contracts in a staged sandbox, and applies them to disk only after approval via a 2PC journal (`krusch_apply_journal`).
- **Universal Memory Plane (`krusch-context-mcp`)**: Pinned v1.6.3 memory service. Manages project state compilation (`krusch_context_compile_state`), AST symbol extraction with hybrid RRF, episodic memory, and holographic steering nuggets.
- **Syntactic Cost Gating (`krusch-pre-router`)**: Sub-15µs CPU heuristic gate that intercepts syntax, SQL, and closed-world tasks for $0.00 before escalating to heavier frontier cascades.
- **Ecosystem Bridge (`scripts/context-cli.js`)**: Runs a lightweight HTTP bridge daemon on port 3778 to provide CORS-enabled endpoints for the web and desktop clients.

## 🗺️ Key File Map

| Component / Layer | Location | Purpose |
| ----------------- | -------- | ------- |
| **Web UI** | `apps/web/` | React 19 frontend thin client with `@pierre/diffs` and chat. |
| **Desktop App** | `apps/desktop/` | Electron thin client with window management and auto-update plumbing. |
| **Contracts** | `packages/contracts/` | Typed Effect Schema contracts for commands, events, models, and RPC. |
| **Shared** | `packages/shared/` | Cross-cutting utilities (shell environment, git, search ranking, settings). |
| **Client Runtime** | `packages/client-runtime/` | Environment resolution and scoped runtime state. |
| **Bridge Daemon** | `scripts/context-cli.js` | HTTP & MCP bridge connecting UI to `krusch` and `krusch-context-mcp`. |
| **Dev Runner** | `scripts/dev-runner.ts` | Multi-target Bun/Turbo runner managing web, desktop, and port allocation. |

## 🛠️ Common Tasks

- **Updating Configuration**: Adjust properties in `.env` (refer to `.env.example`).
- **Running Tests**: `bun run test` (runs unit tests across workspaces).
- **Typechecking**: `bun run typecheck` (executes `tsc --noEmit` across packages).
- **Checking Bridge Health**: `bun run bridge:status` (probes `krusch-context-mcp` and PostgreSQL connectivity).
- **Linting & Formatting**: `bun run lint` (`oxlint`) and `bun run fmt` (`oxfmt`).
