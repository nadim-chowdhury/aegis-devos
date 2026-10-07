import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, writeText } from './fs.js';
import { listTasks, loadConfig } from './config.js';
import { openDb, recordEvent } from './db.js';
async function loadSignals(root) {
    const file = path.join(root, '.ai', 'PRODUCT_SIGNALS.yaml');
    if (!(await exists(file)))
        return [];
    const parsed = YAML.parse(await readText(file));
    return Array.isArray(parsed?.signals) ? parsed.signals : [];
}
export async function saveSignals(root, signals) {
    await writeText(path.join(root, '.ai', 'PRODUCT_SIGNALS.yaml'), YAML.stringify({ signals }));
    const db = await openDb(root);
    recordEvent(db, 'product.signals_updated', { count: signals.length });
    db.close();
}
export async function productHealth(root) {
    const tasks = await listTasks(root);
    const config = await loadConfig(root);
    const signals = await loadSignals(root);
    const unfinished = tasks.filter(t => t.status !== 'done').length;
    const failed = tasks.filter(t => t.status === 'failed' || t.status === 'blocked').length;
    const critical = tasks.filter(t => t.risk === 'critical' && t.status !== 'done').length;
    const gateCount = Object.keys(config.quality?.gates || {}).length;
    const signalScores = signals.map(s => {
        if (s.target === undefined || s.value === undefined)
            return 0.5;
        const higher = s.direction !== 'lower_is_better';
        const ratio = higher ? s.value / s.target : s.target / s.value;
        return Math.max(0, Math.min(1, ratio));
    });
    const delivery = Math.max(0, 1 - Math.min(1, unfinished / 20));
    const reliability = Math.max(0, 1 - Math.min(1, failed / 5));
    const safety = Math.max(0, 1 - Math.min(1, critical / 3));
    const quality = Math.min(1, gateCount / 4);
    const productSignals = signalScores.length ? signalScores.reduce((a, b) => a + b, 0) / signalScores.length : 0.5;
    const score = Math.round(100 * (delivery * .25 + reliability * .2 + safety * .2 + quality * .15 + productSignals * .2));
    const result = { score, components: { delivery, reliability, safety, quality, productSignals }, signals, generated_at: new Date().toISOString() };
    const db = await openDb(root);
    recordEvent(db, 'product.health_calculated', result);
    db.close();
    return result;
}
export async function proposeExperiment(root, hypothesis, metric, target) {
    const id = `EXP-${Date.now()}`;
    const health = await productHealth(root);
    const signals = await loadSignals(root);
    const baseline = signals.find(s => s.name === metric)?.value;
    const exp = { id, hypothesis, metric, baseline, target, status: 'proposed', task_ids: [] };
    const file = path.join(root, '.ai', 'experiments.yaml');
    let all = { experiments: [] };
    if (await exists(file))
        all = YAML.parse(await readText(file)) || all;
    all.experiments = [...(all.experiments || []), exp];
    await writeText(file, YAML.stringify(all));
    const db = await openDb(root);
    recordEvent(db, 'experiment.proposed', { ...exp, healthScore: health.score });
    db.close();
    return exp;
}
