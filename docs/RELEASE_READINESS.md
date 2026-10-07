# V7.0 Release Readiness & Completion Gate

V7.0 is the **core Aegis DevOS completion release**. Completion means the architecture and control model are feature-complete; production deployment still requires environment-specific CI, credentials, isolation, networking, and operational checks.

## Core acceptance

- [x] Product-goal → planning → DAG → execution → verification → learning lifecycle exists.
- [x] Persistent control plane, event delivery, leases, recovery, memory, code intelligence, world model and factory orchestration exist.
- [x] Real worker/provider adapter boundary exists.
- [x] Security preflight and bounded execution controls exist.
- [x] Observability and operational reporting exist.
- [x] Reliability suite exists.
- [x] Production readiness and backup/restore tooling exists.
- [x] V7.0 deterministic acceptance script exists (`npm run acceptance`).

## Environment-dependent release gate

These cannot honestly be marked PASS from the source archive alone:

- [ ] Clean `npm ci` succeeds in CI.
- [ ] `npm run build` succeeds in CI.
- [ ] CLI smoke suite succeeds in CI.
- [ ] Reliability suite passes against a disposable project.
- [ ] Representative end-to-end factory run completes with configured real worker credentials.
- [ ] Provider credentials are provisioned externally.
- [ ] OS/container/VM worker isolation is enforced by deployment infrastructure.
- [ ] Network egress policy is enforced by deployment infrastructure.
- [ ] Backup/restore is exercised in the deployment environment.
- [ ] Monitoring, alerting, on-call ownership and incident procedures are configured.

## Completion boundary

If the environment-dependent checks above pass in CI/staging, Aegis DevOS is production-ready for the deployment's defined scope. If they do not, the release is a **V7.0 core-complete build**, not a claim of universal production readiness.

Future work should be ordinary product evolution, security maintenance, compatibility work, and provider/worker improvements—not an endless sequence of artificial intelligence milestones.
