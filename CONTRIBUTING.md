# Contributing to Krusch DBOS

First off, thank you for considering contributing to Krusch DBOS! We believe that scaling agentic workflows requires community insight, and we welcome your ideas, bug reports, and pull requests.

## How Can I Contribute?

### Reporting Bugs

If you encounter any lock contention issues, PostgreSQL connection drops, or UI bugs, please open an issue. Provide as much detail as possible, including:

- Steps to reproduce the behavior
- OS and database version
- Stack traces or error logs

### Suggesting Enhancements

Have an idea for a new AI provider adapter or an optimization for the DBOS queue? Open an issue tagged as `enhancement` to discuss it before you start writing code.

### Pull Requests

1. **Fork the repo** and create your branch from `main`.
2. **Ensure type safety**: We use `effect-ts` heavily. Run `bun run typecheck` to ensure there are no TypeScript errors.
3. **Keep it focused**: Please submit PRs that address a single, specific issue or feature. Massive refactors may be difficult to review quickly.
4. **Test your code**: Ensure the distributed DBOS architecture still functions correctly by verifying that concurrent agents can execute jobs without Postgres row-lock deadlocks.
   - _Note on Tests_: We use a custom `itLive` wrapper around `vitest` for `@effect/vitest` to prevent fiber leakage and test suite hangs during DBOS concurrency testing. Always use `itLive` instead of `it.live` for integration tests.
5. **Testing External Agents**: If you are developing integrations for external agents via SSE, do **not** trigger real external services during automated tests. Override the `EXTERNAL_AGENT_URL` environment variable to point to a local mocked HTTP server, or use Effect's dependency injection to provide a Test layer for the fetch implementation.
6. **Describe your changes**: Update documentation (`README.md` or `ARCHITECTURE.md`) if your changes introduce new configuration variables or architectural shifts.

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/krusch-dbos.git
cd krusch-dbos

# Install dependencies
bun install

# Run the typechecker
bun run typecheck
```

Thank you for helping us build a more scalable agentic IDE!
