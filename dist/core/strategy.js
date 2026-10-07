import path from 'node:path';
import YAML from 'yaml';
import { ensureDir, readText, writeText } from './fs.js';
import { loadConfig, listTasks } from './config.js';
import { buildContext } from './context.js';
import { route } from './router.js';
import { runWorker } from '../workers/adapters.js';
import { openDb, recordEvent } from './db.js';
import { factoryIntelligence } from './factory-intelligence.js';
function extractYaml(text) {
    const m = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i);
    return (m ? m[1] : text).trim();
}
export async function planProject(root, goal) {
    const config = await loadConfig(root);
    const existing = await listTasks(root);
    const pseudo = { id: 'STRATEGY', version: 1, title: 'Project strategy', type: 'strategy', status: 'planning', objective: goal, acceptance_criteria: [], depends_on: [], risk: 'medium', assigned_role: 'architect' };
    const context = (await buildContext(root, pseudo, config.defaults.max_context_chars)).slice(0, config.defaults.max_context_chars);
    const intelligence = await factoryIntelligence(root);
    const intelligenceText = JSON.stringify(intelligence, null, 2).slice(0, 12000);
    const workers = await route(root, pseudo, config, 'architect');
    if (!workers.length)
        throw new Error('No architect worker available for planning.');
    const prompt = `You are Aegis Product Strategist + Software Architect.\n\nPROJECT GOAL:\n${goal}\n\nEXISTING TASKS:\n${existing.map(t => `${t.id}: ${t.title} [${t.status}]`).join('\n') || 'none'}\n\nFACTORY INTELLIGENCE:\n${intelligenceText}\n\nPROJECT CONTEXT:\n${context}\n\nCreate a practical incremental delivery plan. Return ONLY YAML with this exact shape:\nplan:\n  goal: string\n  milestones:\n    - id: string\n      title: string\n      objective: string\n      priority: number\n      tasks:\n        - id: string\n          title: string\n          type: string\n          priority: number\n          status: ready\n          objective: string\n          acceptance_criteria: [string]\n          depends_on: [string]\n          risk: low|medium|high|critical\n          assigned_role: product|architect|developer|tester|reviewer|security|debugger\nDo not invent credentials, secrets, vendors, or irreversible production operations. Prefer small independently verifiable tasks. Avoid duplicating existing tasks.`;
    const result = await runWorker({ projectPath: root, model: workers[0].model, prompt, timeoutMs: config.defaults.run_timeout_ms, command: workers[0].command }, workers[0]);
    if (!result.success)
        throw new Error(`Planning failed: ${result.output.slice(-2000)}`);
    let parsed;
    try {
        parsed = YAML.parse(extractYaml(result.output));
    }
    catch (e) {
        throw new Error(`Planner returned invalid YAML: ${e}`);
    }
    if (!parsed?.plan?.milestones)
        throw new Error('Planner output missing plan.milestones.');
    await ensureDir(path.join(root, '.ai'));
    await writeText(path.join(root, '.ai/ROADMAP.generated.yaml'), YAML.stringify(parsed));
    await writeText(path.join(root, '.ai/FACTORY_INTELLIGENCE.json'), JSON.stringify(intelligence, null, 2));
    await ensureDir(path.join(root, '.ai/tasks'));
    const created = [];
    for (const m of parsed.plan.milestones) {
        for (const t of (m.tasks || [])) {
            const item = { ...t, version: 1, parent_task: undefined, generated_by: 'strategy', status: t.status || 'ready' };
            const file = path.join(root, '.ai/tasks', `${item.id}.yaml`);
            try {
                await readText(file);
                continue;
            }
            catch { }
            await writeText(file, YAML.stringify(item));
            created.push(item);
        }
    }
    const db = await openDb(root);
    recordEvent(db, 'strategy.plan_created', { goal, created: created.map(x => x.id), worker: workers[0].id }, undefined, undefined);
    db.close();
    return { goal, milestones: parsed.plan.milestones, created };
}
