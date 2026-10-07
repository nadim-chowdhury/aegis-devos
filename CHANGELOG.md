## 7.0.1 — Production Validation Stabilization

- Corrected V7 acceptance self-scan false positive.
- Added explicit production-validation release metadata.
- Preserved V7.0 core scope; no new intelligence subsystem.

# Changelog

## 7.0.0

- Final Aegis DevOS completion/release-gate milestone.
- Added deterministic V7.0 acceptance checks for architecture, safety boundaries, release artifacts, CLI surface, and documentation.
- Promoted the package and CLI version to 7.0.0.
- Consolidated the V6.x intelligence, control-plane, worker, security, observability, factory, reliability, and production-readiness layers as the core platform baseline.
- No new intelligence authority was introduced; existing policy, security, verification, human approval, leases, budgets, and recovery limits remain authoritative.
- Full dependency installation/build and deployment-environment checks remain environment-dependent and must be executed in a clean CI/deployment environment before production launch.
