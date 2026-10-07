# V7.0 Acceptance Procedure

Run from the Aegis repository root:

```bash
npm ci
npm run build
npm run acceptance
```

Then, in a disposable project with approved worker credentials:

```bash
aegis doctor -p projects/smoke

aegis security-check -p projects/smoke

aegis reliability-test -p projects/smoke

aegis production-readiness -p projects/smoke

aegis factory -p projects/smoke --goal "Execute the approved smoke-test capability"
```

### Required evidence

1. Clean dependency installation.
2. TypeScript build with zero errors.
3. CLI smoke results.
4. Reliability report with `status: pass`.
5. Security preflight evidence.
6. Factory run evidence including verification and final state.
7. Backup/restore evidence.
8. Deployment isolation/network policy evidence.
9. No secrets in release artifacts.

### Safety

Do not point the acceptance factory run at production. Use a disposable repository and least-privilege credentials. Production-impacting actions remain human-gated by policy.
