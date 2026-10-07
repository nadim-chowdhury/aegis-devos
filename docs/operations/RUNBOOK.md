# Operations Runbook

## Preflight

1. Confirm a clean Git state when required by policy.
2. Run `aegis doctor -p <project>`.
3. Run `aegis health -p <project>` and `aegis security-check -p <project>`.
4. Confirm provider credentials exist only in the intended secret environment.
5. Review `.ai/CONSTRAINTS.md`, `.ai/SECURITY.md`, and current task/plan state.

## Normal operation

- `aegis factory -p <project> --goal "..."`
- `aegis factory-status -p <project>`
- `aegis observability-status -p <project>`
- `aegis worker-runtime-status -p <project>`

## Recovery

If a process exits unexpectedly, inspect status and events first. Resume only a persisted non-terminal factory run with `--resume`. Do not delete SQLite state or `.ai/FACTORY_RUN.json` to force progress.

If recovery budget is exhausted, treat the run as blocked/awaiting human action and inspect evidence before changing policy or budgets.

## Incident response

1. Stop production-impacting automation if required by incident policy.
2. Capture the current observability snapshot and logs.
3. Inspect incident, causal, verification and assurance evidence.
4. Identify blast radius and affected components.
5. Apply only approved remediation.
6. Re-run security/quality/verification and assurance checks.
7. Record the decision and outcome for learning.

## Rollback

Prefer Git checkpoints and application/database rollback procedures defined by the target project. Aegis must not invent a rollback path for a stateful production system.
