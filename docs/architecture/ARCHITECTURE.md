# Aegis DevOS Architecture

## Purpose
Aegis DevOS is a bounded autonomous engineering control plane. It coordinates planning, task execution, verification, recovery, evidence, learning, and operations while preserving explicit authority boundaries.

## System layers

1. **Project state** — `.ai/` contains product requirements, architecture, constraints, tasks, state, decisions, runs, history and handoffs.
2. **Control plane** — configuration, SQLite state, locks, leases, event bus, idempotency, lifecycle and recovery orchestration.
3. **Intelligence fabric** — routing, planning, code graph, engineering memory, predictions, resource/capacity/scheduling, architecture, incidents, causal analysis, knowledge synthesis and world model.
4. **Execution plane** — worker/provider adapters and isolated execution contexts.
5. **Assurance plane** — policy, security, quality, review, verification, architecture governance and assurance.
6. **Operations plane** — health, readiness, metrics, structured logs, snapshots and reliability evidence.

## Authority model

Advisory intelligence may recommend an action, but it cannot override a hard gate. The effective authority order is:

`Human approval (when required) > Security/Policy > Verification/Quality > Transactional control-plane invariants > Advisory intelligence`

High/critical-risk actions remain human-gated. Production changes, destructive operations, secret changes and infrastructure actions require explicit deployment policy and human approval.

## Execution lifecycle

`GOAL → REQUIREMENTS → ARCHITECTURE → PLAN → DAG → READY → ROUTE → CLAIM → EXECUTE → TEST/REVIEW/SECURITY → VERIFY → INTEGRATE → ASSURE → DELIVER → MONITOR → INCIDENT/CAUSAL → RECOVER → LEARN`

Every transition is bounded by persisted state, budgets, leases, idempotency and evidence where applicable.

## Persistence

SQLite is the local control-plane system of record. Files under `.ai/` provide human-readable project state and durable artifacts. `.aegis/` contains machine operational state, configuration, logs, telemetry and reports.

## Concurrency

Task claims and worker leases are transactional. Parallel work uses isolated worktrees/sandboxes and serialized integration. A project lock prevents unsafe concurrent control-plane mutations.

## Failure model

Failures are classified and fingerprinted. Recovery is bounded by configured attempts/budgets. Exhausted recovery or unsafe risk transitions to `BLOCKED`, `FAILED`, or `AWAITING_HUMAN`; Aegis never converts uncertainty into silent success.
