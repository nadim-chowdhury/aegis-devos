import path from 'node:path';
import { lstat, realpath, readdir } from 'node:fs/promises';
const SECRET_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL)/i;
const DEFAULT_DENIED = ['rm', 'rmdir', 'del', 'format', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff'];
function under(root, candidate) {
    const r = path.resolve(root) + path.sep;
    const c = path.resolve(candidate);
    return c === path.resolve(root) || c.startsWith(r);
}
export async function securityPreflight(root, config, task, worker) {
    const checks = [];
    let rootReal = root;
    try {
        rootReal = await realpath(root);
        checks.push({ name: 'project-root', ok: true });
    }
    catch (e) {
        checks.push({ name: 'project-root', ok: false, detail: String(e) });
    }
    const protectedPaths = config.policy?.protected_paths || [];
    const forbidden = task.scope?.forbidden || [];
    const paths = [...protectedPaths, ...forbidden];
    let symlinkEscapes = 0;
    async function walk(dir, depth = 0) {
        if (depth > 8)
            return;
        let entries = [];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.aegis')
                continue;
            const p = path.join(dir, entry.name);
            try {
                const st = await lstat(p);
                if (st.isSymbolicLink()) {
                    const target = await realpath(p);
                    if (!under(rootReal, target))
                        symlinkEscapes++;
                }
                else if (st.isDirectory())
                    await walk(p, depth + 1);
            }
            catch { }
        }
    }
    await walk(rootReal);
    checks.push({ name: 'symlink-boundary', ok: symlinkEscapes === 0, detail: symlinkEscapes ? `${symlinkEscapes} symlink(s) escape project root` : undefined });
    const maxFiles = config.policy?.max_changed_files ?? 100;
    checks.push({ name: 'change-bound', ok: maxFiles > 0 && maxFiles <= 1000, detail: `max_changed_files=${maxFiles}` });
    if (worker?.provider === 'command' || worker?.provider === 'cli') {
        const command = worker.command || '';
        const base = path.basename(command);
        const denied = new Set([...(config.security?.denied_commands || []), ...DEFAULT_DENIED]);
        const allowed = config.security?.allowed_commands || [];
        const allowedOk = allowed.length === 0 || allowed.includes(base) || allowed.includes(command);
        checks.push({ name: 'worker-command-allowlist', ok: allowedOk && !denied.has(base), detail: allowedOk ? '' : 'command is not allowed' });
        checks.push({ name: 'shell-disabled', ok: true, detail: 'worker adapters use shell=false' });
    }
    else
        checks.push({ name: 'provider-boundary', ok: true, detail: `provider=${worker?.provider || 'unknown'}` });
    const suspicious = paths.filter(p => p.includes('..') || path.isAbsolute(p));
    checks.push({ name: 'path-policy', ok: suspicious.length === 0, detail: suspicious.length ? `unsafe policy paths: ${suspicious.join(', ')}` : undefined });
    return { ok: checks.every(x => x.ok), checks };
}
export function sanitizedWorkerEnv(extra = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(extra)) {
        if (!value)
            continue;
        // Never forward unrelated secret material to arbitrary command workers.
        if (SECRET_ENV.test(key) && !/^A?EGIS_|^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)$/.test(key))
            continue;
        env[key] = value;
    }
    return env;
}
export function securityConfigDefaults() {
    return {
        require_isolated_worker: true,
        allowed_commands: [],
        denied_commands: DEFAULT_DENIED,
        max_output_chars: 2_000_000,
        deny_secret_env_to_command_workers: true,
    };
}
