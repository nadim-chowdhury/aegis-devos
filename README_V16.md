# Aegis DevOS V1.6 — Adaptive Intelligence

V1.6 adds contextual learning to worker/model routing.

## Core idea

Routing no longer relies only on aggregate worker success. It backs off through increasingly broad evidence:

1. worker + model + role + task type + domain + risk
2. worker + role + task type
3. model + role + task type
4. configured reliability/quality/cost/capabilities
5. live health and failure cooldowns

Historical evidence is advisory and never bypasses policy, testing, security review, quality gates, or human approval.

## New contextual outcome fields

`task_outcomes` now records:
- task_type
- domain
- risk

Existing databases are migrated non-destructively when opened.

## Learning

`aegis learn` now creates context-level learning insights with sample-size confidence instead of treating every worker aggregate as equally reliable.
