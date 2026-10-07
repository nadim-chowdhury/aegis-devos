import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensureDir,writeText} from './fs.js';
import {loadConfig,loadTask} from './config.js';
import {ensureGitSafe} from './git.js';
import {git,worktreeAdd,worktreeRemove,mergeBranch,deleteBranch} from './git.js';
import {runTask} from './run.js';
import {buildExecutionPlan} from './orchestrator.js';

export interface ParallelRun { taskId:string; branch:string; worktree:string; status:'done'|'failed'|'merge_conflict'|'awaiting_merge'; error?:string; }
export interface ParallelExecution { generatedAt:string; concurrency:number; waves:ParallelRun[][]; skipped:string[]; }

function safeName(id:string){return id.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(0,60)}

async function runIsolated(root:string, taskId:string):Promise<ParallelRun>{
  const token=randomUUID().slice(0,8);
  const branch=`aegis/parallel/${safeName(taskId)}-${token}`;
  const worktree=path.join(root,'.aegis','worktrees',`${safeName(taskId)}-${token}`);
  await ensureDir(path.dirname(worktree));
  await worktreeAdd(root,worktree,branch);
  try{
    await runTask(worktree,taskId,{skipBranchCreation:true});
    const finished=await loadTask(worktree,taskId);
    if(finished.status!=='done') return {taskId,branch,worktree,status:'failed',error:`Isolated run ended in ${finished.status}; integration withheld.`};
    return {taskId,branch,worktree,status:'done'};
  }catch(e){
    return {taskId,branch,worktree,status:'failed',error:String(e)};
  }
}

export async function executeParallel(project:string,maxConcurrency=2):Promise<ParallelExecution>{
  const root=path.resolve(project);
  const config=await loadConfig(root);
  await ensureGitSafe(root,config.defaults.require_clean_git);
  const plan=await buildExecutionPlan(root);
  if(!plan.valid) throw new Error(`Cannot execute invalid task DAG: ${plan.errors.join('; ')}`);
  const allTasks=await import('./config.js').then(m=>m.listTasks(root));
  const byId=new Map(allTasks.map(t=>[t.id,t]));
  const gated=(id:string)=>{const t=byId.get(id); return !!t && (t.human_approval===true || (config.policy?.require_review_for||[]).includes(t.risk||'low'));};
  const waves:ParallelRun[][]=[]; const skipped:string[]=[];
  for(const wave of plan.waves){
    const results:ParallelRun[]=[];
    for(let i=0;i<wave.tasks.length;i+=Math.max(1,maxConcurrency)){
      const batch=wave.tasks.slice(i,i+Math.max(1,maxConcurrency)).filter(id=>{if(gated(id)){skipped.push(id);return false;}return true;});
      if(!batch.length) continue;
      const batchResults=await Promise.all(batch.map(id=>runIsolated(root,id)));
      for(const result of batchResults){
        if(result.status==='done'){
          try{
            if(!config.defaults.auto_merge){result.status='awaiting_merge'; result.error='auto_merge is disabled; branch retained for manual integration.';} else await mergeBranch(root,result.branch,`aegis: integrate ${result.taskId}`);
          }catch(e){
            result.status='merge_conflict'; result.error=String(e);
            // Abort the in-progress merge so the coordinator remains usable.
            try{await git(root,['merge','--abort'])}catch{}
          }
          if(result.status==='done'){
            try{await deleteBranch(root,result.branch)}catch{}
          }
        }
        try{await worktreeRemove(root,result.worktree,true)}catch{}
        results.push(result);
        if(result.status!=='done') skipped.push(result.taskId);
      }
    }
    waves.push(results);
    if(results.some(r=>r.status!=='done')) break;
  }
  const output={generatedAt:new Date().toISOString(),concurrency:Math.max(1,maxConcurrency),waves,skipped};
  await writeText(path.join(root,'.ai','parallel-execution.json'),JSON.stringify(output,null,2));
  return output;
}
