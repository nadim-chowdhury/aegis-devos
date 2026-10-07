import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, writeText } from './fs.js';
import { openDb, recordEvent } from './db.js';
import { productHealth, type ProductSignal, type Experiment } from './intelligence.js';
import { discoverOpportunities, type Opportunity } from './opportunities.js';

export interface GrowthGap {
  metric: string;
  value: number;
  target: number;
  direction: 'higher_is_better' | 'lower_is_better';
  gap: number;
  gap_percent: number;
  severity: 'healthy' | 'watch' | 'critical';
  source?: string;
}

export interface GrowthReport {
  score: number;
  gaps: GrowthGap[];
  strengths: ProductSignal[];
  opportunities: Opportunity[];
  health_score: number;
  generated_at: string;
}

async function loadSignals(root: string): Promise<ProductSignal[]> {
  const file = path.join(root, '.ai', 'PRODUCT_SIGNALS.yaml');
  if (!(await exists(file))) return [];
  const parsed = YAML.parse(await readText(file));
  return Array.isArray(parsed?.signals) ? parsed.signals : [];
}

export async function growthReport(root: string): Promise<GrowthReport> {
  const signals = await loadSignals(root);
  const gaps: GrowthGap[] = [];
  const strengths: ProductSignal[] = [];

  for (const s of signals) {
    if (typeof s.value !== 'number' || typeof s.target !== 'number' || s.target === 0) continue;
    const direction = s.direction === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better';
    const gap = direction === 'higher_is_better' ? s.target - s.value : s.value - s.target;
    const gapPercent = Math.abs(gap / Math.abs(s.target)) * 100;
    if (gap <= 0) strengths.push(s);
    else gaps.push({
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
        if (typeof s.target !== 'number' || s.target === 0) return sum + 0.5;
        const ratio = s.direction === 'lower_is_better' ? s.target / Math.max(Math.abs(s.value), Number.EPSILON) : s.value / s.target;
        return sum + Math.max(0, Math.min(1, ratio));
      }, 0) / signals.length
    : 0.5;
  const health = await productHealth(root);
  const score = Math.round(average * 100);
  const opportunities = gaps.map((g, i): Opportunity => ({
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

  const report: GrowthReport = { score, gaps, strengths, opportunities, health_score: health.score, generated_at: new Date().toISOString() };
  const db = await openDb(root);
  recordEvent(db, 'growth.report_calculated', report);
  db.close();
  return report;
}

export async function updateExperiment(root: string, id: string, status: Experiment['status'], observed?: number) {
  const file = path.join(root, '.ai', 'experiments.yaml');
  if (!(await exists(file))) throw new Error('No experiments file exists.');
  const parsed = YAML.parse(await readText(file)) || { experiments: [] };
  const experiments = Array.isArray(parsed.experiments) ? parsed.experiments : [];
  const index = experiments.findIndex((e: Experiment) => e.id === id);
  if (index < 0) throw new Error(`Experiment ${id} not found.`);
  const exp = { ...experiments[index], status } as Experiment & { observed?: number };
  if (observed !== undefined) exp.observed = observed;
  experiments[index] = exp;
  await writeText(file, YAML.stringify({ experiments }));
  const db = await openDb(root);
  recordEvent(db, 'experiment.updated', exp);
  db.close();
  return exp;
}
