import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, loadTask } from './config.js';
import { quality } from './quality.js';
import { enforcePolicy } from './policy.js';
import { git } from './git.js';
import { openDb, recordEvent, saveVerificationBaseline, latestVerificationBaseline } from './db.js';
function hashProject(root, files) { return createHash('sha256').update(path.resolve(root) + '\n' + files.join('\n')).digest('hex'); }
export async function verifyMesh(project, taskId) {
    const root = path.resolve(project);
    const config = await loadConfig(root);
    const task = taskId ? await loadTask(root, taskId) : { id: 'verification-mesh', scope: {} };
    const names = Object.keys(config.quality?.gates || {});
    const q = await quality(root, config, names);
    const changed = (await git(root, ['diff', 'name-only', 'HEAD'])).split('\n').filter(Boolean);
    const status = (await git(root, ['status', '--porcelain'])).split('\n').filter(Boolean).map(x => x.slice(3)).filter(Boolean);
    const changedFiles = [...new Set([...changed, ...status])].sort();
    let securityOk = true;
    const regressions = [];
    try {
        await enforcePolicy(root, task, config);
    }
    catch (e) {
        securityOk = false;
        regressions.push(`policy: ${String(e)}`);
    }
    const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const projectHash = hashProject(root, changedFiles);
    const db = await openDb(root);
    try {
        const baseline = latestVerificationBaseline(db, projectHash);
        if (baseline) {
            const previous = JSON.parse(baseline.gate_results_json || '[]');
            for (const old of previous) {
                const current = q.results.find(x => x.name === old.name);
                if (old.ok && current && !current.ok)
                    regressions.push(`gate regression: ${old.name} previously passed and now fails`);
            }
            if (Number(baseline.security_ok) === 1 && !securityOk)
                regressions.push('security/policy regression: previous baseline passed');
        }
        const required = q.results.filter(x => x.required);
        const requiredPass = required.every(x => x.ok);
        const score = (required.length ? required.filter(x => x.ok).length / required.length : 1) * (securityOk ? 1 : 0);
        const verdict = !securityOk ? 'BLOCKED' : regressions.length ? 'REGRESSION' : requiredPass ? 'PASS' : 'REGRESSION';
        saveVerificationBaseline(db, { id: createHash('sha256').update(`${Date.now()}-${commit}-${projectHash}`).digest('hex'), projectHash, commitSha: commit, gateResults: q.results, securityOk });
        recordEvent(db, 'verification.mesh', { verdict, score, commit, changedFiles, regressions, securityOk }, task.id);
        return { verdict, score, commit, changedFiles, gates: q.results, regressions, securityOk, baselineUsed: baseline?.id, generatedAt: new Date().toISOString() };
    }
    finally {
        db.close();
    }
}
