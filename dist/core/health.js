import path from 'node:path';
import { ensureDir, readText, writeText } from './fs.js';
function file(root) { return path.join(root, '.aegis', 'worker-health.json'); }
export async function loadHealth(root) {
    try {
        return JSON.parse(await readText(file(root)));
    }
    catch {
        return {};
    }
}
export async function recordHealth(root, workerId, result) {
    const all = await loadHealth(root);
    const old = all[workerId] || { workerId, successes: 0, failures: 0, consecutiveFailures: 0 };
    if (result.success) {
        old.successes++;
        old.consecutiveFailures = 0;
        old.lastSuccess = new Date().toISOString();
        old.avgDurationMs = old.avgDurationMs ? Math.round((old.avgDurationMs + result.durationMs) / 2) : result.durationMs;
        delete old.cooldownUntil;
    }
    else {
        old.failures++;
        old.consecutiveFailures++;
        old.lastFailure = new Date().toISOString();
        if (result.errorType === 'quota') {
            const backoffSec = Math.min(3600, 60 * Math.pow(2, Math.min(old.consecutiveFailures - 1, 5)));
            old.cooldownUntil = new Date(Date.now() + backoffSec * 1000).toISOString();
        }
    }
    all[workerId] = old;
    await ensureDir(path.dirname(file(root)));
    await writeText(file(root), JSON.stringify(all, null, 2));
}
export function isCoolingDown(h) { return !!h?.cooldownUntil && new Date(h.cooldownUntil).getTime() > Date.now(); }
export async function cooldown(root, workerId, seconds) { const all = await loadHealth(root); const h = all[workerId] || { workerId, successes: 0, failures: 0, consecutiveFailures: 0 }; h.cooldownUntil = new Date(Date.now() + seconds * 1000).toISOString(); all[workerId] = h; await ensureDir(path.dirname(file(root))); await writeText(file(root), JSON.stringify(all, null, 2)); }
