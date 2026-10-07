import path from 'node:path';
import {listTasks} from './config.js';
import {openDb,recordEvent} from './db.js';
import type {Task} from '../types.js';

export interface ExecutionWave { index:number; tasks:string[]; blocked:string[]; }
export interface OrchestrationPlan { generatedAt:string; valid:boolean; errors:string[]; warnings:string[]; waves:ExecutionWave[]; ready:string[]; blocked:string[]; completed:string[]; }

function dependenciesDone(task:Task, byId:Map<string,Task>) {
  return (task.depends_on||[]).every(id => byId.get(id)?.status === 'done');
}

export async function buildExecutionPlan(project:string):Promise<OrchestrationPlan>{
  const root=path.resolve(project), tasks=await listTasks(root), byId=new Map(tasks.map(t=>[t.id,t]));
  const errors:string[]=[], warnings:string[]=[];
  for(const t of tasks){
    for(const dep of (t.depends_on||[])) if(!byId.has(dep)) errors.push(`${t.id}: missing dependency ${dep}`);
    if((t.depends_on||[]).includes(t.id)) errors.push(`${t.id}: self dependency`);
  }
  // Kahn-style cycle detection over declared dependencies.
  const indegree=new Map<string,number>(tasks.map(t=>[t.id,0]));
  const edges=new Map<string,string[]>();
  for(const t of tasks) for(const dep of (t.depends_on||[])) if(byId.has(dep)){ indegree.set(t.id,(indegree.get(t.id)||0)+1); edges.set(dep,[...(edges.get(dep)||[]),t.id]); }
  const q=[...tasks.filter(t=>(indegree.get(t.id)||0)===0).map(t=>t.id)], visited:string[]=[];
  while(q.length){ const id=q.shift()!; visited.push(id); for(const n of edges.get(id)||[]){ const d=(indegree.get(n)||0)-1; indegree.set(n,d); if(d===0)q.push(n); } }
  if(visited.length!==tasks.length){ for(const t of tasks) if(!visited.includes(t.id)) errors.push(`${t.id}: dependency cycle detected`); }
  const completed=tasks.filter(t=>t.status==='done').map(t=>t.id);
  const ready=tasks.filter(t=>t.status==='ready'&&dependenciesDone(t,byId)).sort((a,b)=>(b.priority||0)-(a.priority||0)).map(t=>t.id);
  const blocked=tasks.filter(t=>t.status==='ready'&&!dependenciesDone(t,byId)).map(t=>t.id);
  if(!tasks.length) warnings.push('No task definitions found.');
  if(blocked.length) warnings.push(`${blocked.length} ready task(s) are waiting on dependencies.`);
  const waves:ExecutionWave[]=[];
  const remaining=new Set(tasks.filter(t=>['ready','backlog'].includes(t.status)).map(t=>t.id));
  const simulatedDone=new Set(completed);
  let index=0;
  while(remaining.size){
    const runnable=[...remaining].filter(id=>{
      const t=byId.get(id)!;
      return t.status==='ready' && (t.depends_on||[]).every(dep=>simulatedDone.has(dep));
    }).sort((a,b)=>(byId.get(b)!.priority||0)-(byId.get(a)!.priority||0));
    if(!runnable.length)break;
    const waiting=[...remaining].filter(id=>!runnable.includes(id));
    waves.push({index:index++,tasks:runnable,blocked:waiting});
    runnable.forEach(id=>{remaining.delete(id);simulatedDone.add(id);});
  }
  const db=await openDb(root); recordEvent(db,'orchestration.plan',{waves,ready,blocked,errors,warnings}); db.close();
  return {generatedAt:new Date().toISOString(),valid:errors.length===0,errors,warnings,waves,ready,blocked,completed};
}

export async function orchestrate(project:string,once=true){
  const root=path.resolve(project), plan=await buildExecutionPlan(root);
  return {mode:once?'single-step':'continuous',safeConcurrency:1,parallelExecution:'disabled: shared worktree',...plan};
}
