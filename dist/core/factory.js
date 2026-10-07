import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readText, writeText, ensureDir } from './fs.js';
import { loadConfig, listTasks } from './config.js';
import { buildExecutionPlan } from './orchestrator.js';
import { runTask } from './run.js';
import { planProject } from './strategy.js';
import { openDb, recordEvent } from './db.js';
import { learn } from './learning.js';
import { collectObservability } from './observability.js';
const defaults = { maxTasks: 20, maxParallelWorkers: 1, maxRecoveryAttempts: 2, maxCollaborationRounds: 3, maxWallClockMs: 60 * 60 * 1000, maxReplans: 1 };
function statePath(root) { return path.join(root, '.ai', 'FACTORY_RUN.json'); }
function mergeBudget(b) { return { ...defaults, ...b }; }
function statusFile(root) { return path.join(root, '.ai', 'FACTORY_RUN.json'); }
async function persist(root, state) { await ensureDir(path.join(root, '.ai')); state.updatedAt = new Date().toISOString(); await writeText(statusFile(root), JSON.stringify(state, null, 2)); }
function humanGate(t) { return t.human_approval === true || ['high', 'critical'].includes(t.risk || 'low') && false; }
function phaseStatus(phase) { return phase; }
async function emitPhase(root, id, phase, payload = {}) { const db = await openDb(root); recordEvent(db, `factory.phase.${phase.toLowerCase()}`, { factoryRunId: id, phase, ...payload }); db.close(); }
export async function factoryStatus(project) {
    const root = path.resolve(project);
    try {
        return JSON.parse(await readText(statePath(root)));
    }
    catch {
        return null;
    }
}
export async function runFactory(project, options = {}) {
    const root = path.resolve(project), config = await loadConfig(root), budget = mergeBudget(options.budget), started = Date.now();
    let state = null;
    if (options.resume) {
        state = await factoryStatus(root);
        if (!state || !state.id)
            throw new Error('No persisted factory run available to resume.');
        if (['COMPLETED', 'FAILED', 'BLOCKED'].includes(state.status))
            throw new Error(`Factory run ${state.id} is terminal (${state.status}) and cannot be resumed.`);
        state.budget = mergeBudget(options.budget || state.budget);
    }
    else {
        const id = `FACTORY-${Date.now()}-${randomUUID().slice(0, 8)}`;
        state = { id, goal: options.goal || '', status: 'INTAKE', phase: 'INTAKE', tasksExecuted: 0, replans: 0, recoveries: 0, budget, startedAt: new Date(started).toISOString(), updatedAt: new Date(started).toISOString() };
        const db = await openDb(root);
        db.prepare(`INSERT INTO factory_runs(id,goal,status,phase,tasks_executed,parallel_workers,replans,max_tasks,max_parallel_workers,max_recovery_attempts,max_collaboration_rounds,max_wall_clock_ms,max_replans,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, state.goal, state.status, state.phase, 0, budget.maxParallelWorkers, 0, budget.maxTasks, budget.maxParallelWorkers, budget.maxRecoveryAttempts, budget.maxCollaborationRounds, budget.maxWallClockMs, budget.maxReplans, state.startedAt, state.updatedAt);
        recordEvent(db, 'factory.started', { factoryRunId: id, goal: state.goal, budget });
        db.close();
        await persist(root, state);
    }
    try {
        state.phase = 'ANALYZING';
        state.status = 'ANALYZING';
        await persist(root, state);
        await emitPhase(root, state.id, state.phase);
        let tasks = await listTasks(root);
        if (!tasks.some(t => t.status === 'ready') && state.goal) {
            if (state.replans >= budget.maxReplans) {
                state.status = 'BLOCKED';
                state.phase = 'PLANNING';
                state.lastError = 'No ready tasks and planning budget exhausted.';
                await persist(root, state);
                return state;
            }
            state.phase = 'PLANNING';
            state.status = 'PLANNING';
            await persist(root, state);
            await emitPhase(root, state.id, state.phase);
            const planned = await planProject(root, state.goal);
            state.replans++;
            state.planned = planned.created.map((t) => t.id);
            await persist(root, state);
            tasks = await listTasks(root);
        }
        while (Date.now() - started < budget.maxWallClockMs && state.tasksExecuted < budget.maxTasks) {
            const plan = await buildExecutionPlan(root);
            if (!plan.valid) {
                state.status = 'BLOCKED';
                state.phase = 'ANALYZING';
                state.lastError = plan.errors.join('; ');
                await persist(root, state);
                break;
            }
            const ready = plan.ready.map(id => tasks.find(t => t.id === id)).filter(Boolean);
            if (!ready.length) {
                const fresh = await listTasks(root);
                const active = fresh.some(t => ['implementing', 'testing', 'review', 'security_review', 'debugging', 'quality_gate', 'planning'].includes(t.status));
                state.status = active ? 'EXECUTING' : 'COMPLETED';
                state.phase = active ? 'EXECUTING' : 'LEARNING';
                state.finishedAt = state.status === 'COMPLETED' ? new Date().toISOString() : undefined;
                await persist(root, state);
                break;
            }
            state.status = 'READY';
            state.phase = 'READY';
            await emitPhase(root, state.id, state.phase, { nextTasks: ready.slice(0, budget.maxParallelWorkers).map(t => t.id) });
            state.nextTasks = ready.slice(0, budget.maxParallelWorkers).map(t => t.id);
            await persist(root, state);
            // Factory deliberately serializes integration unless a future coordinator proves safe automatic merging.
            const task = ready[0];
            if (task.human_approval) {
                state.status = 'AWAITING_HUMAN';
                state.phase = 'VERIFYING';
                state.blockedTask = task.id;
                await persist(root, state);
                break;
            }
            state.status = 'EXECUTING';
            state.phase = 'EXECUTING';
            state.currentTask = task.id;
            await persist(root, state);
            await emitPhase(root, state.id, state.phase, { taskId: task.id });
            try {
                await runTask(root, task.id, { skipBranchCreation: true });
                state.tasksExecuted++;
            }
            catch (e) {
                state.lastError = String(e);
                state.recoveries++;
                state.status = /approval|human/i.test(String(e)) ? 'AWAITING_HUMAN' : 'RECOVERING';
                state.phase = state.status;
                await persist(root, state);
                if (state.status === 'AWAITING_HUMAN' || state.recoveries >= budget.maxRecoveryAttempts) {
                    if (state.status === 'RECOVERING' && state.recoveries >= budget.maxRecoveryAttempts) {
                        state.status = 'BLOCKED';
                        state.phase = 'RECOVERING';
                        await persist(root, state);
                    }
                    break;
                }
            }
            tasks = await listTasks(root);
            if (Date.now() - started >= budget.maxWallClockMs)
                break;
        }
        if (!state.finishedAt && state.status !== 'AWAITING_HUMAN' && state.status !== 'BLOCKED') {
            state.status = state.tasksExecuted >= budget.maxTasks ? 'COMPLETED' : 'BLOCKED';
            state.phase = state.status === 'COMPLETED' ? 'LEARNING' : 'VERIFYING';
        }
        if (state.status === 'COMPLETED') {
            state.phase = 'LEARNING';
            await persist(root, state);
            await emitPhase(root, state.id, state.phase);
            try {
                state.learning = await learn(root);
            }
            catch (e) {
                state.learningError = String(e);
            }
            try {
                state.observability = await collectObservability(root);
            }
            catch (e) {
                state.observabilityError = String(e);
            }
            const finalTasks = await listTasks(root);
            state.taskSummary = { total: finalTasks.length, done: finalTasks.filter(t => t.status === 'done').length, remaining: finalTasks.filter(t => t.status !== 'done').map(t => ({ id: t.id, status: t.status })) };
            if (state.taskSummary.remaining.length > 0 && state.goal)
                state.status = 'BLOCKED';
        }
        if (state.status === 'COMPLETED')
            state.finishedAt = new Date().toISOString();
        await persist(root, state);
        const outdb = await openDb(root);
        outdb.prepare('UPDATE factory_runs SET status=?,phase=?,tasks_executed=?,replans=?,updated_at=?,finished_at=?,last_error=? WHERE id=?').run(state.status, state.phase, state.tasksExecuted, state.replans, state.updatedAt, state.finishedAt ?? null, state.lastError ?? null, id);
        recordEvent(outdb, `factory.${String(state.status).toLowerCase()}`, { factoryRunId: id, tasksExecuted: state.tasksExecuted, replans: state.replans, recoveries: state.recoveries });
        outdb.close();
        return state;
    }
    catch (e) {
        state.status = 'FAILED';
        state.phase = 'FAILED';
        state.lastError = String(e);
        state.finishedAt = new Date().toISOString();
        await persist(root, state);
        const edb = await openDb(root);
        edb.prepare('UPDATE factory_runs SET status=?,phase=?,updated_at=?,finished_at=?,last_error=? WHERE id=?').run(state.status, state.phase, state.updatedAt, state.finishedAt, state.lastError, id);
        recordEvent(edb, 'factory.failed', { factoryRunId: id, error: state.lastError });
        edb.close();
        throw e;
    }
}
export async function factoryHistory(project, limit = 20) { const db = await openDb(path.resolve(project)); try {
    return db.prepare('SELECT * FROM factory_runs ORDER BY started_at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 100)));
}
finally {
    db.close();
} }
