import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { openDb } from './db.js';
import { activateRecovery } from './recovery.js';
import { analyzeFailure } from './failure-intelligence.js';
function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_stream(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,topic TEXT NOT NULL,type TEXT NOT NULL,task_id TEXT,run_id TEXT,producer TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_consumers(consumer_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_deliveries(consumer_id TEXT NOT NULL,sequence INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(consumer_id,sequence));
 CREATE TABLE IF NOT EXISTS control_actions(consumer_id TEXT NOT NULL,sequence INTEGER NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(consumer_id,sequence,action));`);
}
function payload(row) { try {
    return JSON.parse(row.payload_json);
}
catch {
    return { raw: row.payload_json };
} }
function emit(db, type, payloadValue, taskId, runId) {
    const exists = db.prepare('SELECT sequence FROM event_stream WHERE type=? AND task_id IS ? AND run_id IS ? AND payload_json=? LIMIT 1').get(type, taskId ?? null, runId ?? null, JSON.stringify(payloadValue));
    if (exists)
        return Number(exists.sequence);
    const now = new Date().toISOString();
    const id = randomUUID();
    const topic = type.split(':', 1)[0] || 'system';
    const r = db.prepare('INSERT INTO event_stream(event_id,topic,type,task_id,run_id,producer,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, topic, type, taskId ?? null, runId ?? null, 'control-plane', JSON.stringify(payloadValue), now);
    return Number(r.lastInsertRowid);
}
function action(db, consumerId, sequence, name) {
    const now = new Date().toISOString();
    const r = db.prepare('INSERT OR IGNORE INTO control_actions(consumer_id,sequence,action,created_at) VALUES(?,?,?,?)').run(consumerId, sequence, name, now);
    return Number(r.changes) > 0;
}
function handle(db, consumerId, row, root) {
    const p = payload(row);
    if (row.type === 'run.done') {
        if (row.run_id) {
            const now = new Date().toISOString();
            db.prepare("UPDATE recovery_requests SET status='resolved',updated_at=? WHERE run_id=? AND status='running'").run(now, row.run_id);
            db.prepare("UPDATE failure_fingerprints SET success_count=success_count+1,updated_at=? WHERE fingerprint IN (SELECT fingerprint FROM failure_occurrences WHERE run_id=?)").run(now, row.run_id);
        }
        if (action(db, consumerId, row.sequence, 'ready-dependents')) {
            const tasks = row.task_id ? db.prepare(`SELECT t.id FROM tasks t WHERE t.status='ready' AND EXISTS(SELECT 1 FROM json_each(t.depends_json) j WHERE j.value=?) AND NOT EXISTS(SELECT 1 FROM tasks d WHERE d.id IN (SELECT value FROM json_each(t.depends_json)) AND d.status!='done')`).all(row.task_id) : [];
            for (const t of tasks) {
                const readySequence = emit(db, 'TASK_READY', { reason: 'dependency-completed', sourceSequence: row.sequence, sourceRunId: row.run_id }, t.id, row.run_id);
                emit(db, 'WORKER_WAKE_REQUEST', { reason: 'task-ready', sourceSequence: readySequence, taskId: t.id }, t.id, row.run_id);
            }
        }
    }
    else if (row.type === 'run.failed') {
        if (action(db, consumerId, row.sequence, 'recovery-request')) {
            let task = undefined;
            if (row.task_id) {
                try {
                    task = YAML.parse(readFileSync(path.join(root, '.ai/tasks', `${row.task_id}.yaml`), 'utf8')) || {};
                }
                catch { }
            }
            const failure = analyzeFailure(db, { taskId: row.task_id ?? undefined, runId: row.run_id ?? undefined, reason: String(p?.reason || p?.error || 'run-failed'), errorType: p?.errorType, taskType: task?.type, domain: task?.domain, risk: task?.risk });
            const active = row.task_id ? db.prepare("SELECT id,attempts,max_attempts,status FROM recovery_requests WHERE task_id=? AND status='running' ORDER BY updated_at DESC LIMIT 1").get(row.task_id) : undefined;
            if (active && active.attempts < active.max_attempts) {
                const reason = `${failure.category}: ${failure.strategy}`;
                db.prepare("UPDATE recovery_requests SET status='scheduled',run_id=?,reason=?,updated_at=?,last_error=? WHERE id=?").run(row.run_id ?? null, reason, new Date().toISOString(), String(p?.reason || 'run-failed'), active.id);
                emit(db, 'RECOVERY_SCHEDULED', { requestId: active.id, sourceSequence: row.sequence, reason, strategy: failure.strategy, fingerprint: failure.fingerprint, retry: true }, row.task_id, row.run_id);
            }
            else if (active) {
                emit(db, 'HUMAN_ACTION_REQUIRED', { kind: 'recovery', reason: 'recovery budget exhausted', sourceSequence: row.sequence, attempts: active.attempts, maxAttempts: active.max_attempts, fingerprint: failure.fingerprint }, row.task_id, row.run_id);
            }
            else {
                emit(db, 'RECOVERY_REQUIRED', { reason: String(p?.reason || 'run-failed'), category: failure.category, strategy: failure.strategy, fingerprint: failure.fingerprint, historicalMatches: failure.historicalMatches, sourceSequence: row.sequence, runId: row.run_id }, row.task_id, row.run_id);
            }
        }
    }
    else if (row.type === 'RECOVERY_REQUIRED') {
        if (action(db, consumerId, row.sequence, 'recovery-schedule') && row.task_id) {
            const id = randomUUID();
            const now = new Date().toISOString();
            const existing = db.prepare("SELECT id FROM recovery_requests WHERE task_id=? AND status IN ('scheduled','running') LIMIT 1").get(row.task_id);
            if (!existing) {
                let task = {};
                let config = { defaults: { max_recovery_attempts: 2 }, policy: {} };
                try {
                    task = YAML.parse(readFileSync(path.join(root, '.ai/tasks', `${row.task_id}.yaml`), 'utf8')) || {};
                }
                catch { }
                try {
                    config = YAML.parse(readFileSync(path.join(root, '.aegis/config.yaml'), 'utf8')) || config;
                }
                catch { }
                const max = Math.max(0, Number(config?.defaults?.max_recovery_attempts ?? 2));
                const protectedRisk = ['high', 'critical'].includes(String(task.risk || ''));
                const requiresReview = (config?.policy?.require_review_for || []).includes(task.risk || 'low');
                const gated = protectedRisk || Boolean(task.human_approval) || requiresReview || max === 0;
                if (gated) {
                    emit(db, 'HUMAN_ACTION_REQUIRED', { kind: 'recovery', reason: protectedRisk || requiresReview || task.human_approval ? 'high-risk recovery requires human approval' : 'recovery budget disabled', sourceSequence: row.sequence }, row.task_id, row.run_id);
                }
                else {
                    db.prepare('INSERT INTO recovery_requests(id,task_id,run_id,reason,status,attempts,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, row.task_id, row.run_id ?? null, String(p?.reason || 'recovery-required'), 'scheduled', 0, max, now, now);
                    emit(db, 'RECOVERY_SCHEDULED', { requestId: id, sourceSequence: row.sequence, reason: String(p?.reason || 'recovery-required') }, row.task_id, row.run_id);
                }
            }
        }
    }
    else if (row.type === 'RECOVERY_SCHEDULED') {
        if (action(db, consumerId, row.sequence, 'recovery-activation'))
            emit(db, 'RECOVERY_ACTIVATION_REQUIRED', { requestId: String(p?.requestId || ''), sourceSequence: row.sequence }, row.task_id, row.run_id);
    }
    else if (row.type === 'verification.mesh' || row.type === 'verification.failed') {
        const verdict = String(p?.verdict || '');
        if (verdict && verdict !== 'PASS' && action(db, consumerId, row.sequence, 'verification-failed'))
            emit(db, 'VERIFICATION_FAILED', { verdict, sourceSequence: row.sequence }, row.task_id, row.run_id);
    }
    else if (row.type === 'APPROVAL_REQUESTED') {
        if (action(db, consumerId, row.sequence, 'approval-notice'))
            emit(db, 'HUMAN_ACTION_REQUIRED', { kind: 'approval', sourceSequence: row.sequence }, row.task_id, row.run_id);
    }
    else if (row.type === 'APPROVAL_APPROVED') {
        if (action(db, consumerId, row.sequence, 'approval-approved')) {
            const readySequence = emit(db, 'TASK_READY', { reason: 'human-approval-completed', sourceSequence: row.sequence }, row.task_id, row.run_id);
            emit(db, 'WORKER_WAKE_REQUEST', { reason: 'approval-completed', sourceSequence: readySequence, taskId: row.task_id }, row.task_id, row.run_id);
        }
    }
    else if (row.type === 'TASK_READY') {
        if (action(db, consumerId, row.sequence, 'worker-wake'))
            emit(db, 'WORKER_WAKE_REQUEST', { reason: 'task-ready', sourceSequence: row.sequence, taskId: row.task_id }, row.task_id, row.run_id);
    }
}
export async function controlLoopOnce(project, options = {}) {
    const root = path.resolve(project), consumerId = options.consumerId || 'control-plane', limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const db = await openDb(root);
    ensureSchema(db);
    const errors = [];
    try {
        const now = new Date().toISOString();
        const bootstrapReady = db.prepare(`SELECT t.id FROM tasks t WHERE t.status='ready' AND NOT EXISTS(SELECT 1 FROM tasks d WHERE d.id IN (SELECT value FROM json_each(t.depends_json)) AND d.status!='done')`).all();
        for (const t of bootstrapReady)
            emit(db, 'TASK_READY', { reason: 'control-plane-bootstrap', taskId: t.id }, t.id, null);
        db.prepare('INSERT INTO event_consumers(consumer_id,last_sequence,updated_at) VALUES(?,?,?) ON CONFLICT(consumer_id) DO NOTHING').run(consumerId, 0, now);
        const state = db.prepare('SELECT last_sequence FROM event_consumers WHERE consumer_id=?').get(consumerId);
        const rows = db.prepare('SELECT * FROM event_stream WHERE sequence>? ORDER BY sequence ASC LIMIT ?').all(Number(state.last_sequence), limit);
        let last = Number(state.last_sequence), processed = 0;
        for (const row of rows) {
            try {
                db.exec('BEGIN IMMEDIATE');
                handle(db, consumerId, row, root);
                const ts = new Date().toISOString();
                db.prepare(`INSERT INTO event_deliveries(consumer_id,sequence,status,attempts,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(consumer_id,sequence) DO UPDATE SET status=excluded.status,attempts=event_deliveries.attempts+1,updated_at=excluded.updated_at`).run(consumerId, row.sequence, 'acknowledged', 1, ts);
                db.prepare('UPDATE event_consumers SET last_sequence=?,updated_at=? WHERE consumer_id=?').run(row.sequence, ts, consumerId);
                db.exec('COMMIT');
                last = row.sequence;
                processed++;
                const activationRows = db.prepare("SELECT payload_json,sequence FROM event_stream WHERE type='RECOVERY_ACTIVATION_REQUIRED' AND sequence=?").all(row.sequence);
                for (const a of activationRows) {
                    try {
                        const ap = JSON.parse(a.payload_json);
                        if (ap.requestId)
                            await activateRecovery(project, String(ap.requestId));
                    }
                    catch (e) {
                        errors.push(`recovery activation: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            }
            catch (e) {
                try {
                    db.exec('ROLLBACK');
                }
                catch { }
                errors.push(`sequence ${row.sequence}: ${e instanceof Error ? e.message : String(e)}`);
                break;
            }
        }
        return { consumerId, processed, lastSequence: last, errors };
    }
    finally {
        db.close();
    }
}
export async function controlLoop(project, options = {}) {
    const pollMs = Math.max(250, options.pollMs ?? 1000);
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        do {
            const r = await controlLoopOnce(project, options);
            if (r.processed)
                console.log(`[Aegis] control-plane processed ${r.processed} event(s), cursor=${r.lastSequence}`);
            if (r.errors.length)
                console.error(`[Aegis] control-plane: ${r.errors.join('; ')}`);
            if (options.once || r.errors.length)
                break;
            if (!r.processed)
                await new Promise(res => setTimeout(res, pollMs));
        } while (!stopping);
    }
    finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
