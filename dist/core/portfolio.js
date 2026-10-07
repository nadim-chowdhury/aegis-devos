import path from 'node:path';
import { readdir } from 'node:fs/promises';
import YAML from 'yaml';
import { exists, readText, writeText } from './fs.js';
import { listTasks } from './config.js';
import { discoverOpportunities } from './opportunities.js';
import { productHealth } from './intelligence.js';
async function configuredProducts(root) {
    const file = path.join(root, '.aegis', 'portfolio.yaml');
    if (!(await exists(file)))
        return undefined;
    const parsed = YAML.parse(await readText(file));
    if (!Array.isArray(parsed?.products))
        return undefined;
    return parsed.products.map((p) => ({
        id: String(p.id), name: p.name, path: String(p.path), lifecycle: p.lifecycle,
        strategic_weight: Number(p.strategic_weight ?? 1), revenue_weight: Number(p.revenue_weight ?? 1),
        growth_weight: Number(p.growth_weight ?? 1), engineering_weight: Number(p.engineering_weight ?? 1),
        enabled: p.enabled !== false
    }));
}
async function discoverProducts(root) {
    const configured = await configuredProducts(root);
    if (configured)
        return configured.filter(p => p.enabled !== false);
    const projectsDir = path.join(root, 'projects');
    if (!(await exists(projectsDir)))
        return [];
    const entries = await readdir(projectsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => ({ id: e.name, name: e.name, path: path.join('projects', e.name), strategic_weight: 1, revenue_weight: 1, growth_weight: 1, engineering_weight: 1, enabled: true }));
}
function normalizePath(root, p) { return path.resolve(root, p); }
export async function portfolioReport(root) {
    const products = await discoverProducts(root);
    const results = [];
    for (const p of products) {
        const productRoot = normalizePath(root, p.path);
        if (!(await exists(path.join(productRoot, '.ai'))))
            continue;
        const health = await productHealth(productRoot);
        const tasks = await listTasks(productRoot);
        results.push({
            id: p.id, name: p.name ?? p.id, path: p.path, lifecycle: p.lifecycle ?? 'building',
            strategic_weight: p.strategic_weight ?? 1, revenue_weight: p.revenue_weight ?? 1, growth_weight: p.growth_weight ?? 1, engineering_weight: p.engineering_weight ?? 1,
            health, task_summary: { total: tasks.length, ready: tasks.filter(t => t.status === 'ready').length, active: tasks.filter(t => ['planning', 'implementing', 'testing', 'review', 'security_review', 'quality_gate', 'debugging'].includes(t.status)).length, blocked: tasks.filter(t => ['blocked', 'failed'].includes(t.status)).length }
        });
    }
    return { generated_at: new Date().toISOString(), root, products: results };
}
export async function nextBestActions(root, limit = 10) {
    const products = await discoverProducts(root);
    const actions = [];
    for (const p of products) {
        const productRoot = normalizePath(root, p.path);
        if (!(await exists(path.join(productRoot, '.ai'))))
            continue;
        const health = await productHealth(productRoot);
        const opportunities = await discoverOpportunities(productRoot);
        const strategic = Number(p.strategic_weight ?? 1);
        for (const o of opportunities) {
            const urgency = 1 + (100 - health.score) / 100;
            const score = Number((o.score * urgency * strategic).toFixed(2));
            actions.push({ product_id: p.id, product_path: p.path, action_id: o.id, kind: o.kind, title: o.title, rationale: `${o.rationale} Product health is ${health.score}/100.`, score, health_score: health.score, opportunity_score: o.score, strategic_weight: strategic, recommended_action: o.recommended_action });
        }
        const ready = (await listTasks(productRoot)).filter(t => t.status === 'ready');
        if (ready.length) {
            const t = ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
            const score = Number(((t.priority ?? 5) * 2 * (1 + (100 - health.score) / 100) * strategic).toFixed(2));
            actions.push({ product_id: p.id, product_path: p.path, action_id: `task:${t.id}`, kind: 'delivery', title: `Execute ready task: ${t.title}`, rationale: `A ready task exists and the product health score is ${health.score}/100.`, score, health_score: health.score, opportunity_score: t.priority ?? 5, strategic_weight: strategic, recommended_action: `Run task ${t.id}.` });
        }
    }
    return actions.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}
export async function savePortfolioConfig(root, products) {
    await writeText(path.join(root, '.aegis', 'portfolio.yaml'), YAML.stringify({ products }));
}
