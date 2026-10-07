# Production Runbook

## Preflight

Run `aegis production-readiness -p <project>` before release. A release is not ready when any required check fails.

## Backup

Create a consistent SQLite backup before upgrades:

`aegis db-backup -p <project> --output backups/aegis-YYYYMMDD-HHMMSS.db`

Verify it before storing it remotely:

`aegis db-verify --file backups/aegis-YYYYMMDD-HHMMSS.db`

Keep backups outside the source repository and encrypt them according to the deployment environment's data policy.

## Restore

Stop Aegis workers/daemons first. Restore only from a verified backup:

`aegis db-restore -p <project> --file backups/aegis-YYYYMMDD-HHMMSS.db`

The command creates a pre-restore backup when a target database already exists. Re-run production readiness and inspect event/runtime state before restarting workers.

## Secrets

Provider credentials must be injected by the deployment secret manager/environment. Never commit `.env` files, API keys, access tokens, private keys, or provider credentials.

## Isolation

Run command/AI workers inside an OS/container/VM boundary with least-privilege filesystem and network permissions. Aegis's policy checks are defense-in-depth and do not replace OS isolation.

## Rollback

1. Stop workers and control-plane processes.
2. Preserve logs and the current database for incident analysis.
3. Restore the last verified database backup if schema/state rollback is required.
4. Deploy the previous application artifact.
5. Run readiness, integrity, security, and worker probes.
6. Resume only after the operator confirms the rollback state.
