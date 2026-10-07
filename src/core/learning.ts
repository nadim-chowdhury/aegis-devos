import YAML from 'yaml';
import path from 'node:path';
import { exists, readText, writeText } from './fs.js';
import { openDb, recordEvent, saveLearningInsights } from './db.js';

export interface LearningInsight {
  id:string;
  scope:'worker'|'role'|'task_type'|'model'|'context'|'global';
  key:string;
  sample_size:number;
  success_rate:number;
  avg_duration_ms:number;
  recommendation:string;
  confidence:number;
  generated_at:string;
}

export async function learningReport(root:string):Promise<LearningInsight[]> {
 const db=await openDb(root);
 try {
  const rows=db.prepare(`SELECT worker_id,model,role,task_type,domain,risk,status,duration_ms FROM task_outcomes`).all() as any[];
  const groups=new Map<string,{success:number;total:number;durations:Array<number>;role?:string;model?:string;worker?:string}>();
  for(const r of rows){
   const key=`${r.worker_id||'unknown'}|${r.model||'unknown'}|${r.role||'unknown'}|${r.task_type||'unknown'}|${r.domain||'unknown'}|${r.risk||'unknown'}`;
   const g=groups.get(key)||{success:0,total:0,durations:[] as number[],role:r.role,model:r.model,worker:r.worker_id};
   g.total++; if(['done','success','passed'].includes(String(r.status)))g.success++; if(r.duration_ms)g.durations.push(Number(r.duration_ms)); groups.set(key,g);
  }
  const now=new Date().toISOString();
  const insights=[...groups.entries()].map(([key,g])=>{
   const rate=g.total?g.success/g.total:0; const avg=g.durations.length?g.durations.reduce((a,b)=>a+b,0)/g.durations.length:0; const confidence=Math.min(1,g.total/20);
   const recommendation=confidence<.25?'Insufficient evidence; use conservative routing.':rate>=.85?'Strong candidate for comparable context.':rate<.6?'Weak candidate; prefer alternatives or stronger review.':'Usable candidate with normal review.';
   return {id:`LI-${Buffer.from(key).toString('base64url').slice(0,16)}`,scope:'context' as const,key,sample_size:g.total,success_rate:Number(rate.toFixed(4)),avg_duration_ms:Math.round(avg),recommendation,confidence:Number(confidence.toFixed(4)),generated_at:now};
  });
  saveLearningInsights(db,insights); recordEvent(db,'learning.report_generated',{count:insights.length,mode:'contextual'}); return insights;
 } finally {db.close();}
}

export async function persistLearning(root:string,insights:LearningInsight[]){
  const file=path.join(root,'.ai','LEARNING.yaml');
  await writeText(file,YAML.stringify({insights,updated_at:new Date().toISOString()}));
}

export async function learn(root:string){
  const insights=await learningReport(root); await persistLearning(root,insights); return insights;
}
