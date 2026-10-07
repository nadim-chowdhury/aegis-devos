import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { openDb, startRecovery, completeRecovery } from './db.js';
function taskFile(root, id) { return path.join(root, '.ai/tasks', `${id}.yaml`); }
function readTaskSync(root, id) { return YAML.parse(readFileSync(taskFile(root, id), 'utf8')); }
function saveTaskSync(root, t) { writeFileSync(taskFile(root, t.id), YAML.stringify(t)); }
export async function activateRecovery(project, requestId) {
    const root = path.resolve(project), db = await openDb(root);
    try {
        const row = db.prepare('SELECT * FROM recovery_requests WHERE id=?').get(requestId);
        if (!row)
            return { status: 'missing' };
        if (row.status !== 'scheduled')
            return { status: row.status };
        if (!startRecovery(db, requestId))
            return { status: 'budget_exhausted' };
        const task = readTaskSync(root, row.task_id);
        task.status = 'ready';
        task.assigned_role = (task.escalation?.role || 'debugger');
        task.generated_by = 'recovery-orchestrator';
        saveTaskSync(root, task);
        db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run('ready', new Date().toISOString(), task.id);
        return { status: 'activated', taskId: task.id, role: task.assigned_role, attempts: row.attempts + 1, maxAttempts: row.max_attempts };
    }
    catch (e) {
        completeRecovery(db, requestId, 'failed', String(e));
        throw e;
    }
    finally {
        db.close();
    }
}
export async function recoveryStatus(project, taskId) {
    const db = await openDb(path.resolve(project));
    try {
        return taskId ? db.prepare('SELECT * FROM recovery_requests WHERE task_id=? ORDER BY created_at DESC').all(taskId) : db.prepare('SELECT * FROM recovery_requests ORDER BY updated_at DESC').all();
    }
    finally {
        db.close();
    }
}
