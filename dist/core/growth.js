import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, writeText } from './fs.js';
import { openDb, recordEvent } from './db.js';
import { productHealth } from './intelligence.js';
async function loadSignals(root) {
    const file = path.join(root, '.ai', 'PRODUCT_SIGNALS.yaml');
    if (!(await exists(file)))
        return [];
    const parsed = YAML.parse(await readText(file));
    return Array.isArray(parsed?.signals) ? parsed.signals : [];
}
export async function growthReport(root) {
    const signals = await loadSignals(root);
    const gaps = [];
    const strengths = [];
    for (const s of signals) {
        if (typeof s.value !== 'number' || typeof s.target !== 'number' || s.target === 0)
            continue;
        const direction = s.direction === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better';
        const gap = direction === 'higher_is_better' ? s.target - s.value : s.value - s.target;
        const gapPercent = Math.abs(gap / Math.abs(s.target)) * 100;
        if (gap <= 0)
            strengths.push(s);
        else
            gaps.push({
                metric: s.name,
                value: s.value,
                target: s.target,
                direction,
                gap,
                gap_percent: Number(gapPercent.toFixed(2)),
                severity: gapPercent >= 30 ? 'critical' : gapPercent >= 10 ? 'watch' : 'healthy',
                source: s.source
            });
    }
    const average = signals.length
        ? signals.reduce((sum, s) => {
            if (typeof s.target !== 'number' || s.target === 0)
                return sum + 0.5;
            const ratio = s.direction === 'lower_is_better' ? s.target / Math.max(Math.abs(s.value), Number.EPSILON) : s.value / s.target;
            return sum + Math.max(0, Math.min(1, ratio));
        }, 0) / signals.length
        : 0.5;
    const health = await productHealth(root);
    const score = Math.round(average * 100);
    const opportunities = gaps.map((g, i) => ({
        id: `growth-gap-${g.metric}`,
        kind: 'growth',
        title: `Improve ${g.metric}`,
        rationale: `${g.metric} is ${g.gap_percent}% away from its target (${g.value} vs ${g.target}).`,
        value: g.severity === 'critical' ? 10 : 7,
        confidence: 0.8,
        effort: g.severity === 'critical' ? 4 : 3,
        score: Number(((g.severity === 'critical' ? 10 : 7) * 0.8 / (g.severity === 'critical' ? 4 : 3) * 10).toFixed(2)),
        recommended_action: `Create a bounded experiment targeting ${g.metric}; measure before changing unrelated product areas.`
    }));
    const report = { score, gaps, strengths, opportunities, health_score: health.score, generated_at: new Date().toISOString() };
    const db = await openDb(root);
    recordEvent(db, 'growth.report_calculated', report);
    db.close();
    return report;
}
export async function updateExperiment(root, id, status, observed) {
    const file = path.join(root, '.ai', 'experiments.yaml');
    if (!(await exists(file)))
        throw new Error('No experiments file exists.');
    const parsed = YAML.parse(await readText(file)) || { experiments: [] };
    const experiments = Array.isArray(parsed.experiments) ? parsed.experiments : [];
    const index = experiments.findIndex((e) => e.id === id);
    if (index < 0)
        throw new Error(`Experiment ${id} not found.`);
    const exp = { ...experiments[index], status };
    if (observed !== undefined)
        exp.observed = observed;
    experiments[index] = exp;
    await writeText(file, YAML.stringify({ experiments }));
    const db = await openDb(root);
    recordEvent(db, 'experiment.updated', exp);
    db.close();
    return exp;
}
