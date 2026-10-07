# Aegis DevOS v6.7 — Reliability, Chaos & Recovery Testing

## Purpose
V6.7 adds a safe, isolated reliability suite. It does not mutate the application source tree or execute destructive commands against the target project. Chaos scenarios run against a temporary synthetic Aegis project and validate durable control-plane primitives.

## Checks
- Concurrent project lock rejection
- Stale lock recovery
- Idempotent operation duplicate/replay semantics
- Bounded exponential retry/backoff
- Durable event replay and acknowledgement
- SQLite close/reopen durability

## CLI
```bash
aegis reliability-test -p projects/my-saas
aegis reliability-status -p projects/my-saas
aegis reliability-history -p projects/my-saas
```

Reports are persisted under `.aegis/reliability/` using atomic temporary-file replacement for the suite report. A failed suite returns a non-zero exit code.

## Safety
This milestone is intentionally a reliability harness, not an unrestricted chaos monkey. Production-impacting network faults, process kills, database corruption, destructive filesystem operations, or cloud mutations are not injected automatically. Such tests belong in explicitly provisioned staging/CI environments with separate credentials and human-controlled blast-radius limits.

## Validation
`npm install --no-audit --no-fund` was attempted twice in the build runtime and timed out. Therefore a complete TypeScript build is not claimed. Source structure, command placement, archive creation, and SHA-256 packaging were verified.
