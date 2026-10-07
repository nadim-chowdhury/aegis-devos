import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, listTasks } from './config.js';
import { openDb, recordEvent } from './db.js';
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function complexity(task) {
    const acceptance = task.acceptance_criteria?.length || 0;
    const scope = (task.scope?.allowed?.length || 0) + (task.scope?.forbidden?.length || 0);
    const gates = task.quality_gates?.length || 0;
    const risk = { low: 1, medium: 2, high: 3, critical: 4 }[task.risk || 'medium'] || 2;
    return Math.min(10, 1 + acceptance * .7 + scope * .25 + gates * .5 + risk * .8);
}
export async function resourcePlan(project, task) {
    const root = path.resolve(project);
    const config = await loadConfig(root);
    const db = await openDb(root);
    try {
        const outcomes = db.prepare(`SELECT worker_id,model,status,duration_ms,role,task_type,domain,risk,created_at FROM task_outcomes`).all();
        const routes = db.prepare(`SELECT worker_id,estimated_cost,estimated_latency_ms,confidence,created_at FROM routing_decisions WHERE task_id=? ORDER BY id DESC LIMIT 100`).all(task.id);
        const c = complexity(task);
        const budget = Number(config.defaults.resource_budget ?? config.resource_budget ?? 10);
        const forecasts = config.workers.filter(w => w.enabled !== false).map((w) => {
            const rows = outcomes.filter(r => r.worker_id === w.id);
            const comparable = rows.filter(r => r.task_type === task.type && (r.domain || '') === (task.domain || '') && (r.risk || '') === (task.risk || ''));
            const pool = comparable.length ? comparable : rows.filter(r => r.task_type === task.type);
            const durations = pool.map(r => Number(r.duration_ms || 0)).filter(n => n > 0);
            const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 120000 * (1 + c / 8);
            const routeRows = routes.filter(r => r.worker_id === w.id);
            const routeCost = routeRows.length ? Number(routeRows[0].estimated_cost || 0) : 0;
            const baseCost = routeCost > 0 ? routeCost : (w.cost || 0) * (avg / 60000) * Math.max(1, c / 4);
            const complexityMultiplier = 1 + Math.max(0, c - 5) * .08;
            const estimatedCost = baseCost * complexityMultiplier;
            const success = pool.filter(r => ['done', 'success', 'passed'].includes(String(r.status))).length;
            const confidence = clamp((pool.length * .08) + (rows.length * .02), .12, .95);
            const reasons = [];
            if (comparable.length)
                reasons.push(`${comparable.length} exact-context outcome(s)`);
            else if (pool.length)
                reasons.push(`${pool.length} comparable task-type outcome(s)`);
            else
                reasons.push('no historical task outcome; conservative baseline');
            if (w.cost)
                reasons.push(`worker cost weight ${w.cost}`);
            if (success)
                reasons.push(`${success}/${pool.length} comparable outcome(s) succeeded`);
            return { workerId: w.id, model: w.model, estimatedCost: Number(estimatedCost.toFixed(3)), estimatedLatencyMs: Math.round(avg), confidence: Number(confidence.toFixed(3)), sampleSize: pool.length, costPerMinute: Number((w.cost || 0).toFixed(3)), reasons };
        }).sort((a, b) => {
            const aFit = a.estimatedCost <= budget ? 1 : 0, bFit = b.estimatedCost <= budget ? 1 : 0;
            return (bFit - aFit) || (a.estimatedCost - b.estimatedCost) || (b.confidence - a.confidence);
        });
        const best = forecasts[0];
        const recommendation = !best ? 'NO_WORKER' : 'best estimated cost/latency strategy within configured budget';
        const plan = { taskId: task.id, budget, forecasts, recommendedWorkerId: best?.workerId, recommendedModel: best?.model, estimatedCost: best?.estimatedCost, estimatedLatencyMs: best?.estimatedLatencyMs, projectedBudgetUsage: best ? Number((best.estimatedCost / Math.max(.001, budget)).toFixed(3)) : undefined, recommendation, confidence: best?.confidence ?? 0, generatedAt: new Date().toISOString() };
        db.prepare(`INSERT INTO resource_predictions(id,task_id,recommended_worker_id,recommended_model,budget,estimated_cost,estimated_latency_ms,confidence,sample_size,forecast_json,recommendation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), task.id, best?.workerId ?? null, best?.model ?? null, budget, best?.estimatedCost ?? null, best?.estimatedLatencyMs ?? null, best?.confidence ?? 0, best?.sampleSize ?? 0, JSON.stringify(plan), recommendation, plan.generatedAt);
        recordEvent(db, 'resource.prediction', plan, task.id);
        return plan;
    }
    finally {
        db.close();
    }
}
export async function resourceRecommendations(project) {
    const root = path.resolve(project);
    const tasks = await listTasks(root);
    const db = await openDb(root);
    try {
        const rows = db.prepare(`SELECT * FROM resource_predictions ORDER BY created_at DESC LIMIT 100`).all();
        return { generatedAt: new Date().toISOString(), project: root, budget: await loadConfig(root).then(c => Number(c.defaults.resource_budget ?? 10)), predictions: rows };
    }
    finally {
        db.close();
    }
}
export async function resourceHistory(project, taskId) {
    const db = await openDb(path.resolve(project));
    try {
        return taskId ? db.prepare(`SELECT * FROM resource_predictions WHERE task_id=? ORDER BY created_at DESC LIMIT 100`).all(taskId) : db.prepare(`SELECT * FROM resource_predictions ORDER BY created_at DESC LIMIT 100`).all();
    }
    finally {
        db.close();
    }
}
