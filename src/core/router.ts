import type {Config,Task,Worker,AgentRole,Risk} from '../types.js';
import {loadHealth,isCoolingDown} from './health.js';
import {openDb,recordEvent} from './db.js';

type Stat={success:number;total:number;avg:number;failures:number};
export interface RouteDecision { worker:Worker; score:number; confidence:number; exploration:number; estimatedCost:number; estimatedLatency:number; reasons:string[]; evidence:{exact:number;broad:number;model:number;worker:number} }

function stat(rows:any[]):Stat {
 const total=rows.length;
 const success=rows.filter(r=>['done','success','passed'].includes(String(r.status))).length;
 const failures=Math.max(0,total-success);
 const durations=rows.map(r=>Number(r.duration_ms||0)).filter(Boolean);
 const avg=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:0;
 return {success,total,avg,failures};
}
function posterior(s:Stat,prior=.72,strength=4){return (s.success+prior*strength)/(s.total+strength)}
function complexity(task:Task){
 const acceptance=task.acceptance_criteria?.length||0;
 const scope=(task.scope?.allowed?.length||0)+(task.scope?.forbidden?.length||0);
 const gates=task.quality_gates?.length||0;
 const risk={low:1,medium:2,high:3,critical:4}[task.risk||'medium']||2;
 return Math.min(10,1+acceptance*.7+scope*.25+gates*.5+risk*.8);
}
function complexityFit(w:Worker,c:number){
 const quality=w.quality||.5;
 const reliability=w.reliability||.5;
 if(c>=7)return (quality*.7+reliability*.3)*12;
 if(c<=3)return (1-(quality*.3))*5;
 return 3;
}
function riskAllowed(w:Worker,task:Task,role:AgentRole){
 if(task.risk==='critical' && role!=='security' && role!=='reviewer' && role!=='architect') return false;
 return w.enabled!==false;
}

export async function routeDetailed(root:string,task:Task,config:Config,role:AgentRole):Promise<RouteDecision[]> {
 const health=await loadHealth(root); const db=await openDb(root);
 try {
  const preferred=config.routing?.[role]?.preferred||[];
  const rows=db.prepare(`SELECT worker_id,model,role,task_type,domain,risk,status,duration_ms,created_at FROM task_outcomes`).all() as any[];
  const complexityScore=complexity(task);
  const candidates=[...config.workers].filter(w=>riskAllowed(w,task,role)&&!isCoolingDown(health[w.id]));
  const decisions=candidates.map(w=>{
   const wr=rows.filter(r=>r.worker_id===w.id);
   const exact=wr.filter(r=>r.role===role&&r.task_type===task.type&&(r.domain||'')===(task.domain||'')&&(r.risk||'')===(task.risk||''));
   const broad=wr.filter(r=>r.role===role&&r.task_type===task.type);
   const model=rows.filter(r=>r.model===w.model&&r.role===role&&r.task_type===task.type);
   const worker=wr;
   const es=stat(exact),bs=stat(broad),ms=stat(model),ws=stat(worker);
   const exactPost=posterior(es,.75), broadPost=posterior(bs,.72), modelPost=posterior(ms,.72), workerPost=posterior(ws,.70);
   const confidence=Math.min(1,(es.total*1.0+bs.total*.5+ms.total*.35+ws.total*.15)/20);
   const exploration=(1-confidence)*12;
   const latency=es.avg||bs.avg||ms.avg||ws.avg||0;
   const estimatedLatency=latency||120000;
   const estimatedCost=(w.cost||0)*(estimatedLatency/60000)*Math.max(1,complexityScore/4);
   const reasons:string[]=[]; let score=0;
   if(preferred.includes(w.id)){score+=18;reasons.push('preferred for role');}
   const capabilityHits=w.capabilities.filter(c=>[role,task.type,task.domain].filter(Boolean).includes(c));
   if(capabilityHits.length){score+=35+Math.min(15,capabilityHits.length*5);reasons.push(`capability match: ${capabilityHits.join(', ')}`)}
   const reliability=w.reliability||.5, quality=w.quality||.5;
   score+=reliability*16+quality*20;
   score+=exactPost*30+broadPost*10+modelPost*8+workerPost*4;
   score+=exploration+complexityFit(w,complexityScore);
   const speed=Math.max(0,8-Math.min(8,estimatedLatency/120000)); score+=speed;
   score-=estimatedCost*4;
   if(task.risk==='critical'){score+=quality*25+reliability*20;reasons.push('critical-risk quality/reliability weighting');}
   if(es.total)reasons.push(`${es.total} exact-context outcome(s), ${(exactPost*100).toFixed(0)}% posterior success`);
   else if(bs.total)reasons.push(`${bs.total} comparable outcome(s), ${(broadPost*100).toFixed(0)}% posterior success`);
   else reasons.push('limited contextual evidence; exploration bonus applied');
   if(latency)reasons.push(`historical latency ${(latency/1000).toFixed(1)}s`);
   if(w.cost)reasons.push(`estimated cost weight ${estimatedCost.toFixed(2)}`);
   const h=health[w.id]; if(h){score+=Math.min(h.successes,12);score-=h.consecutiveFailures*25;if(h.consecutiveFailures)reasons.push(`${h.consecutiveFailures} consecutive worker failure(s)`)}
   return {worker:w,score:Number(score.toFixed(3)),confidence:Number(confidence.toFixed(3)),exploration:Number(exploration.toFixed(3)),estimatedCost:Number(estimatedCost.toFixed(3)),estimatedLatency, reasons,evidence:{exact:es.total,broad:bs.total,model:ms.total,worker:ws.total}};
  }).sort((a,b)=>b.score-a.score);
  recordEvent(db,'routing.decision',{role,taskId:task.id,taskType:task.type,domain:task.domain,risk:task.risk,complexity:Number(complexityScore.toFixed(2)),candidates:decisions.map(d=>({workerId:d.worker.id,score:d.score,confidence:d.confidence,exploration:d.exploration,estimatedCost:d.estimatedCost,evidence:d.evidence}))},task.id);
  return decisions;
 } finally {db.close()}
}

export async function route(root:string,task:Task,config:Config,role:AgentRole){
 return (await routeDetailed(root,task,config,role)).map(x=>x.worker);
}

export async function routingReport(root:string,task:Task,config:Config,role:AgentRole){
 const decisions=await routeDetailed(root,task,config,role);
 return {taskId:task.id,role,taskType:task.type,domain:task.domain,risk:task.risk,decisions};
}
