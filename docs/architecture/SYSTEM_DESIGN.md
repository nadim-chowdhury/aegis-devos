# AEGIS DEVOS — Canonical System Design & Worker Prompt

## Universal Autonomous Software Engineering Operating System

> **This is the architectural north star and master worker prompt for the Aegis DevOS project.**
> It defines what Aegis should ultimately become — not what it currently implements.
> See the companion gap analysis for the honest mapping of current state vs. vision.

---

## Design Principle (Owner)

> **Do not design Aegis as a "quota bypasser." Design it as a policy-controlled
> autonomous engineering operating system with a provider/account pool.**

That distinction matters for reliability, security, and provider terms.

---

## System Architecture

```text
                    ┌─────────────────────────┐
                    │       HUMAN / OWNER      │
                    │ Goals • Budget • Policy  │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │       AEGIS CONTROL      │
                    │ Project Memory           │
                    │ World Model              │
                    │ Requirements             │
                    │ Architecture             │
                    │ Roadmap                  │
                    │ Policy / Risk            │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ PLANNING & ORCHESTRATION │
                    │ Milestones → Tasks → DAG │
                    │ Priority / Dependencies  │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ MODEL / WORKER ROUTER    │
                    │ Gemini • Claude • etc.   │
                    │ Capability • Cost        │
                    │ Health • Availability    │
                    └────────────┬────────────┘
                                 ↓
          ┌──────────────────────┼──────────────────────┐
          ↓                      ↓                      ↓
   React / Next.js          React Native             Flutter
   Electron                 Mobile                  Desktop
          └──────────────────────┼──────────────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ IMPLEMENTATION           │
                    │ Isolated workspace       │
                    │ Scoped permissions       │
                    │ Git checkpoint           │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ QUALITY PIPELINE         │
                    │ Unit / Integration / E2E │
                    │ Typecheck / Lint         │
                    │ Security                 │
                    │ Architecture Review      │
                    │ Performance              │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ VERIFICATION             │
                    │ Evidence • Regression    │
                    │ Acceptance Criteria      │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ DELIVERY / OPERATIONS    │
                    │ Release • Monitoring     │
                    │ Incidents • Recovery     │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │ LEARNING / WORLD MODEL   │
                    │ Outcome • Memory • Cost  │
                    │ Architecture evolution   │
                    └────────────┬────────────┘
                                 ↺
```

---

## Architectural Separation (Target)

### Aegis Control Plane

Responsible for:
- projects, requirements, roadmap
- memory, world model
- task DAG, routing, workers
- accounts/credentials, budgets, policy, scheduling
- evidence, verification, learning, observability

### Aegis Execution Plane

Responsible for:
- isolated workspaces, Git worktrees
- AI CLI execution
- tests, builds, linters, security tools
- emulators/simulators, packaging, deployment actions

---

## Provider Pool Model

```text
Provider Pool
    │
    ├── Provider A
    │    ├── Authorized Credential 1
    │    └── Authorized Credential 2
    │
    ├── Provider B
    │    ├── Authorized Credential 1
    │    └── Authorized Credential 2
    │
    └── Provider C
         └── Authorized Credential
```

Routing flow:

```text
Task
 ↓
Capability Router
 ↓
Availability Check
 ↓
Policy Check
 ↓
Best Authorized Worker
 ↓
Execute
 ↓
Provider response
 ├── success → continue
 ├── transient failure → bounded retry
 ├── unavailable → eligible worker
 ├── limit reached → pause/backoff or eligible worker
 └── policy restriction → STOP
```

---

## Long-Term Product Lifecycle

```text
YEAR 1: Product discovery → Architecture → MVP → Testing → Launch → SEO → Analytics → Monetization
YEAR 2: User feedback → Reliability → Growth → Performance → New platforms → Revenue optimization
YEAR 3+: Continuous maintenance → Feature evolution → Security → Growth experiments → Cost optimization
```

---

## Sections 1–50 (Master Worker Prompt)

> The full 50-section worker prompt is stored at:
> `.ai/AEGIS_SYSTEM_PROMPT.md`
>
> Every AI worker operating inside Aegis must receive the relevant subset of this prompt
> as part of its bounded task context.

---

## Key Constraints

1. **Human authority cannot be bypassed**
2. **Security policy outranks convenience**
3. **Evidence is more important than confidence**
4. **The repository and persistent state are more authoritative than any AI conversation**
5. **Never fabricate success**
6. **Quality outranks task-count**
7. **Do not design quota-evasion mechanisms**
