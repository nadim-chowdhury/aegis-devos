# Configuration Reference

Configuration is read from `.aegis/config.yaml`. Keep credentials out of this file; use environment variables or an external secret manager.

Key areas:

- `defaults`: execution, retry, lease, timeout, budget and concurrency limits;
- `workers`: provider, model, capabilities and bounded worker settings;
- `routing`: role/model preferences;
- `policy`: protected paths, review requirements and change limits;
- `quality.gates`: optional project commands for typecheck/lint/test/build;
- `security`: provider/command restrictions and sandbox settings where configured.

Unknown or unsafe values should fail closed rather than silently broadening execution authority.
