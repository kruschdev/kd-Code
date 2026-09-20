# Contributing to KD Code

Thank you for contributing to **KD Code**, the developer control plane and workbench for the KruschDev ecosystem.

## Principles & Boundaries

- **UI and Bridge ONLY**: This repository contains the thin client (`apps/web`, `apps/desktop`) and the ecosystem bridge (`scripts/context-cli.js`). Execution logic lives in sibling services (`krusch`, `krusch-context-mcp`).
- **Disk Write Invariant**: Agent turns must never mutate the user's working tree directly. All changes stage in PostgreSQL (`krusch_staged_diffs`), run sandboxed verification, and apply via 2PC atomic journal.
- **Unified CLI**: Use `node bin/kdcode.js` (`up`, `doctor`, `demo-invariant`, `ci`) for local workflow automation.

## How Can I Contribute?

### Reporting Issues
If you encounter any bridge connection drops, PostgreSQL transaction issues, or UI regressions, please open an issue with:
- Reproduction steps
- Node & PostgreSQL version
- Diagnostic output from `node bin/kdcode.js doctor`

### Pull Requests
1. **Fork the repo** and create your feature branch.
2. **Verify the Invariant**: Run `node bin/kdcode.js demo-invariant` to confirm the 7-step write invariant is preserved.
3. **Verify Model Continuity**: Run `node bin/kdcode.js verify-models` to confirm zero context loss across provider switches.
4. **Run Grounded Benchmarks**: Run `node bin/kdcode.js bench` to measure real 2PC and drift latencies.
5. **Lint & Typecheck**: Run `bun run lint` and `bun run typecheck`.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/kruschdev/kd-Code.git
cd kd-Code # (or krusch-ide)

# Run ecosystem diagnostics
node bin/kdcode.js doctor

# Run full development stack
node bin/kdcode.js up
```
