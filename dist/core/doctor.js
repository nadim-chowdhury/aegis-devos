import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadConfig } from './config.js';
const exec = promisify(execFile);
export async function doctor(project) {
    const root = path.resolve(project);
    const checks = [];
    for (const [name, cmd, args] of [['node', 'node', ['--version']], ['git', 'git', ['--version']], ['agy', 'agy', ['--version']]]) {
        try {
            const r = await exec(cmd, args, { cwd: root });
            checks.push({ name, ok: true, version: r.stdout.trim() });
        }
        catch (e) {
            checks.push({ name, ok: false, error: e.message });
        }
    }
    try {
        const c = await loadConfig(root);
        checks.push({ name: 'config', ok: true, workers: c.workers.length });
    }
    catch (e) {
        checks.push({ name: 'config', ok: false, error: e.message });
    }
    console.table(checks);
    return checks.every(x => x.ok);
}
