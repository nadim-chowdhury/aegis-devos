# Aegis DevOS v6.5

V3.9 adds **Autonomous Codebase Intelligence**: a deterministic, persistent code graph for source files, symbols, imports/exports, and reverse dependency impact analysis.

## Commands

```bash
aegis code-index -p projects/my-saas
aegis code-graph -p projects/my-saas
aegis code-context TASK-001 -p projects/my-saas
aegis impact src/services/auth.ts -p projects/my-saas --depth 2
aegis impact src/services/auth.ts::AuthService -p projects/my-saas
```

The graph is advisory context. It does not override security policy, human approval, verification, protected paths, or recovery budgets.


## V4.0 — Autonomous Software Factory

V4.0 unifies Aegis execution into a durable, bounded factory run.

```bash
aegis factory -p projects/my-saas --goal "Ship the next approved product milestone"
aegis factory-status -p projects/my-saas
aegis factory-history -p projects/my-saas
```

Factory lifecycle:

`INTAKE → ANALYZING → PLANNING → READY → EXECUTING → INTEGRATING → VERIFYING → RECOVERING/LEARNING → COMPLETED/BLOCKED/FAILED/AWAITING_HUMAN`

Each factory run persists its goal, phase, task count, replans, recovery count, timestamps and bounded budgets in SQLite and `.ai/FACTORY_RUN.json`. The coordinator serializes integration by default and does not bypass task-level verification, policy, security or human-approval gates.

Default budgets: 20 tasks, 1 parallel worker, 2 recoveries, 3 collaboration rounds, 1 hour wall-clock, 1 replan. All can be overridden from the CLI.


## V4.1 — Factory Intelligence

Aegis now synthesizes deterministic engineering evidence into bounded factory recommendations. `aegis factory-intelligence -p <project>` combines task state, code-graph coverage, worker health, routing evidence, learning insights, verification outcomes, failure patterns, quality/security configuration, and portfolio context. Recommendations are advisory and cannot override immutable requirements, security policy, verification, recovery budgets, or human approval. Strategy planning persists the intelligence snapshot to `.ai/FACTORY_INTELLIGENCE.json`.

New command:
```bash
aegis factory-intelligence -p projects/my-saas
```


## V4.2 — Autonomous Replanning Intelligence

V4.2 closes the intelligence → decision → execution loop. Replanning now consumes Factory Intelligence, ranked recommendations, codebase/memory/failure evidence and bounded project context. It generates a minimal plan delta while preserving immutable requirements and existing safety gates.

CLI:
```bash
aegis replan -p projects/my-saas --trigger "verification regression observed"
aegis replan-status -p projects/my-saas
aegis approve-replan PLAN-... -p projects/my-saas
```

Approval revalidates the immutable requirements fingerprint against the current project before applying a proposal, preventing stale replans from mutating a changed project.


## V4.4 — Decision & Consensus Intelligence

V4.4 adds an independent, bounded consensus layer over multi-agent collaboration. The lead agent still produces a structured decision, but Aegis separately evaluates quorum, role diversity, supporting evidence, dissent, blockers, and confidence. Consensus is evidence, not authority, and existing policy, security, verification, and human-approval gates remain authoritative.

```bash
aegis consensus -p projects/my-saas --session SESSION-ID
aegis consensus-status -p projects/my-saas
aegis consensus-status -p projects/my-saas --session SESSION-ID
```

Recommendations: `ACCEPT`, `REVISE`, `BLOCK`, or `NEED_HUMAN`.

## V4.3 — Multi-Agent Collaboration Intelligence

V4.3 adds bounded, evidence-first multi-agent collaboration. Specialized roles exchange structured messages (`PROPOSAL`, `FINDING`, `QUESTION`, `OBJECTION`, `RECOMMENDATION`, `DECISION`, `EVIDENCE`, `BLOCKER`) and a lead agent synthesizes the discussion into an advisory decision. Sessions, messages, conflicts, evidence and decisions are persisted for auditability.

```bash
aegis collaborate -p projects/my-saas --task TASK-001
aegis collaborate -p projects/my-saas --task TASK-001 --max-rounds 3 --max-messages 12
aegis collaboration-status -p projects/my-saas
aegis collaboration-status -p projects/my-saas --session SESSION-ID
aegis collaboration-history -p projects/my-saas --task TASK-001
```

Collaboration is bounded by round/message budgets, uses the existing adaptive router, and never bypasses task, policy, security, human-approval, or verification gates. High/critical-risk `PROCEED` decisions are surfaced as `NEED_HUMAN`; the collaboration layer is advisory rather than an execution authority.

## V4.7 — Autonomous Resource & Cost Intelligence

V4.7 adds bounded resource forecasting for budget-aware execution. It estimates worker/model cost and latency from historical outcomes and routing evidence, records prediction provenance, and exposes advisory resource plans through:

```bash
aegis resource-plan TASK-001 -p projects/my-saas
aegis resource-recommendations -p projects/my-saas
aegis resource-history -p projects/my-saas
aegis resource-history -p projects/my-saas --task TASK-001
```

Resource intelligence is advisory. It cannot bypass policy, risk, security, verification, human approval, or other hard gates. Configure an optional project resource budget with `defaults.resource_budget` in `.aegis/config.yaml`; the default is 10 cost units.


## V4.8 — Autonomous Capacity & Scheduling Intelligence

V4.8 adds bounded capacity forecasting and queue-aware scheduling recommendations. It evaluates ready-task backlog, active runs, available workers, worker reliability/quality, historical duration, and role preferences to estimate queue wait and completion time. Predictions are persisted with confidence and provenance and emitted as `capacity.prediction` events.

CLI:

```bash
aegis capacity-plan -p projects/my-saas
aegis capacity-recommendations -p projects/my-saas
aegis capacity-history -p projects/my-saas
aegis capacity-history -p projects/my-saas --task TASK-001
```

Capacity intelligence is advisory. It does not change task state, claim work, bypass leases, override factory budgets, or weaken policy/security/verification/human-approval gates. Actual transactional task claims remain the concurrency authority.

## V6.2 — Production-grade Control Plane

V6.2 hardens the Aegis control plane around durable operations and safe process lifecycle behavior. The original V6.1 source archive was not present in the runtime, so this release preserves a recovery provenance note rather than claiming a lossless V6.1 diff. It adds:

- atomic project lock acquisition with stale-lock detection;
- configuration validation and safety bounds;
- health/readiness validation through the real config loader;
- operational schema/migration tracking;
- durable idempotency records and operation events;
- insert-first idempotency semantics for concurrent callers;
- bounded exponential retry scheduling and retry cleanup;
- retry/service state persistence;
- health/readiness reporting with DB, lock, config and disk checks;
- `aegis health` and `aegis operations-status` commands.

**Continuity note:** the V6.1 archive/source was not available in the current runtime, so this is explicitly a recovery build based on the available V4.8 source. It must not be treated as a lossless V6.1→V6.2 release until the actual V6.1 tree is restored and these changes are replayed onto it.

### Validation
- Static source inspection completed for the control-plane changes.
- Runtime/build validation is **not claimed**: dependencies are not installed in the runtime, and a previous dependency installation attempt timed out.
- Node.js v22.16.0 is available, but the CLI cannot start without `commander`/`yaml`.

### Safety boundary
V6.2 does not add unrestricted autonomous execution. Production-impacting actions, protected paths, security policy, human approval, verification, and recovery budgets remain authoritative.

## V6.3 — Real Worker & Model Integrations

V6.3 turns worker configuration into a real provider adapter boundary. Aegis can execute configured workers through:

- `antigravity` — existing `agy` headless worker integration, preserving streamed events/conversations.
- `openai` — direct HTTPS API integration using `OPENAI_API_KEY`.
- `anthropic` — direct HTTPS Messages API integration using `ANTHROPIC_API_KEY`.
- `gemini` — direct HTTPS Gemini API integration using `GEMINI_API_KEY`.
- `command` / `cli` — a user-supplied executable with `argsTemplate` placeholders `{prompt}`, `{model}`, and `{project}`.

Secrets are read only from environment variables and are never persisted into Aegis configuration or evidence. Network adapters use bounded request timeouts. Provider failures are classified into the existing quota/timeout/auth/unavailable/execution taxonomy so routing and recovery can learn from real outcomes.

Example workers:

```yaml
workers:
  - id: antigravity-claude
    provider: antigravity
    model: claude-opus-4.6
    capabilities: [architecture, security, code-review]

  - id: openai-coding
    provider: openai
    model: YOUR_MODEL
    capabilities: [backend, testing]

  - id: anthropic-review
    provider: anthropic
    model: YOUR_MODEL
    capabilities: [reviewer, security]

  - id: gemini-fast
    provider: gemini
    model: YOUR_MODEL
    capabilities: [frontend, documentation]

  - id: local-agent
    provider: command
    command: my-agent
    argsTemplate: ["--prompt", "{prompt}", "--model", "{model}"]
    capabilities: [testing]
```

Probe a configured integration:

```bash
aegis worker-test -p projects/my-saas --worker openai-coding
aegis workers -p projects/my-saas
```

Provider adapters are execution mechanisms, not authority. Existing policy, protected paths, verification, security review, human approval, leases, budgets, and recovery limits remain authoritative.

## V6.4 — Security & Sandbox Hardening

V6.4 adds a defense-in-depth security boundary before autonomous workers execute:

- security preflight for every run and worker selection;
- project-root realpath and symlink escape detection;
- command-worker allow/deny policy;
- shell-disabled execution remains mandatory;
- secret environment scrubbing for arbitrary command workers;
- bounded worker output configuration;
- unsafe absolute/traversal policy-path rejection;
- `aegis security-check` for operational inspection.

This is a **logical sandbox boundary**, not a claim of OS/container isolation. Antigravity and remote model APIs can still execute according to their own capabilities; production deployments should run Aegis workers inside OS/container/VM isolation with least-privilege credentials and network policy. Aegis does not silently bypass provider or operating-system controls.


## V6.5 — Observability & Operations

V6.5 adds a durable operational telemetry layer without introducing a new intelligence authority. It provides:

- structured JSON-lines operational logs at `.aegis/aegis.ndjson`;
- bounded log rotation with secret-field redaction;
- persistent metric samples with 14-day retention;
- operational snapshots combining health/readiness and control-plane counters;
- health-check and snapshot retention;
- CLI inspection for current operational state and recent logs.

Commands:

```bash
aegis observability -p projects/my-saas
aegis observability-status -p projects/my-saas
aegis logs -p projects/my-saas --limit 100
```

Observability is evidence only. Metrics, logs, and health snapshots cannot override policy, security, verification, human approval, leases, budgets, or recovery limits. Runtime telemetry is never fabricated; snapshots report the state actually visible to the control plane.


## V6.6 — End-to-End Autonomous Factory

V6.6 makes the existing Aegis intelligence, planning, worker, verification, recovery and operations layers operate as one durable factory loop. The factory can take a product goal, create an engineering plan when required, validate the task DAG, select eligible work, execute through real workers, run the existing quality/security/audit/verification gates, recover bounded failures, persist lifecycle state, and resume an interrupted non-terminal run.

The factory does not replace hard safety gates. Human approval, high/critical risk policy, security preflight, verification, protected paths, worker leases, retry/recovery budgets and Git safeguards remain authoritative.

### Factory lifecycle

`INTAKE → ANALYZING → PLANNING → READY → EXECUTING → VERIFYING → RECOVERING → LEARNING → COMPLETED`

Terminal states are `BLOCKED`, `FAILED`, and `AWAITING_HUMAN`.

Commands:

```bash
aegis factory -p projects/my-saas --goal "Build the requested product capability"
aegis factory-status -p projects/my-saas
aegis factory-history -p projects/my-saas
aegis factory -p projects/my-saas --resume
```

A resumed run uses the persisted `.ai/FACTORY_RUN.json` state and refuses to resume terminal runs. Final completion additionally records a task summary, learning result, and an operational snapshot when those subsystems are available.

### Validation

Source-level validation was performed. A full TypeScript build is not claimed unless dependencies are installed and `npm run build` completes successfully in a real project environment.

## V6.8 — Final Architecture & Documentation

V6.8 establishes the canonical architecture and operational documentation baseline before final production-readiness work. It does not introduce a new intelligence authority. Documentation covers system layers, authority boundaries, data flow, persistence/concurrency, failure model, threat model, secret boundaries, operational runbooks, CLI/configuration reference, ADRs and the V7.0 release-readiness checklist.

Documentation index: `docs/README.md`.

### V7.0 completion definition

Aegis DevOS is considered complete when the end-to-end factory can reliably execute approved low-risk engineering work from product goal through planning, implementation, verification, assurance, delivery, monitoring, incident/causal recovery and learning, with production-impacting and high-risk actions remaining explicitly human-gated. After that boundary, new capabilities are normal product evolution rather than required completion milestones.

## V6.9 — Production Readiness

V6.9 is the final production-hardening milestone before the V7.0 completion release. It adds a release readiness gate, SQLite backup/integrity verification/restore tooling, a production operations runbook, and explicit secret/isolation boundaries. No new intelligence authority is introduced.

CLI:

```bash
aegis production-readiness -p projects/my-saas
aegis db-backup -p projects/my-saas --output backups/aegis.db
aegis db-verify --file backups/aegis.db
aegis db-restore -p projects/my-saas --file backups/aegis.db
```

Aegis cannot prove OS/container/VM isolation from application code; production deployment must provide that boundary.
