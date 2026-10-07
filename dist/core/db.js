import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir } from './fs.js';
export async function openDb(root) {
    await ensureDir(path.join(root, '.aegis'));
    const db = new DatabaseSync(path.join(root, '.aegis', 'aegis.db'));
    db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,status TEXT NOT NULL,priority REAL NOT NULL DEFAULT 0,title TEXT NOT NULL,depends_json TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,status TEXT NOT NULL,worker_id TEXT,model TEXT,started_at TEXT NOT NULL,finished_at TEXT,attempt INTEGER NOT NULL DEFAULT 0,conversation_id TEXT,heartbeat_at TEXT);
    CREATE TABLE IF NOT EXISTS worker_events(id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id TEXT NOT NULL,event TEXT NOT NULL,success INTEGER NOT NULL DEFAULT 0,error_type TEXT,duration_ms INTEGER,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,task_id TEXT,run_id TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approvals(task_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,status TEXT NOT NULL,requested_at TEXT NOT NULL,approved_at TEXT);
    CREATE TABLE IF NOT EXISTS worker_scores(worker_id TEXT PRIMARY KEY,successes INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,avg_duration_ms REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(task_id TEXT PRIMARY KEY,worker_id TEXT NOT NULL,model TEXT NOT NULL,conversation_id TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints(run_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,phase TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,payload_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,run_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_outcomes(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,run_id TEXT NOT NULL,role TEXT,worker_id TEXT,model TEXT,status TEXT NOT NULL,duration_ms INTEGER,attempt INTEGER NOT NULL,task_type TEXT,domain TEXT,risk TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS learning_insights(id TEXT PRIMARY KEY,scope TEXT NOT NULL,key TEXT NOT NULL,sample_size INTEGER NOT NULL,success_rate REAL NOT NULL,avg_duration_ms REAL NOT NULL,recommendation TEXT NOT NULL,confidence REAL NOT NULL,generated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verification_evaluations(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,run_id TEXT,verdict TEXT NOT NULL,confidence REAL NOT NULL,score REAL NOT NULL,required_evidence_json TEXT NOT NULL,missing_evidence_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verification_baselines(id TEXT PRIMARY KEY,project_hash TEXT NOT NULL,commit_sha TEXT,gate_results_json TEXT NOT NULL,security_ok INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plan_proposals(id TEXT PRIMARY KEY,trigger TEXT NOT NULL,rationale TEXT NOT NULL,requirements_fingerprint TEXT NOT NULL,delta_json TEXT NOT NULL,validation_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS routing_decisions(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,role TEXT NOT NULL,worker_id TEXT NOT NULL,score REAL NOT NULL,confidence REAL NOT NULL,exploration REAL NOT NULL,estimated_cost REAL NOT NULL,estimated_latency_ms REAL NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_leases(worker_id TEXT PRIMARY KEY,pid INTEGER NOT NULL,host TEXT NOT NULL,status TEXT NOT NULL,lease_until TEXT NOT NULL,heartbeat_at TEXT NOT NULL,current_task_id TEXT,started_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_claims(task_id TEXT PRIMARY KEY,worker_id TEXT NOT NULL,lease_until TEXT NOT NULL,claimed_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_stream(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,topic TEXT NOT NULL,type TEXT NOT NULL,task_id TEXT,run_id TEXT,producer TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_event_stream_type_sequence ON event_stream(type,sequence);
    CREATE INDEX IF NOT EXISTS idx_event_stream_task_sequence ON event_stream(task_id,sequence);
    CREATE INDEX IF NOT EXISTS idx_event_stream_run_sequence ON event_stream(run_id,sequence);
    CREATE TABLE IF NOT EXISTS event_consumers(consumer_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_deliveries(consumer_id TEXT NOT NULL,sequence INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(consumer_id,sequence));
    CREATE TABLE IF NOT EXISTS control_actions(consumer_id TEXT NOT NULL,sequence INTEGER NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(consumer_id,sequence,action));
    CREATE TABLE IF NOT EXISTS recovery_requests(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,run_id TEXT,reason TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);
    CREATE TABLE IF NOT EXISTS failure_fingerprints(fingerprint TEXT PRIMARY KEY,category TEXT NOT NULL,task_type TEXT,domain TEXT,risk TEXT,sample_count INTEGER NOT NULL DEFAULT 0,success_count INTEGER NOT NULL DEFAULT 0,last_reason TEXT,last_strategy TEXT,last_run_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS failure_occurrences(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,task_id TEXT,run_id TEXT,category TEXT NOT NULL,reason TEXT NOT NULL,strategy TEXT NOT NULL,matched_samples INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_failure_occurrences_fingerprint ON failure_occurrences(fingerprint,created_at);
    CREATE TABLE IF NOT EXISTS engineering_memory(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,task_id TEXT,run_id TEXT,fingerprint TEXT,source TEXT NOT NULL,confidence REAL NOT NULL DEFAULT 0.5,commit_sha TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS code_files(path TEXT PRIMARY KEY,language TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,indexed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS code_symbols(id TEXT PRIMARY KEY,file_path TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,line INTEGER NOT NULL,exported INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(name);
    CREATE INDEX IF NOT EXISTS idx_code_symbols_file ON code_symbols(file_path);
    CREATE TABLE IF NOT EXISTS code_edges(from_file TEXT NOT NULL,to_file TEXT NOT NULL,kind TEXT NOT NULL,specifier TEXT NOT NULL,PRIMARY KEY(from_file,to_file,kind,specifier));
    CREATE TABLE IF NOT EXISTS factory_runs(id TEXT PRIMARY KEY,goal TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,tasks_executed INTEGER NOT NULL DEFAULT 0,parallel_workers INTEGER NOT NULL DEFAULT 1,replans INTEGER NOT NULL DEFAULT 0,max_tasks INTEGER NOT NULL,max_parallel_workers INTEGER NOT NULL,max_recovery_attempts INTEGER NOT NULL,max_collaboration_rounds INTEGER NOT NULL,max_wall_clock_ms INTEGER NOT NULL,max_replans INTEGER NOT NULL,started_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,last_error TEXT);
    CREATE TABLE IF NOT EXISTS collaboration_sessions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,status TEXT NOT NULL,objective TEXT NOT NULL,max_rounds INTEGER NOT NULL,max_messages INTEGER NOT NULL,current_round INTEGER NOT NULL DEFAULT 0,lead_role TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,finished_at TEXT,last_error TEXT);
    CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_task_status ON collaboration_sessions(task_id,status,updated_at);
    CREATE TABLE IF NOT EXISTS collaboration_messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,round INTEGER NOT NULL,sequence INTEGER NOT NULL,agent_role TEXT NOT NULL,worker_id TEXT,model TEXT,kind TEXT NOT NULL,content TEXT NOT NULL,in_reply_to TEXT,confidence REAL,created_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES collaboration_sessions(id));
    CREATE INDEX IF NOT EXISTS idx_collaboration_messages_session_seq ON collaboration_messages(session_id,sequence);
    CREATE INDEX IF NOT EXISTS idx_collaboration_messages_kind ON collaboration_messages(session_id,kind);
    CREATE TABLE IF NOT EXISTS collaboration_decisions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,decision TEXT NOT NULL,status TEXT NOT NULL,rationale TEXT NOT NULL,conflicts_json TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES collaboration_sessions(id));
    CREATE INDEX IF NOT EXISTS idx_collaboration_decisions_session ON collaboration_decisions(session_id,created_at);
    CREATE TABLE IF NOT EXISTS resource_predictions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,recommended_worker_id TEXT,recommended_model TEXT,budget REAL NOT NULL,estimated_cost REAL,estimated_latency_ms REAL,confidence REAL NOT NULL,sample_size INTEGER NOT NULL,forecast_json TEXT NOT NULL,recommendation TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_resource_predictions_task_created ON resource_predictions(task_id,created_at);
    CREATE TABLE IF NOT EXISTS consensus_evaluations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,decision TEXT NOT NULL,level TEXT NOT NULL,score REAL NOT NULL,quorum INTEGER NOT NULL,unique_roles INTEGER NOT NULL,message_count INTEGER NOT NULL,support_count INTEGER NOT NULL,dissent_count INTEGER NOT NULL,blocker_count INTEGER NOT NULL,evidence_count INTEGER NOT NULL,confidence REAL NOT NULL,unresolved_json TEXT NOT NULL,recommendation TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES collaboration_sessions(id));
    CREATE INDEX IF NOT EXISTS idx_consensus_session_created ON consensus_evaluations(session_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_code_edges_to ON code_edges(to_file);
    CREATE INDEX IF NOT EXISTS idx_code_edges_from ON code_edges(from_file);
    CREATE INDEX IF NOT EXISTS idx_engineering_memory_kind ON engineering_memory(kind,updated_at);
    CREATE INDEX IF NOT EXISTS idx_engineering_memory_task ON engineering_memory(task_id,updated_at);
    CREATE INDEX IF NOT EXISTS idx_engineering_memory_fingerprint ON engineering_memory(fingerprint,updated_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_requests_task_status ON recovery_requests(task_id,status);
    CREATE TABLE IF NOT EXISTS capacity_predictions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,ready_rank INTEGER NOT NULL,worker_id TEXT,recommended_model TEXT,queue_depth INTEGER NOT NULL,ready_tasks INTEGER NOT NULL,active_runs INTEGER NOT NULL,available_workers INTEGER NOT NULL,estimated_wait_ms INTEGER NOT NULL,estimated_completion_ms INTEGER NOT NULL,capacity_score REAL NOT NULL,confidence REAL NOT NULL,sample_size INTEGER NOT NULL,reason TEXT NOT NULL,forecast_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_capacity_predictions_task_created ON capacity_predictions(task_id,created_at);
    CREATE TABLE IF NOT EXISTS capacity_outcomes(id TEXT PRIMARY KEY,prediction_id TEXT NOT NULL,task_id TEXT NOT NULL,wait_ms INTEGER,completion_ms INTEGER,worker_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_capacity_outcomes_task_created ON capacity_outcomes(task_id,created_at);
  `);
    for (const column of ['task_type', 'domain', 'risk']) {
        try {
            db.exec(`ALTER TABLE task_outcomes ADD COLUMN ${column} TEXT`);
        }
        catch { }
    }
    return db;
}
export function syncTask(db, t) { db.prepare(`INSERT INTO tasks(id,status,priority,title,depends_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,priority=excluded.priority,title=excluded.title,depends_json=excluded.depends_json,updated_at=excluded.updated_at`).run(t.id, t.status, t.priority, t.title, JSON.stringify(t.dependsOn), new Date().toISOString()); }
export function recordEvent(db, type, payload, taskId, runId, producer = 'aegis') {
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO events(type,task_id,run_id,payload_json,created_at) VALUES(?,?,?,?,?)`).run(type, taskId ?? null, runId ?? null, JSON.stringify(payload), createdAt);
    db.prepare(`INSERT INTO event_stream(event_id,topic,type,task_id,run_id,producer,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), type.split(':', 1)[0] || 'system', type, taskId ?? null, runId ?? null, producer, JSON.stringify(payload ?? {}), createdAt);
}
export function recordWorkerEvent(db, workerId, event, result) { const now = new Date().toISOString(); db.prepare(`INSERT INTO worker_events(worker_id,event,success,error_type,duration_ms,created_at) VALUES(?,?,?,?,?,?)`).run(workerId, event, result.success ? 1 : 0, result.errorType ?? null, result.durationMs ?? null, now); if (event === 'success' || event === 'failure')
    db.prepare(`INSERT INTO worker_scores(worker_id,successes,failures,avg_duration_ms,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET successes=worker_scores.successes+excluded.successes,failures=worker_scores.failures+excluded.failures,avg_duration_ms=CASE WHEN excluded.avg_duration_ms>0 AND worker_scores.avg_duration_ms>0 THEN (worker_scores.avg_duration_ms+excluded.avg_duration_ms)/2 ELSE MAX(worker_scores.avg_duration_ms,excluded.avg_duration_ms) END,updated_at=excluded.updated_at`).run(workerId, result.success ? 1 : 0, result.success ? 0 : 1, result.durationMs ?? 0, now); }
export function heartbeat(db, runId) { db.prepare(`UPDATE runs SET heartbeat_at=? WHERE id=?`).run(new Date().toISOString(), runId); }
export function registerRun(db, run) { const now = new Date().toISOString(); db.prepare(`INSERT OR REPLACE INTO runs(id,task_id,status,worker_id,model,started_at,attempt,conversation_id,heartbeat_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(run.id, run.taskId, 'running', run.workerId ?? null, run.model ?? null, now, run.attempt, run.conversationId ?? null, now); }
export function finishRun(db, id, status) { const now = new Date().toISOString(); db.prepare(`UPDATE runs SET status=?,finished_at=?,heartbeat_at=? WHERE id=?`).run(status, now, now, id); }
export function requestApproval(db, taskId, runId) { const now = new Date().toISOString(); db.prepare(`INSERT OR REPLACE INTO approvals(task_id,run_id,status,requested_at) VALUES(?,?,?,?)`).run(taskId, runId, 'pending', now); recordEvent(db, 'APPROVAL_REQUESTED', { taskId, runId }, taskId, runId); }
export function approve(db, taskId) { const now = new Date().toISOString(); const row = db.prepare('SELECT run_id FROM approvals WHERE task_id=?').get(taskId); db.prepare(`UPDATE approvals SET status='approved',approved_at=? WHERE task_id=?`).run(now, taskId); recordEvent(db, 'APPROVAL_APPROVED', { taskId, runId: row?.run_id }, taskId, row?.run_id); }
export function recoverStaleRuns(db, staleMs) { const cutoff = new Date(Date.now() - staleMs).toISOString(); const rows = db.prepare(`SELECT id,task_id FROM runs WHERE status='running' AND heartbeat_at < ?`).all(cutoff); for (const r of rows) {
    db.prepare(`UPDATE runs SET status='stale',finished_at=? WHERE id=?`).run(new Date().toISOString(), r.id);
    recordEvent(db, 'run.stale', { runId: r.id }, r.task_id, r.id);
} return rows; }
export function recoveryRequestSummary(db, taskId) {
    return taskId ? db.prepare('SELECT * FROM recovery_requests WHERE task_id=? ORDER BY created_at DESC').all(taskId) : db.prepare('SELECT * FROM recovery_requests ORDER BY updated_at DESC').all();
}
export function scheduleRecovery(db, r) {
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT * FROM recovery_requests WHERE task_id=? AND status IN ('scheduled','running') ORDER BY created_at DESC LIMIT 1").get(r.taskId);
    if (existing)
        return { created: false, request: existing };
    db.prepare('INSERT INTO recovery_requests(id,task_id,run_id,reason,status,attempts,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(r.id, r.taskId, r.runId ?? null, r.reason, 'scheduled', 0, r.maxAttempts, now, now);
    return { created: true, request: { id: r.id, task_id: r.taskId, run_id: r.runId ?? null, reason: r.reason, status: 'scheduled', attempts: 0, max_attempts: r.maxAttempts, created_at: now, updated_at: now } };
}
export function startRecovery(db, id) {
    const now = new Date().toISOString();
    const r = db.prepare("UPDATE recovery_requests SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='scheduled' AND attempts < max_attempts").run(now, id);
    return Number(r.changes) === 1;
}
export function completeRecovery(db, id, status, error) {
    db.prepare('UPDATE recovery_requests SET status=?,updated_at=?,last_error=? WHERE id=?').run(status, new Date().toISOString(), error ?? null, id);
}
export function dbSummary(db) { const one = (sql) => Number(db.prepare(sql).get().n || 0); return { tasks: one('SELECT COUNT(*) n FROM tasks'), running: one("SELECT COUNT(*) n FROM runs WHERE status='running'"), stale: one("SELECT COUNT(*) n FROM runs WHERE status='stale'"), pendingApprovals: one("SELECT COUNT(*) n FROM approvals WHERE status='pending'"), events: one('SELECT COUNT(*) n FROM events'), evidence: one('SELECT COUNT(*) n FROM evidence') }; }
export function saveConversation(db, taskId, workerId, model, conversationId) { db.prepare(`INSERT INTO conversations(task_id,worker_id,model,conversation_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET worker_id=excluded.worker_id,model=excluded.model,conversation_id=excluded.conversation_id,updated_at=excluded.updated_at`).run(taskId, workerId, model, conversationId, new Date().toISOString()); }
export function getConversation(db, taskId) { return db.prepare(`SELECT task_id,worker_id,model,conversation_id,updated_at FROM conversations WHERE task_id=?`).get(taskId); }
export function workerScoreSummary(db) { return db.prepare(`SELECT worker_id,successes,failures,avg_duration_ms,updated_at FROM worker_scores ORDER BY worker_id`).all(); }
export function saveCheckpoint(db, runId, taskId, phase, attempt, payload = {}) { db.prepare(`INSERT INTO checkpoints(run_id,task_id,phase,attempt,payload_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET phase=excluded.phase,attempt=excluded.attempt,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).run(runId, taskId, phase, attempt, JSON.stringify(payload), new Date().toISOString()); }
export function addEvidence(db, e) { db.prepare(`INSERT OR REPLACE INTO evidence(id,task_id,run_id,kind,status,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`).run(e.id, e.taskId, e.runId ?? null, e.kind, e.status, JSON.stringify(e.payload), new Date().toISOString()); }
export function recordOutcome(db, o) { db.prepare(`INSERT INTO task_outcomes(task_id,run_id,role,worker_id,model,status,duration_ms,attempt,task_type,domain,risk,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.taskId, o.runId, o.role ?? null, o.workerId ?? null, o.model ?? null, o.status, o.durationMs ?? null, o.attempt, o.taskType ?? null, o.domain ?? null, o.risk ?? null, new Date().toISOString()); }
export function taskEvidence(db, taskId) { return db.prepare(`SELECT * FROM evidence WHERE task_id=? ORDER BY id DESC`).all(taskId); }
export function saveMemory(db, m) {
    const now = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO engineering_memory(id,kind,title,content,task_id,run_id,fingerprint,source,confidence,commit_sha,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT created_at FROM engineering_memory WHERE id=?),?),?)`).run(m.id, m.kind, m.title, m.content, m.taskId ?? null, m.runId ?? null, m.fingerprint ?? null, m.source, m.confidence ?? 0.5, m.commitSha ?? null, m.id, now, now);
}
export function memorySearch(db, query, limit = 20) {
    const n = Math.max(1, Math.min(limit, 100));
    const q = query.toLowerCase().trim();
    if (!q)
        return db.prepare(`SELECT * FROM engineering_memory ORDER BY confidence DESC,updated_at DESC LIMIT ?`).all(n);
    const like = `%${q}%`;
    return db.prepare(`SELECT * FROM engineering_memory WHERE lower(title) LIKE ? OR lower(content) LIKE ? OR lower(kind) LIKE ? OR lower(source) LIKE ? ORDER BY confidence DESC,updated_at DESC LIMIT ?`).all(like, like, like, like, n);
}
export function memoryForTask(db, taskId, limit = 20) { return db.prepare(`SELECT * FROM engineering_memory WHERE task_id=? ORDER BY confidence DESC,updated_at DESC LIMIT ?`).all(taskId, Math.max(1, Math.min(limit, 100))); }
export function memoryForFailure(db, fingerprint, limit = 20) { return db.prepare(`SELECT * FROM engineering_memory WHERE fingerprint=? ORDER BY confidence DESC,updated_at DESC LIMIT ?`).all(fingerprint, Math.max(1, Math.min(limit, 100))); }
export function saveLearningInsights(db, insights) { const stmt = db.prepare(`INSERT OR REPLACE INTO learning_insights(id,scope,key,sample_size,success_rate,avg_duration_ms,recommendation,confidence,generated_at) VALUES(?,?,?,?,?,?,?,?,?)`); for (const i of insights)
    stmt.run(i.id, i.scope, i.key, i.sample_size, i.success_rate, i.avg_duration_ms, i.recommendation, i.confidence, i.generated_at); }
export function learningSummary(db) { return db.prepare(`SELECT * FROM learning_insights ORDER BY confidence DESC, success_rate DESC`).all(); }
export function routingSummary(db, limit = 50) { return db.prepare(`SELECT * FROM routing_decisions ORDER BY id DESC LIMIT ?`).all(limit); }
export function saveVerification(db, v) { db.prepare(`INSERT OR REPLACE INTO verification_evaluations(id,task_id,run_id,verdict,confidence,score,required_evidence_json,missing_evidence_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(v.id, v.taskId, v.runId ?? null, v.verdict, v.confidence, v.score, JSON.stringify(v.requiredEvidence), JSON.stringify(v.missingEvidence), new Date().toISOString()); }
export function latestVerification(db, taskId) { return db.prepare(`SELECT * FROM verification_evaluations WHERE task_id=? ORDER BY created_at DESC LIMIT 1`).get(); }
export function saveVerificationBaseline(db, b) { db.prepare(`INSERT INTO verification_baselines(id,project_hash,commit_sha,gate_results_json,security_ok,created_at) VALUES(?,?,?,?,?,?)`).run(b.id, b.projectHash, b.commitSha ?? null, JSON.stringify(b.gateResults), b.securityOk ? 1 : 0, new Date().toISOString()); }
export function latestVerificationBaseline(db, projectHash) { return db.prepare(`SELECT * FROM verification_baselines WHERE project_hash=? ORDER BY created_at DESC LIMIT 1`).get(projectHash); }
export function savePlanProposal(db, p) { db.prepare(`INSERT OR REPLACE INTO plan_proposals(id,trigger,rationale,requirements_fingerprint,delta_json,validation_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(p.id, p.trigger, p.rationale, p.immutableRequirementsFingerprint, JSON.stringify(p.delta), JSON.stringify(p.validation), p.status, p.generatedAt); }
export function acquireWorkerLease(db, workerId, pid, host, leaseMs) {
    const now = new Date();
    const nowIso = now.toISOString();
    const until = new Date(now.getTime() + leaseMs).toISOString();
    const existing = db.prepare(`SELECT worker_id,status,lease_until FROM worker_leases WHERE worker_id=?`).get(workerId);
    if (existing && existing.status === 'running' && new Date(existing.lease_until).getTime() > now.getTime())
        throw new Error(`Worker lease is already active: ${workerId}`);
    recordEvent(db, 'WORKER_LEASE_ACQUIRED', { workerId, pid, host, leaseUntil: until });
    db.prepare(`INSERT INTO worker_leases(worker_id,pid,host,status,lease_until,heartbeat_at,current_task_id,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET pid=excluded.pid,host=excluded.host,status=excluded.status,lease_until=excluded.lease_until,heartbeat_at=excluded.heartbeat_at,current_task_id=NULL,started_at=excluded.started_at,updated_at=excluded.updated_at`).run(workerId, pid, host, 'running', until, nowIso, null, nowIso, nowIso);
    return until;
}
export function heartbeatWorkerLease(db, workerId, leaseMs) {
    const now = new Date();
    const nowIso = now.toISOString();
    const until = new Date(now.getTime() + leaseMs).toISOString();
    const r = db.prepare(`UPDATE worker_leases SET heartbeat_at=?,lease_until=?,updated_at=? WHERE worker_id=? AND status='running'`).run(nowIso, until, nowIso, workerId);
    if (Number(r.changes) !== 1)
        throw new Error(`Worker lease not active: ${workerId}`);
    recordEvent(db, 'WORKER_HEARTBEAT', { workerId, leaseUntil: until });
    return until;
}
export function releaseWorkerLease(db, workerId) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE worker_leases SET status='stopped',current_task_id=NULL,updated_at=? WHERE worker_id=?`).run(now, workerId);
    db.prepare(`DELETE FROM task_claims WHERE worker_id=?`).run(workerId);
    recordEvent(db, 'WORKER_LEASE_RELEASED', { workerId });
}
export function claimReadyTask(db, workerId, leaseMs) {
    const now = new Date();
    const nowIso = now.toISOString();
    const until = new Date(now.getTime() + leaseMs).toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
        db.prepare(`DELETE FROM task_claims WHERE lease_until < ?`).run(nowIso);
        const row = db.prepare(`SELECT t.id FROM tasks t WHERE t.status='ready' AND NOT EXISTS(SELECT 1 FROM task_claims c WHERE c.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM tasks d WHERE d.id IN (SELECT value FROM json_each(t.depends_json)) AND d.status!='done') ORDER BY t.priority DESC,t.updated_at ASC LIMIT 1`).get();
        if (!row) {
            db.exec('COMMIT');
            return undefined;
        }
        db.prepare(`INSERT INTO task_claims(task_id,worker_id,lease_until,claimed_at,updated_at) VALUES(?,?,?,?,?)`).run(row.id, workerId, until, nowIso, nowIso);
        db.prepare(`UPDATE worker_leases SET current_task_id=?,updated_at=? WHERE worker_id=? AND status='running'`).run(row.id, nowIso, workerId);
        recordEvent(db, 'TASK_CLAIMED', { workerId, taskId: row.id, leaseUntil: until }, row.id);
        db.exec('COMMIT');
        return { taskId: row.id, leaseUntil: until };
    }
    catch (e) {
        try {
            db.exec('ROLLBACK');
        }
        catch { }
        ;
        throw e;
    }
}
export function renewTaskClaim(db, workerId, taskId, leaseMs) {
    const now = new Date();
    const nowIso = now.toISOString();
    const until = new Date(now.getTime() + leaseMs).toISOString();
    const r = db.prepare(`UPDATE task_claims SET lease_until=?,updated_at=? WHERE task_id=? AND worker_id=?`).run(until, nowIso, taskId, workerId);
    if (Number(r.changes) !== 1)
        throw new Error(`Task claim not active: ${taskId}`);
    return until;
}
export function releaseTaskClaim(db, workerId, taskId) {
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM task_claims WHERE task_id=? AND worker_id=?`).run(taskId, workerId);
    db.prepare(`UPDATE worker_leases SET current_task_id=NULL,updated_at=? WHERE worker_id=?`).run(now, workerId);
    recordEvent(db, 'TASK_RELEASED', { workerId, taskId }, taskId);
}
export function recoverStaleWorkerLeases(db, staleMs) {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = db.prepare(`SELECT worker_id,current_task_id FROM worker_leases WHERE status='running' AND heartbeat_at < ?`).all(cutoff);
    for (const row of rows) {
        db.prepare(`UPDATE worker_leases SET status='stale',updated_at=?,current_task_id=NULL WHERE worker_id=?`).run(new Date().toISOString(), row.worker_id);
        db.prepare(`DELETE FROM task_claims WHERE worker_id=?`).run(row.worker_id);
        recordEvent(db, 'worker.lease_stale', { workerId: row.worker_id, taskId: row.current_task_id });
    }
    return rows;
}
export function workerRuntimeSummary(db) {
    return db.prepare(`SELECT worker_id,status,pid,host,lease_until,heartbeat_at,current_task_id,started_at,updated_at FROM worker_leases ORDER BY worker_id`).all();
}
export function createCollaborationSession(db, s) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO collaboration_sessions(id,task_id,status,objective,max_rounds,max_messages,current_round,lead_role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.taskId, 'running', s.objective, s.maxRounds, s.maxMessages, 0, s.leadRole, now, now);
    return s.id;
}
export function addCollaborationMessage(db, m) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO collaboration_messages(id,session_id,round,sequence,agent_role,worker_id,model,kind,content,in_reply_to,confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.id, m.sessionId, m.round, m.sequence, m.agentRole, m.workerId ?? null, m.model ?? null, m.kind, m.content, m.inReplyTo ?? null, m.confidence ?? null, now);
    db.prepare(`UPDATE collaboration_sessions SET current_round=MAX(current_round,?),updated_at=? WHERE id=?`).run(m.round, now, m.sessionId);
}
export function saveCollaborationDecision(db, d) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO collaboration_decisions(id,session_id,decision,status,rationale,conflicts_json,evidence_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(d.id, d.sessionId, d.decision, d.status, d.rationale, JSON.stringify(d.conflicts ?? []), JSON.stringify(d.evidence ?? []), now);
    db.prepare(`UPDATE collaboration_sessions SET status=?,updated_at=?,finished_at=? WHERE id=?`).run(d.status === 'BLOCKED' ? 'blocked' : 'completed', now, now, d.sessionId);
}
export function collaborationStatus(db, sessionId) {
    if (sessionId) {
        const session = db.prepare('SELECT * FROM collaboration_sessions WHERE id=?').get(sessionId);
        if (!session)
            return undefined;
        const messages = db.prepare('SELECT * FROM collaboration_messages WHERE session_id=? ORDER BY sequence').all(sessionId);
        const decisions = db.prepare('SELECT * FROM collaboration_decisions WHERE session_id=? ORDER BY created_at').all(sessionId);
        return { session, messages, decisions };
    }
    return db.prepare('SELECT * FROM collaboration_sessions ORDER BY updated_at DESC LIMIT 50').all();
}
export function saveConsensusEvaluation(db, e) {
    const now = e.createdAt || new Date().toISOString();
    db.prepare(`INSERT INTO consensus_evaluations(id,session_id,decision,level,score,quorum,unique_roles,message_count,support_count,dissent_count,blocker_count,evidence_count,confidence,unresolved_json,recommendation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id, e.sessionId, e.decision, e.level, e.score, e.quorum ? 1 : 0, e.uniqueRoles, e.messageCount, e.supportCount, e.dissentCount, e.blockerCount, e.evidenceCount, e.confidence, JSON.stringify(e.unresolvedConflicts || []), e.recommendation, now);
}
export function collaborationHistory(db, taskId) {
    if (taskId)
        return db.prepare(`SELECT s.*,d.decision,d.status AS decision_status,d.rationale FROM collaboration_sessions s LEFT JOIN collaboration_decisions d ON d.session_id=s.id WHERE s.task_id=? ORDER BY s.created_at DESC`).all(taskId);
    return db.prepare(`SELECT s.*,d.decision,d.status AS decision_status,d.rationale FROM collaboration_sessions s LEFT JOIN collaboration_decisions d ON d.session_id=s.id ORDER BY s.created_at DESC LIMIT 100`).all();
}
