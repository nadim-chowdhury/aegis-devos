import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig,listTasks} from './config.js';
import {openDb,recordEvent} from './db.js';
import type {Task,Worker} from '../types.js';

export interface CapacityPrediction {
  taskId:string; readyRank:number; queueDepth:number; readyTasks:number; activeRuns:number;
  availableWorkers:number; workerId?:string; recommendedModel?:string;
  estimatedWaitMs:number; estimatedCompletionMs:number; capacityScore:number;
  confidence:number; sampleSize:number; reason:string; generatedAt:string;
}

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function complexity(t:Task){return clamp(1+(t.acceptance_criteria?.length||0)*.5+(t.quality_gates?.length||0)*.5+({low:0,medium:1,high:2,critical:3}[t.risk||'medium']||1),1,10)}

export async function capacityPlan(project:string,tasks?:Task[]):Promise<CapacityPrediction[]> {
 const root=path.resolve(project), config=await loadConfig(root), db=await openDb(root);
 try {
  const all=tasks??await listTasks(root); const ready=all.filter(t=>t.status==='ready');
  const active:any[]=db.prepare("SELECT task_id,worker_id,started_at FROM runs WHERE status='running'").all();
  const workers=config.workers.filter(w=>w.enabled!==false);
  const outcomes:any[]=db.prepare("SELECT worker_id,status,duration_ms,created_at FROM task_outcomes WHERE duration_ms IS NOT NULL ORDER BY created_at DESC LIMIT 500").all();
  const predictions:CapacityPrediction[]=[];
  for(let rank=0;rank<ready.length;rank++){
   const task=ready[rank]; const preferred=(config.routing?.[task.assigned_role||'developer']?.preferred||[]);
   const idle=workers.filter(w=>!active.some(r=>r.worker_id===w.id));
   const candidates=(idle.length?idle:workers).map(w=>{
    const hist=outcomes.filter(r=>r.worker_id===w.id).map(r=>Number(r.duration_ms||0)).filter(n=>n>0);
    const avg=hist.length?hist.reduce((a,b)=>a+b,0)/hist.length:120000;
    const success=hist.length?outcomes.filter(r=>r.worker_id===w.id&&['done','success','passed'].includes(String(r.status))).length/hist.length:(w.reliability??.8);
    const pref=preferred.includes(w.id)?1:.0;
    const score=clamp(success*.55+(w.quality??.7)*.2+(1/(1+avg/600000))*.15+pref*.1,0,1);
    return {w,avg,score,hist:hist.length};
   }).sort((a,b)=>b.score-a.score)[0];
   const queueWait=active.length>=workers.length?Math.round((rank+1)*((candidates?.avg||120000)/Math.max(1,workers.length))):0;
   const wait=queueWait; const completion=wait+Math.round((candidates?.avg||120000)*complexity(task)/4);
   const confidence=clamp((candidates?.hist||0)*.05+workers.length*.05,.15,.95);
   const score=clamp((workers.length-Math.min(active.length,workers.length))/Math.max(1,workers.length)*.65+(candidates?.score||.5)*.35,0,1);
   const reason=active.length>=workers.length?'capacity constrained; queued behind active work':'capacity available; best healthy worker selected';
   const pred:CapacityPrediction={taskId:task.id,readyRank:rank+1,queueDepth:Math.max(0,ready.length-1),readyTasks:ready.length,activeRuns:active.length,availableWorkers:workers.length,workerId:candidates?.w.id,recommendedModel:candidates?.w.model,estimatedWaitMs:wait,estimatedCompletionMs:completion,capacityScore:Number(score.toFixed(3)),confidence:Number(confidence.toFixed(3)),sampleSize:candidates?.hist||0,reason,generatedAt:new Date().toISOString()};
   db.prepare(`INSERT INTO capacity_predictions(id,task_id,ready_rank,worker_id,recommended_model,queue_depth,ready_tasks,active_runs,available_workers,estimated_wait_ms,estimated_completion_ms,capacity_score,confidence,sample_size,reason,forecast_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),pred.taskId,pred.readyRank,pred.workerId??null,pred.recommendedModel??null,pred.queueDepth,pred.readyTasks,pred.activeRuns,pred.availableWorkers,pred.estimatedWaitMs,pred.estimatedCompletionMs,pred.capacityScore,pred.confidence,pred.sampleSize,pred.reason,JSON.stringify(pred),pred.generatedAt);
   recordEvent(db,'capacity.prediction',pred,task.id); predictions.push(pred);
  }
  return predictions;
 } finally {db.close();}
}

export async function capacityRecommendations(project:string){
 const root=path.resolve(project), db=await openDb(root); try {
  const rows:any[]=db.prepare(`SELECT * FROM capacity_predictions WHERE created_at=(SELECT MAX(created_at) FROM capacity_predictions) ORDER BY ready_rank`).all();
  return {generatedAt:new Date().toISOString(),project:root,recommendations:rows};
 } finally {db.close();}
}

export async function capacityHistory(project:string,taskId?:string){const db=await openDb(path.resolve(project));try{return taskId?db.prepare('SELECT * FROM capacity_predictions WHERE task_id=? ORDER BY created_at DESC LIMIT 100').all(taskId):db.prepare('SELECT * FROM capacity_predictions ORDER BY created_at DESC LIMIT 100').all();}finally{db.close();}}
