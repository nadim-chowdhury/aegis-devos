import { randomUUID } from 'node:crypto';
import { git } from './git.js';
import { loadConfig, loadTask } from './config.js';
import { openDb, saveVerification } from './db.js';
function requiredEvidence(risk, gates) {
    const required = ['worker_execution', 'quality_gate', 'audit'];
    if (!gates.length)
        required.splice(1, 1);
    required.push('review');
    if (risk === 'high' || risk === 'critical')
        required.push('security_review');
    return [...new Set(required)];
}
function evidenceStatus(rows, kind) {
    return rows.some(r => r.kind === kind && r.status === 'pass');
}
export async function verifyTask(root, taskId, runId) {
    const task = await loadTask(root, taskId);
    const config = await loadConfig(root);
    const db = await openDb(root);
    try {
        const rows = db.prepare(`SELECT kind,status,payload_json,run_id FROM evidence WHERE task_id=? ${runId ? 'AND run_id=?' : ''} ORDER BY created_at DESC`).all(...(runId ? [taskId, runId] : [taskId]));
        const latestRun = runId ?? rows.find(r => r.run_id)?.run_id;
        const required = requiredEvidence(task.risk, task.quality_gates || []);
        const missing = required.filter(k => !evidenceStatus(rows, k));
        const q = rows.find(r => r.kind === 'quality_gate' && r.status === 'pass');
        let qualityRequired = 0, qualityPassed = 0;
        if (q) {
            try {
                const payload = JSON.parse(q.payload_json);
                const results = Array.isArray(payload.results) ? payload.results : [];
                for (const x of results) {
                    const gate = config.quality?.gates?.[x.name];
                    const requiredGate = gate?.required !== false;
                    if (requiredGate) {
                        qualityRequired++;
                        if (x.ok)
                            qualityPassed++;
                    }
                }
            }
            catch { }
        }
        const qualityScore = qualityRequired ? qualityPassed / qualityRequired : (task.quality_gates?.length ? 0 : 0.5);
        const evidenceScore = required.length ? required.filter(k => evidenceStatus(rows, k)).length / required.length : 0;
        const diff = await git(root, ['diff', '--stat', 'HEAD']);
        const status = await git(root, ['status', '--short']);
        const policyConfigured = !!(config.policy?.protected_paths?.length || config.policy?.forbidden_commands?.length || config.policy?.max_changed_files);
        const auditPass = evidenceStatus(rows, 'audit');
        let score = (evidenceScore * 0.55) + (qualityScore * 0.30) + ((auditPass ? 1 : 0) * 0.15);
        if (!policyConfigured)
            score -= 0.05;
        score = Math.max(0, Math.min(1, score));
        const critical = task.risk === 'critical';
        const threshold = critical ? 0.9 : task.risk === 'high' ? 0.82 : 0.72;
        const verdict = missing.length ? 'NEED_HUMAN' : score >= threshold ? 'PASS' : 'NEED_HUMAN';
        const confidence = Math.min(1, score + (missing.length ? 0 : 0.05));
        const result = { taskId, runId: latestRun, verdict, score: Number(score.toFixed(4)), confidence: Number(confidence.toFixed(4)), threshold, requiredEvidence: required, missingEvidence: missing, quality: { required: qualityRequired, passed: qualityPassed }, git: { diff, status }, policyConfigured, checkedAt: new Date().toISOString() };
        saveVerification(db, { id: `VERIFY-${Date.now()}-${randomUUID().slice(0, 8)}`, taskId, runId: latestRun, verdict, confidence, score, requiredEvidence: required, missingEvidence: missing });
        return result;
    }
    finally {
        db.close();
    }
}
