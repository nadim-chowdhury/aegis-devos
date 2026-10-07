import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config, Task, Worker } from '../types.js';
import { loadConfig, listTasks } from './config.js';
import { openDb, recordEvent } from './db.js';

export interface ResourceForecast {
  workerId:string; model:string; estimatedCost:number; estimatedLatencyMs:number;
  confidence:number; sampleSize:number; costPerMinute:number; reasons:string[];
}
export interface ResourcePlan {
  taskId:string; budget:number; forecasts:ResourceForecast[]; recommendedWorkerId?:string;
  recommendedModel?:string; estimatedCost?:number; estimatedLatencyMs?:number;
  projectedBudgetUsage?:number; recommendation:string; confidence:number;
  generatedAt:string;
}

function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n));}
function complexity(task:Task){
  const acceptance=task.acceptance_criteria?.length||0;
  const scope=(task.scope?.allowed?.length||0)+(task.scope?.forbidden?.length||0);
  const gates=task.quality_gates?.length||0;
  const risk={low:1,medium:2,high:3,critical:4}[task.risk||'medium']||2;
  return Math.min(10,1+acceptance*.7+scope*.25+gates*.5+risk*.8);
}

export async function resourcePlan(project:string, task:Task):Promise<ResourcePlan>{
  const root=path.resolve(project); const config=await loadConfig(root); const db=await openDb(root);
  try {
    const outcomes=db.prepare(`SELECT worker_id,model,status,duration_ms,role,task_type,domain,risk,created_at FROM task_outcomes`).all() as any[];
    const routes=db.prepare(`SELECT worker_id,estimated_cost,estimated_latency_ms,confidence,created_at FROM routing_decisions WHERE task_id=? ORDER BY id DESC LIMIT 100`).all(task.id) as any[];
    const c=complexity(task);
    const budget=Number((config.defaults as any).resource_budget??(config as any).resource_budget??10);
    const forecasts:ResourceForecast[] = config.workers.filter(w=>w.enabled!==false).map((w:Worker)=>{
      const rows=outcomes.filter(r=>r.worker_id===w.id);
      const comparable=rows.filter(r=>r.task_type===task.type&&(r.domain||'')===(task.domain||'')&&(r.risk||'')===(task.risk||''));
      const pool=comparable.length?comparable:rows.filter(r=>r.task_type===task.type);
      const durations=pool.map(r=>Number(r.duration_ms||0)).filter(n=>n>0);
      const avg=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:120000*(1+c/8);
      const routeRows=routes.filter(r=>r.worker_id===w.id);
      const routeCost=routeRows.length?Number(routeRows[0].estimated_cost||0):0;
      const baseCost=routeCost>0?routeCost:(w.cost||0)*(avg/60000)*Math.max(1,c/4);
      const complexityMultiplier=1+Math.max(0,c-5)*.08;
      const estimatedCost=baseCost*complexityMultiplier;
      const success=pool.filter(r=>['done','success','passed'].includes(String(r.status))).length;
      const confidence=clamp((pool.length*.08)+(rows.length*.02),.12,.95);
      const reasons:string[]=[];
      if(comparable.length) reasons.push(`${comparable.length} exact-context outcome(s)`); else if(pool.length) reasons.push(`${pool.length} comparable task-type outcome(s)`); else reasons.push('no historical task outcome; conservative baseline');
      if(w.cost) reasons.push(`worker cost weight ${w.cost}`);
      if(success) reasons.push(`${success}/${pool.length} comparable outcome(s) succeeded`);
      return {workerId:w.id,model:w.model,estimatedCost:Number(estimatedCost.toFixed(3)),estimatedLatencyMs:Math.round(avg),confidence:Number(confidence.toFixed(3)),sampleSize:pool.length,costPerMinute:Number((w.cost||0).toFixed(3)),reasons};
    }).sort((a,b)=>{
      const aFit=a.estimatedCost<=budget?1:0,bFit=b.estimatedCost<=budget?1:0;
      return (bFit-aFit)||(a.estimatedCost-b.estimatedCost)||(b.confidence-a.confidence);
    });
    const best=forecasts[0];
    const recommendation=!best?'NO_WORKER':'best estimated cost/latency strategy within configured budget';
    const plan:ResourcePlan={taskId:task.id,budget,forecasts,recommendedWorkerId:best?.workerId,recommendedModel:best?.model,estimatedCost:best?.estimatedCost,estimatedLatencyMs:best?.estimatedLatencyMs,projectedBudgetUsage:best?Number((best.estimatedCost/Math.max(.001,budget)).toFixed(3)):undefined,recommendation,confidence:best?.confidence??0,generatedAt:new Date().toISOString()};
    db.prepare(`INSERT INTO resource_predictions(id,task_id,recommended_worker_id,recommended_model,budget,estimated_cost,estimated_latency_ms,confidence,sample_size,forecast_json,recommendation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),task.id,best?.workerId??null,best?.model??null,budget,best?.estimatedCost??null,best?.estimatedLatencyMs??null,best?.confidence??0,best?.sampleSize??0,JSON.stringify(plan),recommendation,plan.generatedAt);
    recordEvent(db,'resource.prediction',plan,task.id);
    return plan;
  } finally {db.close();}
}

export async function resourceRecommendations(project:string){
  const root=path.resolve(project); const tasks=await listTasks(root); const db=await openDb(root);
  try {
    const rows=db.prepare(`SELECT * FROM resource_predictions ORDER BY created_at DESC LIMIT 100`).all() as any[];
    return {generatedAt:new Date().toISOString(),project:root,budget:await loadConfig(root).then(c=>Number((c.defaults as any).resource_budget??10)),predictions:rows};
  } finally {db.close();}
}

export async function resourceHistory(project:string, taskId?:string){
  const db=await openDb(path.resolve(project));
  try { return taskId?db.prepare(`SELECT * FROM resource_predictions WHERE task_id=? ORDER BY created_at DESC LIMIT 100`).all(taskId):db.prepare(`SELECT * FROM resource_predictions ORDER BY created_at DESC LIMIT 100`).all(); }
  finally {db.close();}
}
