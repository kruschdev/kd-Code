# KD Code Agent Context

KD Code is the developer control plane and visual workbench for the KruschDev ecosystem.

## 🎯 Repository Boundaries & Ownership

- **This repository owns UI and Bridge ONLY**:
  - `apps/web/`: React 19 frontend thin client with `@pierre/diffs`.
  - `apps/desktop/`: Electron thin client.
  - `scripts/context-cli.js`: HTTP & MCP bridge connecting the UI to sibling services.
  - **No execution server lives here**: Do not attempt to scaffold or run a backend server (`apps/server` does not exist in this repo).
- **Disk Write Invariant**:
  - **NEVER mutate the user's working tree directly from UI actions or agent reasoning.**
  - All agent disk mutations must pass through `krusch` pre-commit staging (`krusch_staged_diffs`) and sandboxed verification (`krusch.verify.json`).
  - Staged diff approval (`krusch_apply_diff`) via the 2PC journal is the **ONLY** permitted disk mutation path.

## 🗂️ Sibling Checkout Layout & Environment

Sibling services reside alongside this repository by convention, or can be overridden via environment variables:

| Component | Default Path | Environment Override |
|---|---|---|
| Memory Plane | `../krusch-context-mcp/src/index.js` | `KRUSCH_CONTEXT_MCP` |
| Coding Harness | `../krusch/bin/krusch.js` | `KRUSCH_HARNESS` |
| Pre-Router (L1) | `../krusch-pre-router/dist/index.js` | `KRUSCH_PRE_ROUTER` |

Database: PostgreSQL with `pgvector` (`postgres://kdcode:password@localhost:5432/kdcode`).
**NEVER wipe `kdcode-postgres-data`**: volume contains active context embeddings and centroids.

## 🚀 Exact Working Commands

```bash
# 1. Start Ecosystem Bridge Daemon (port 3778 on 127.0.0.1)
node scripts/context-cli.js serve 3778

# 2. Inspect Bridge & Memory Health
node scripts/context-cli.js health

# 3. Start Web Development UI (port 5733)
bun run dev:web

# 4. Run Tests & Typecheck
bun run test
bun run typecheck
```
