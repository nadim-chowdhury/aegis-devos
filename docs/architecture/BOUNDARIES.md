# Architecture Boundaries

| Boundary | Responsibility | Must not do |
|---|---|---|
| Planner | Translate goals into requirements/plans/tasks | Execute code or bypass immutable requirements |
| Router | Select eligible worker/model | Override security, policy or human gates |
| Worker adapter | Invoke an approved execution provider | Persist secrets or self-authorize privileged actions |
| Control plane | Own state, claims, events, retries and lifecycle | Treat advisory predictions as authority |
| Security | Validate execution safety | Approve unsafe production changes by itself |
| Verification | Establish evidence of correctness | Declare success without required evidence |
| Governance | Detect architecture/policy drift | Rewrite architecture silently |
| Operations | Observe actual runtime/control-plane state | Fabricate telemetry or suppress failures |
| Learning | Record outcome-derived improvements | Modify hard safety policy autonomously |
