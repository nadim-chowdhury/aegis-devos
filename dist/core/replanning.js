import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { readText, writeText, ensureDir } from './fs.js';
import { loadConfig, listTasks } from './config.js';
import { buildContext } from './context.js';
import { route } from './router.js';
import { runWorker } from '../workers/adapters.js';
import { openDb, recordEvent, savePlanProposal } from './db.js';
import { factoryIntelligence } from './factory-intelligence.js';
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function extractYaml(text) { const m = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i); return (m ? m[1] : text).trim(); }
async function requirementsFingerprint(root, tasks) {
    const files = ['.ai/PRODUCT.md', '.ai/REQUIREMENTS.md', '.ai/ARCHITECTURE.md', '.ai/CONSTRAINTS.md'];
    const docs = [];
    for (const file of files) {
        try {
            docs.push(file + '\n' + await readText(path.join(root, file)));
        }
        catch { }
    }
    return sha(JSON.stringify({ docs, tasks: tasks.map(t => ({ id: t.id, title: t.title, objective: t.objective, acceptance_criteria: t.acceptance_criteria, depends_on: t.depends_on, risk: t.risk, status: t.status })) }));
}
function validateDelta(delta, existing) {
    const ids = new Set(existing.map(t => t.id));
    const errors = [];
    for (const t of delta.add || []) {
        const id = String(t.id || '');
        if (!id)
            errors.push('Added task is missing id.');
        else if (ids.has(id))
            errors.push(`Added task ${id} already exists.`);
    }
    for (const u of delta.update || []) {
        if (!ids.has(u.id))
            errors.push(`Update references unknown task ${u.id}.`);
    }
    for (const b of delta.block || []) {
        if (!ids.has(b.id))
            errors.push(`Block references unknown task ${b.id}.`);
    }
    for (const r of delta.reorder || []) {
        if (!ids.has(r.id))
            errors.push(`Reorder references unknown task ${r.id}.`);
    }
    return errors;
}
export async function replanProject(root, trigger = 'execution-observation') {
    const config = await loadConfig(root);
    const tasks = await listTasks(root);
    const pseudo = { id: 'REPLANNER', version: 1, title: 'Adaptive replanning', type: 'replan', status: 'planning', objective: trigger, acceptance_criteria: [], depends_on: [], risk: 'medium', assigned_role: 'architect' };
    const context = (await buildContext(root, pseudo, config.defaults.max_context_chars)).slice(0, config.defaults.max_context_chars);
    const intelligence = await factoryIntelligence(root);
    const intelligenceText = JSON.stringify(intelligence, null, 2).slice(0, 16000);
    const topRecommendations = (intelligence.recommendations || []).slice(0, 8);
    const strategyEvidence = topRecommendations.map((r) => `${r.id} | priority=${r.priority} | ${r.title} | ${r.action} | evidence=${(r.evidence || []).join(', ')}`).join('\n') || 'none';
    const workers = await route(root, pseudo, config, 'architect');
    if (!workers.length)
        throw new Error('No architect worker available for replanning.');
    const immutable = `The user's product intent and explicit requirements are immutable. Do NOT remove or weaken acceptance criteria, security constraints, protected paths, or required quality gates. You may propose task additions, dependency changes, prioritization, blocking, or decomposition only when supported by observed evidence.`;
    const prompt = `You are Aegis Adaptive Planner.\n\nTRIGGER:\n${trigger}\n\n${immutable}\n\nCURRENT TASKS:\n${tasks.map(t => `${t.id} | ${t.status} | p${t.priority || 0} | ${t.title} | deps=${(t.depends_on || []).join(',')}`).join('\n') || 'none'}\n\nPROJECT CONTEXT / OBSERVED EVIDENCE:\n${context}\n\nReturn ONLY YAML:\nreplan:\n  rationale: string\n  add: []\n  update: []\n  block: []\n  reorder: []\nEach add item must include id,title,type,priority,status,objective,acceptance_criteria,depends_on,risk,assigned_role. Each update item: id,reason,changes. Each block item: id,reason. Each reorder item: id,priority,reason. Keep the delta minimal. Never claim an outcome not supported by evidence.`;
    const result = await runWorker({ projectPath: root, model: workers[0].model, prompt, timeoutMs: config.defaults.run_timeout_ms, command: workers[0].command }, workers[0]);
    if (!result.success)
        throw new Error(`Replanning failed: ${result.output.slice(-2000)}`);
    let parsed;
    try {
        parsed = YAML.parse(extractYaml(result.output));
    }
    catch (e) {
        throw new Error(`Replanner returned invalid YAML: ${e}`);
    }
    const delta = parsed?.replan || {};
    const errors = validateDelta(delta, tasks);
    const proposal = {
        id: `PLAN-${Date.now()}`,
        trigger,
        rationale: String(parsed?.replan?.rationale || ''),
        immutableRequirementsFingerprint: await requirementsFingerprint(root, tasks),
        delta,
        validation: { ok: errors.length === 0, errors },
        generatedAt: new Date().toISOString(),
        intelligence: {
            generatedAt: intelligence.generated_at,
            recommendationIds: topRecommendations.map((r) => r.id),
            recommendationPriorities: topRecommendations.map((r) => ({ id: r.id, priority: r.priority }))
        },
        status: errors.length === 0 ? 'PROPOSED' : 'REJECTED'
    };
    await ensureDir(path.join(root, '.ai'));
    await writeText(path.join(root, '.ai', 'REPLAN_PROPOSAL.yaml'), YAML.stringify(proposal));
    const db = await openDb(root);
    savePlanProposal(db, proposal);
    recordEvent(db, 'strategy.replan_proposed', proposal, undefined, undefined);
    db.close();
    return proposal;
}
export async function replanStatus(root) {
    const db = await openDb(root);
    const rows = db.prepare('SELECT * FROM plan_proposals ORDER BY created_at DESC LIMIT 20').all();
    db.close();
    return rows;
}
export async function approveReplan(root, proposalId) {
    const db = await openDb(root);
    const row = db.prepare('SELECT * FROM plan_proposals WHERE id=?').get(proposalId);
    db.close();
    if (!row)
        throw new Error(`Replan proposal ${proposalId} not found.`);
    if (row.status !== 'PROPOSED')
        throw new Error(`Replan proposal ${proposalId} is ${row.status}; only PROPOSED proposals can be approved.`);
    const currentTasks = await listTasks(root);
    const currentFingerprint = await requirementsFingerprint(root, currentTasks);
    if (currentFingerprint !== row.requirements_fingerprint)
        throw new Error(`Replan ${proposalId} is stale: immutable requirements or task definitions changed since proposal generation. Generate a new replan.`);
    const delta = JSON.parse(row.delta_json);
    const tasks = currentTasks;
    const byId = new Map(tasks.map(t => [t.id, t]));
    for (const item of delta.add || []) {
        const id = String(item.id);
        if (byId.has(id))
            throw new Error(`Cannot apply: task ${id} already exists.`);
        const task = { ...item, version: 1, status: item.status || 'ready', acceptance_criteria: Array.isArray(item.acceptance_criteria) ? item.acceptance_criteria : [], depends_on: Array.isArray(item.depends_on) ? item.depends_on : [] };
        byId.set(id, task);
    }
    for (const u of delta.update || []) {
        const t = byId.get(u.id);
        if (!t)
            throw new Error(`Cannot apply: unknown task ${u.id}.`);
        for (const [k, v] of Object.entries(u.changes || {})) {
            if (['acceptance_criteria', 'objective', 'scope', 'quality_gates'].includes(k))
                throw new Error(`Replan cannot mutate immutable requirement field ${k} on ${u.id}.`);
            t[k] = v;
        }
    }
    for (const b of delta.block || []) {
        const t = byId.get(b.id);
        if (t)
            t.status = 'blocked';
    }
    for (const r of delta.reorder || []) {
        const t = byId.get(r.id);
        if (t)
            t.priority = r.priority;
    }
    const projected = [...byId.values()];
    const errors = [];
    for (const t of projected)
        for (const dep of (t.depends_on || []))
            if (!byId.has(dep))
                errors.push(`${t.id}: missing dependency ${dep}`);
    const indegree = new Map(projected.map(t => [t.id, 0]));
    const edges = new Map();
    for (const t of projected)
        for (const dep of (t.depends_on || []))
            if (byId.has(dep)) {
                indegree.set(t.id, (indegree.get(t.id) || 0) + 1);
                edges.set(dep, [...(edges.get(dep) || []), t.id]);
            }
    const q = [...projected.filter(t => (indegree.get(t.id) || 0) === 0).map(t => t.id)];
    let visited = 0;
    while (q.length) {
        const id = q.shift();
        visited++;
        for (const n of edges.get(id) || []) {
            const d = (indegree.get(n) || 0) - 1;
            indegree.set(n, d);
            if (d === 0)
                q.push(n);
        }
    }
    if (visited !== projected.length)
        errors.push('Projected task graph contains a dependency cycle.');
    if (errors.length)
        throw new Error(`Replan rejected by DAG validation: ${errors.join('; ')}`);
    for (const t of projected)
        await (await import('./config.js')).saveTask(root, t);
    const db2 = await openDb(root);
    db2.prepare(`UPDATE plan_proposals SET status='APPROVED',created_at=created_at WHERE id=?`).run(proposalId);
    recordEvent(db2, 'strategy.replan_approved', { proposalId, added: (delta.add || []).map(x => x.id), updated: (delta.update || []).map(x => x.id), blocked: (delta.block || []).map(x => x.id) }, undefined, undefined);
    db2.close();
    return { proposalId, status: 'APPROVED', added: (delta.add || []).map(x => x.id), updated: (delta.update || []).map(x => x.id), blocked: (delta.block || []).map(x => x.id), reordered: (delta.reorder || []).map(x => x.id) };
}
