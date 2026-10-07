## 7.0.1 — Production Validation Stabilization

- Fixed 11 TypeScript compiler errors across 6 files (including factory resume ID scope and reliability history await bugs).
- Added executable permissions for tsc and tsx binaries.
- Introduced ProviderPool and CredentialAccount domain abstractions with exponential 429 quota backoff.
- Added Section 14 Context Manifest generation and Section 15 persistent AI Handoff state tracking.
- Scaffolds complete 12-document canonical specification suite on aegis init.
- Verified 6/6 chaos/reliability tests and sandbox production readiness with 29/29 acceptance checks passing.

# Changelog

## 7.0.0

- Final Aegis DevOS completion/release-gate milestone.
- Added deterministic V7.0 acceptance checks for architecture, safety boundaries, release artifacts, CLI surface, and documentation.
- Promoted the package and CLI version to 7.0.0.
- Consolidated the V6.x intelligence, control-plane, worker, security, observability, factory, reliability, and production-readiness layers as the core platform baseline.
- No new intelligence authority was introduced; existing policy, security, verification, human approval, leases, budgets, and recovery limits remain authoritative.
- Full dependency installation/build and deployment-environment checks remain environment-dependent and must be executed in a clean CI/deployment environment before production launch.
