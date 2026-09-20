# Observability in KD Code

KD Code functions as a developer control plane and visual workbench connecting to PostgreSQL and sibling runtime services.

Observability is maintained across three operational planes:

1. **Bridge Tracing**: HTTP/MCP bridge requests, tool invocations, and route dispatching log structured events to `data/traces.jsonl`.
2. **PostgreSQL Audit & FSM Logs**: All agent actions, FSM state transitions, 2PC apply journals, and verification runs persist durably in PostgreSQL tables:
   - `krusch_tasks`: Task lifecycle and FSM phases (`INIT` → `PLAN` → `IMPLEMENT` → `VERIFY` → `APPROVAL_GATE` → `COMMITTED`).
   - `krusch_events`: Structured lifecycle and routing telemetry (`routing_decision`, `apply_started`, `apply_fsync`, `apply_completed`, `recovery_performed`, `drift_detected`).
   - `krusch_staged_diffs`: Staged pre-commit diffs, SHA-256 hashes, and approval status.
   - `krusch_apply_journal`: Two-Phase Commit transaction journal with pre/post status and affected files.
   - `krusch_verification_runs`: Ground-truth test outputs, exit codes, test durations, and contract validations.
3. **Client Logging**: Desktop logs are written to `~/.kdcode/userdata/logs/` with rotating log files.

---

## Inspecting Bridge & Runtime Health

Use the unified CLI to inspect real-time ecosystem health and database state:

```bash
# 1. Inspect bridge daemon, database connectivity, and sibling components
node bin/kdcode.js doctor

# 2. Inspect active FSM state and memory plane compilation
curl http://127.0.0.1:3778/api/state?project=kdcode

# 3. View latest bridge traces
tail -n 20 data/traces.jsonl
```

---

## Querying PostgreSQL Audit Events

You can inspect the audit trail directly in PostgreSQL:

```sql
-- View recent task transitions and approvals
SELECT id, goal, phase, current_model, updated_at
FROM krusch_tasks
ORDER BY updated_at DESC
LIMIT 10;

-- View 2PC Apply Journals
SELECT id, task_id, state, files, created_at, completed_at
FROM krusch_apply_journal
ORDER BY id DESC
LIMIT 5;

-- View ground-truth test verification runs
SELECT id, task_id, command, passed, exit_code, duration_ms, created_at
FROM krusch_verification_runs
ORDER BY id DESC
LIMIT 10;
```
