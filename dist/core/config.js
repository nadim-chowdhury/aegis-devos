import path from 'node:path';
import YAML from 'yaml';
import { readText } from './fs.js';
export async function loadConfig(root) {
    const configPath = path.join(root, '.aegis/config.yaml');
    const raw = YAML.parse(await readText(configPath));
    if (!raw || typeof raw !== 'object')
        throw new Error(`Invalid Aegis config: ${configPath}`);
    raw.security = Object.assign({ require_isolated_worker: true, allowed_commands: [], denied_commands: ['rm', 'rmdir', 'del', 'format', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff'], max_output_chars: 2000000, deny_secret_env_to_command_workers: true }, raw.security || {});
    const defaults = raw.defaults || {};
    raw.defaults = Object.assign({ max_task_attempts: 3, require_clean_git: true, auto_commit: true, auto_merge: false, daemon_interval_seconds: 60, max_context_chars: 50000, run_timeout_ms: 900000, max_recovery_attempts: 2, heartbeat_interval_seconds: 15, resource_budget: 10, max_parallel_workers: 1 }, defaults);
    raw.workers = raw.workers || [];
    if (!Array.isArray(raw.workers))
        throw new Error('Invalid Aegis config: workers must be an array');
    const d = raw.defaults;
    const numeric = ['max_task_attempts', 'daemon_interval_seconds', 'run_timeout_ms', 'max_recovery_attempts', 'heartbeat_interval_seconds', 'resource_budget', 'max_parallel_workers'];
    for (const key of numeric) {
        if (!Number.isFinite(Number(d[key])) || Number(d[key]) <= 0)
            throw new Error(`Invalid Aegis config: defaults.${key} must be > 0`);
    }
    if (d.max_parallel_workers > 32)
        throw new Error('Invalid Aegis config: defaults.max_parallel_workers exceeds safety bound 32');
    if (!Array.isArray(raw.security.allowed_commands) || !Array.isArray(raw.security.denied_commands))
        throw new Error('Invalid Aegis config: security command lists must be arrays');
    if (!Number.isFinite(Number(raw.security.max_output_chars)) || Number(raw.security.max_output_chars) <= 0 || Number(raw.security.max_output_chars) > 10_000_000)
        throw new Error('Invalid Aegis config: security.max_output_chars must be 1..10000000');
    return raw;
}
export async function loadTask(root, id) {
    const file = path.join(root, '.ai/tasks', `${id}.yaml`);
    return YAML.parse(await readText(file));
}
export async function saveTask(root, task) {
    const { writeText, ensureDir } = await import('./fs.js');
    await ensureDir(path.join(root, '.ai/tasks'));
    await writeText(path.join(root, '.ai/tasks', `${task.id}.yaml`), YAML.stringify(task));
}
export async function listTasks(root) {
    const { readdir } = await import('node:fs/promises');
    const dir = path.join(root, '.ai/tasks');
    try {
        const files = await readdir(dir);
        const out = [];
        for (const f of files.filter(x => x.endsWith('.yaml'))) {
            try {
                out.push(YAML.parse(await readText(path.join(dir, f))));
            }
            catch { }
        }
        return out;
    }
    catch {
        return [];
    }
}
