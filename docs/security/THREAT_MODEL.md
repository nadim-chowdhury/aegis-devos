# Threat Model

## Assets

- source code and intellectual property;
- credentials and API keys;
- project requirements and private documents;
- database and deployment configuration;
- Git history and release artifacts;
- control-plane integrity and audit evidence.

## Threats

- prompt injection causing unauthorized changes;
- path traversal/symlink escape;
- command injection through worker arguments;
- secret leakage into logs/evidence;
- replay/double execution;
- stale worker leases and concurrent mutation;
- malicious or faulty dependency changes;
- false verification or fabricated telemetry;
- unbounded recovery/resource consumption;
- unsafe production deployment.

## Controls

Security preflight, protected paths, shell-disabled command execution, environment scrubbing, project-root validation, transactional claims, idempotency, bounded retries/budgets, independent verification, observability redaction, human approval and isolated execution.

## Residual risk

Logical controls are not equivalent to an OS sandbox. Production deployments must add container/VM isolation, least-privilege identities, network egress policy, filesystem restrictions, secret-manager controls and CI/CD protections appropriate to the environment.
